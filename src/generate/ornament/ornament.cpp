// The ornament pass of ts/src/generate/ornament/index.ts.

#include "generate/ornament/ornament.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>
#include <set>
#include <string>

#include "cantus/core/instrument.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "generate/context/context.h"
#include "generate/ornament/limits.gen.h"
#include "js/math.h"

namespace cantus {

namespace {

constexpr std::string_view kStyleNames[] =
#include "generate/ornament/ornament_styles.gen.inc"
    ;
static_assert(sizeof(kStyleNames) / sizeof(kStyleNames[0]) == ORNAMENT_STYLES.size(),
              "ORNAMENT_STYLES and OrnamentStyle disagree");

/** The neighbours of a note in the ordered material, by index into `sounding`. */
using Neighbours = std::vector<std::optional<std::size_t>>;

/** Whether a note is a candidate for an ornament of this style. */
bool eligible(OrnamentStyle style, const NoteEvent& note, const NoteEvent* previous,
              const NoteEvent* next, const MeterArg& meter) {
  bool strong = is_strong_beat(note.startBeat, meter);
  switch (style) {
    case OrnamentStyle::kGhost:
      return !strong;
    case OrnamentStyle::kFlam:
    case OrnamentStyle::kAccent:
      return strong;
    case OrnamentStyle::kDrag:
      // A drag is the weak note before a strong one, so the next onset has to be the strong one.
      return !strong && next != nullptr && is_strong_beat(next->startBeat, meter);
    case OrnamentStyle::kSlide:
      return previous != nullptr &&
             std::abs(note.pitch - previous->pitch) >= ORNAMENT_SLIDE_MIN_SEMITONES;
  }
  return false;
}

double clamp_velocity(double velocity) {
  return js::min(ORNAMENT_MAX_VELOCITY, js::max(ORNAMENT_MIN_VELOCITY, js::round(velocity)));
}

/** Velocity after an ornament, or nothing where the ornament changes none. */
std::optional<double> ornamented_velocity(OrnamentStyle style, const NoteEvent& note) {
  if (!note.velocity && style != OrnamentStyle::kGhost && style != OrnamentStyle::kAccent) {
    return std::nullopt;
  }
  double velocity = note.velocity ? static_cast<double>(*note.velocity) : ORNAMENT_DEFAULT_VELOCITY;
  if (style == OrnamentStyle::kGhost) {
    return clamp_velocity(velocity * ORNAMENT_GHOST_VELOCITY_SCALE);
  }
  if (style == OrnamentStyle::kAccent) {
    return clamp_velocity(velocity + ORNAMENT_ACCENT_VELOCITY_BOOST);
  }
  return velocity;
}

/** The previous onset's last note before each note, as indices into `sounding`. */
Neighbours previous_onsets(const std::vector<NoteEvent>& sounding,
                           const std::vector<std::size_t>& ordered) {
  Neighbours previous(sounding.size());
  std::optional<std::size_t> earlier;
  for (std::size_t at : ordered) {
    if (earlier && sounding[*earlier].startBeat == sounding[at].startBeat) {
      previous[at] = previous[*earlier];
    } else {
      previous[at] = earlier;
    }
    earlier = at;
  }
  return previous;
}

/** The next onset's first note after each note, as indices into `sounding`. */
Neighbours next_onsets(const std::vector<NoteEvent>& sounding,
                       const std::vector<std::size_t>& ordered) {
  Neighbours next(sounding.size());
  std::optional<std::size_t> later;
  for (std::size_t index = ordered.size(); index > 0; --index) {
    std::size_t at = ordered[index - 1];
    if (later && sounding[*later].startBeat == sounding[at].startBeat) {
      next[at] = next[*later];
    } else {
      next[at] = later;
    }
    later = at;
  }
  return next;
}

/** The tightest gap around each onset, in beats, by index into `sounding`. */
std::vector<double> stroke_gaps(const std::vector<NoteEvent>& sounding) {
  std::set<double> distinct_set;
  for (const NoteEvent& note : sounding) {
    distinct_set.insert(note.startBeat);
  }
  std::vector<double> distinct(distinct_set.begin(), distinct_set.end());
  constexpr double kInfinity = std::numeric_limits<double>::infinity();
  std::vector<double> gaps;
  for (const NoteEvent& note : sounding) {
    std::size_t index = static_cast<std::size_t>(
        std::lower_bound(distinct.begin(), distinct.end(), note.startBeat) - distinct.begin());
    double beat = distinct[index];
    double before = index == 0 ? kInfinity : beat - distinct[index - 1];
    double after = index + 1 == distinct.size() ? kInfinity : distinct[index + 1] - beat;
    gaps.push_back(js::min(before, after));
  }
  return gaps;
}

}  // namespace

const TimeSignature kOrnamentDefaultTs =
#include "generate/ornament/default_ts.gen.inc"
    ;

std::string_view to_string(OrnamentStyle style) {
  return kStyleNames[static_cast<std::size_t>(style)];
}

std::optional<OrnamentStyle> parse_ornament_style(std::string_view name) {
  for (OrnamentStyle style : ORNAMENT_STYLES) {
    if (to_string(style) == name) {
      return style;
    }
  }
  return std::nullopt;
}

std::vector<std::string_view> ornament_style_names() {
  return std::vector<std::string_view>(std::begin(kStyleNames), std::end(kStyleNames));
}

std::vector<NoteEvent> ornament_with(const std::vector<NoteEvent>& sounding, OrnamentStyle style,
                                     const MeterData& meter, const ResolvedContext& ctx) {
  MeterArg weighed(meter);
  double amount = ctx.ornament.value_or(ORNAMENT_DEFAULT_AMOUNT);
  Draw draw = ctx.part("ornament");

  std::vector<std::size_t> ordered(sounding.size());
  std::iota(ordered.begin(), ordered.end(), 0);
  std::stable_sort(ordered.begin(), ordered.end(), [&sounding](std::size_t a, std::size_t b) {
    double by_start = sounding[a].startBeat - sounding[b].startBeat;
    return by_start != 0 ? by_start < 0 : sounding[a].pitch < sounding[b].pitch;
  });
  Neighbours previous_of = previous_onsets(sounding, ordered);
  Neighbours next_of = next_onsets(sounding, ordered);
  std::vector<double> gaps = stroke_gaps(sounding);

  std::vector<NoteEvent> out;
  for (std::size_t index = 0; index < sounding.size(); ++index) {
    const NoteEvent& note = sounding[index];
    NoteEvent decorated = note;
    const NoteEvent* previous = previous_of[index] ? &sounding[*previous_of[index]] : nullptr;
    const NoteEvent* next = next_of[index] ? &sounding[*next_of[index]] : nullptr;
    if (note.articulation || !eligible(style, note, previous, next, weighed)) {
      out.push_back(decorated);
      continue;
    }
    // The ceiling only ever rejects: an ornament this fast is one the player would not take.
    if (!sustains_strokes(gaps[index], ctx.bpm, ctx.difficulty)) {
      out.push_back(decorated);
      continue;
    }
    if (!draw.prob(amount, {std::string(to_string(style)), note.startBeat,
                            static_cast<double>(note.pitch)})) {
      out.push_back(decorated);
      continue;
    }
    decorated.articulation = *parse_articulation(to_string(style));
    if (std::optional<double> velocity = ornamented_velocity(style, note)) {
      decorated.velocity = static_cast<int>(*velocity);
    }
    out.push_back(decorated);
  }
  return out;
}

std::vector<NoteEvent> ornament(const std::vector<NoteEvent>& notes, const OrnamentOptions& opts) {
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  assert_note_events(notes, "ornament notes", note_options);
  OrnamentStyle style = opts.style.value_or(OrnamentStyle::kGhost);
  MeterData meter = to_meter_data(opts.ts.value_or(MeterArg(kOrnamentDefaultTs)), "ts");
  if (opts.amount) {
    assert_range(*opts.amount, 0, 1, "ornament amount");
  }
  ResolvedContext ctx = resolve_context_with(opts.ctx, ContextSugar{opts.amount});
  // Zero-length artefacts never sound and are dropped, as humanize and the analysis layer do.
  return ornament_with(drop_silent_notes(notes), style, meter, ctx);
}

}  // namespace cantus
