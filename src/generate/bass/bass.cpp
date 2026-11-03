// The bass-line generator of ts/src/generate/bass/index.ts.

#include "generate/bass/bass.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <string>
#include <utility>

#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/core/validation.h"
#include "core/instrument/profile.h"
#include "core/validation/validation.h"
#include "generate/bass/internal.h"
#include "generate/bass/limits.gen.h"
#include "generate/context/context.h"
#include "generate/drums/internal.h"
#include "js/math.h"
#include "theory/chord/chord.h"

namespace cantus {

namespace {

/** BASS_STYLES as names, indexed by BassStyle. */
constexpr std::array<std::string_view, BASS_STYLES.size()> kStyleNames =
#include "generate/bass/bass_styles.gen.inc"
    ;
static_assert(!kStyleNames.back().empty(), "BASS_STYLES and BassStyle disagree");

struct RawNote {
  double startBeat;
  double pitch;
  double velocity;
};

/** Working state threaded through the per-segment builders (`BuildContext`). */
struct BuildContext {
  explicit BuildContext(Draw part) : draw(std::move(part)) {}

  TimeSignature ts;
  double low = 0;
  KeyScale key;
  /** Position-addressed draws: every decision is keyed by where it happens. */
  Draw draw;
  std::vector<RawNote> notes;
  /** Where the chord being written sounds its bass note. */
  double rootMidi = 0;
  /** The chord names a bass of its own, so every tone of it is placed above that bass. */
  bool overBass = false;
  /** The last note emitted, which decides which way an approach note leads. */
  double prevMidi = 0;
  std::optional<InstrumentProfile> instrument;
  /** How often a weak beat takes a pickup, in [0, 1]. */
  double pickupDensity = 0;
  std::optional<double> bpm;
  std::optional<double> difficulty;
};

/** Append a note for pitch class `pc` at `pos`, placed against the chord's bass. */
double emit(BuildContext& ctx, double pos, double pc,
            std::optional<double> midi_override = std::nullopt) {
  double placed = clamp_to_midi(
      midi_override ? *midi_override : place_tone(pc, ctx.rootMidi, ctx.low, ctx.overBass),
      "generated bass pitch");
  double midi = sounding_pitch(placed, ctx.instrument);
  double velocity = is_strong_beat(pos, ctx.ts) ? BASS_STRONG_VELOCITY : BASS_WEAK_VELOCITY;
  ctx.notes.push_back(RawNote{pos, midi, velocity});
  ctx.prevMidi = midi;
  return midi;
}

/** One root note per segment. */
void build_root(BuildContext& ctx, const BassSegment& seg) {
  emit(ctx, seg.startBeat, bass_pc_of(seg.chord));
}

/** Root and fifth alternating, once per bar the segment covers. */
void build_root_fifth(BuildContext& ctx, const BassSegment& seg) {
  for (const BarTile& tile : bar_tiles(seg.startBeat, seg.endBeat, ctx.ts)) {
    emit(ctx, tile.startBeat, bass_pc_of(seg.chord));
    double answer = mid_bar_pulse(tile.startBeat, ctx.ts);
    if (answer > tile.startBeat + BEAT_EPS && answer < tile.endBeat - BEAT_EPS) {
      emit(ctx, answer, bass_fifth_pc_of(seg.chord));
    }
  }
}

/** Where an octave pickup goes, or nothing when the instrument has no octave. */
std::optional<double> octave_pickup(const BuildContext& ctx) {
  double root = sounding_pitch(ctx.rootMidi, ctx.instrument);
  for (double candidate : {ctx.rootMidi - 12, ctx.rootMidi + 12}) {
    if (is_midi_pitch(candidate) && sounding_pitch(candidate, ctx.instrument) != root) {
      return candidate;
    }
  }
  return std::nullopt;
}

/** Whether the hand covers a leap of `semitones` in the time since the last note. */
bool reachable_leap(const BuildContext& ctx, double pos, double semitones) {
  double available = ctx.notes.empty() ? std::numeric_limits<double>::infinity()
                                       : pos - ctx.notes.back().startBeat;
  return sustains_shift(semitones, available, ctx.bpm, ctx.difficulty);
}

/** The weak-beat pickup a `pop` line leads into the next strong beat with. */
bool pickup(BuildContext& ctx, const BassSegment& seg, double pos, double index) {
  std::optional<double> octave = octave_pickup(ctx);
  if (ctx.draw.prob(0.5, {std::string("pickupKind"), index, pos}) && octave &&
      reachable_leap(ctx, pos, std::abs(sounding_pitch(*octave, ctx.instrument) - ctx.prevMidi))) {
    emit(ctx, pos, bass_pc_of(seg.chord), octave);
    return true;
  }
  int fifth_pc = bass_fifth_pc_of(seg.chord);
  if (sounding_pitch(place_tone(fifth_pc, ctx.rootMidi, ctx.low, ctx.overBass), ctx.instrument) ==
      sounding_pitch(ctx.rootMidi, ctx.instrument)) {
    return false;
  }
  emit(ctx, pos, fifth_pc);
  return true;
}

/** Root on every strong beat, with occasional octave/fifth pickups on weak beats. */
void build_pop(BuildContext& ctx, const BassSegment& seg, double index) {
  std::vector<double> positions = beat_positions(seg.startBeat, seg.endBeat, ctx.ts);
  int root_pc = bass_pc_of(seg.chord);
  bool emitted = false;
  for (double pos : positions) {
    if (is_strong_beat(pos, ctx.ts)) {
      emit(ctx, pos, root_pc);
      emitted = true;
    } else if (ctx.draw.prob(ctx.pickupDensity, {std::string("pickup"), index, pos})) {
      emitted = pickup(ctx, seg, pos, index) || emitted;
    }
  }
  if (!emitted) {
    emit(ctx, seg.startBeat, root_pc);
  }
}

/** Cycle bass -> third -> fifth (-> seventh) across the segment's beats. */
void build_arpeggio(BuildContext& ctx, const BassSegment& seg) {
  std::vector<int> tones = bass_tone_cycle(seg.chord);
  std::vector<double> positions = beat_positions(seg.startBeat, seg.endBeat, ctx.ts);
  for (std::size_t i = 0; i < positions.size(); ++i) {
    emit(ctx, positions[i], tones[i % tones.size()]);
  }
}

/** The neighbour a walking line leads into the next chord with. */
double approach_note(const BuildContext& ctx, double target, double from, double index) {
  return bass_approach_note(target, from, ctx.key,
                            ctx.draw.prob(0.5, {std::string("approach"), index}));
}

/** A quarter-note line of chord tones that leads by step into each chord change. */
void build_walking(BuildContext& ctx, const BassSegment& seg, const BassSegment* next,
                   double index) {
  std::vector<int> tones = bass_tone_cycle(seg.chord);
  std::vector<double> positions = beat_positions(seg.startBeat, seg.endBeat, ctx.ts);
  std::size_t count = positions.size();
  for (std::size_t i = 0; i < count; ++i) {
    double pos = positions[i];
    if (i == 0) {
      emit(ctx, pos, bass_pc_of(seg.chord));
      continue;
    }
    if (next != nullptr && count > 1 && i == count - 1) {
      // The line leads into the note that will actually sound, not a copy placed elsewhere.
      double next_bass = place_root(bass_pc_of(next->chord), ctx.low);
      double midi = approach_note(ctx, next_bass, ctx.prevMidi, index);
      emit(ctx, pos, pitch_class_of(midi), midi);
      continue;
    }
    emit(ctx, pos, tones[i % tones.size()]);
  }
}

}  // namespace

std::string_view to_string(BassStyle style) { return kStyleNames[static_cast<std::size_t>(style)]; }

std::vector<std::string_view> bass_style_names() { return names_of(kStyleNames); }

std::optional<BassStyle> parse_bass_style(std::string_view name) {
  return parse_named<BassStyle>(kStyleNames, name);
}

double estimated_bass_notes(const std::vector<BassSegment>& segments) {
  double count = 0;
  for (const BassSegment& segment : segments) {
    count += js::max(1.0, std::ceil(segment.endBeat - segment.startBeat));
  }
  return count;
}

std::vector<NoteEvent> generate_bass_line_with(const BassLineRequest& request,
                                               const ResolvedContext& resolved) {
  BuildContext ctx(resolved.part("bass"));
  ctx.ts = request.ts;
  ctx.low = request.low;
  ctx.key = request.key;
  ctx.rootMidi = request.low;
  ctx.prevMidi = request.low;
  if (request.instrument) {
    ctx.instrument = InstrumentProfile(*request.instrument);
  }
  ctx.pickupDensity = resolved.rhythmic.value_or(BASS_DEFAULT_PICKUP_DENSITY);
  ctx.bpm = resolved.bpm;
  ctx.difficulty = resolved.difficulty;

  const std::vector<BassSegment>& segments = request.segments;
  for (std::size_t s = 0; s < segments.size(); ++s) {
    const BassSegment& seg = segments[s];
    ctx.rootMidi = place_root(bass_pc_of(seg.chord), ctx.low);
    ctx.overBass = seg.chord.bassPc.has_value();
    switch (request.style) {
      case BassStyle::kRootFifth:
        build_root_fifth(ctx, seg);
        break;
      case BassStyle::kPop:
        build_pop(ctx, seg, static_cast<double>(s));
        break;
      case BassStyle::kWalking:
        build_walking(ctx, seg, s + 1 < segments.size() ? &segments[s + 1] : nullptr,
                      static_cast<double>(s));
        break;
      case BassStyle::kArpeggio:
        build_arpeggio(ctx, seg);
        break;
      case BassStyle::kRoot:
        build_root(ctx, seg);
        break;
    }
  }

  std::stable_sort(ctx.notes.begin(), ctx.notes.end(),
                   [](const RawNote& a, const RawNote& b) { return a.startBeat < b.startBeat; });
  double last_end = segments_end(segments);

  std::vector<NoteEvent> out;
  for (std::size_t i = 0; i < ctx.notes.size(); ++i) {
    const RawNote& note = ctx.notes[i];
    double next_start = i + 1 < ctx.notes.size() ? ctx.notes[i + 1].startBeat : last_end;
    double duration_beat = next_start - note.startBeat;
    if (duration_beat <= BEAT_EPS) {
      continue;
    }
    NoteEvent event;
    event.pitch = static_cast<int>(clamp_to_midi(note.pitch, "generated bass pitch"));
    event.startBeat = note.startBeat;
    event.durationBeat = duration_beat;
    event.velocity = static_cast<int>(note.velocity);
    out.push_back(event);
  }
  return out;
}

std::vector<NoteEvent> generate_bass_line(const BassLineOptions& opts) {
  assert_generation_budget(static_cast<double>(opts.segments.size()), "bass segments", opts.budget);
  // The chords are read into their plain form once, here at the boundary.
  std::vector<BassSegment> segments = read_bass_segments(opts.segments);
  if (segments.empty()) {
    return {};
  }

  BassLineRequest request;
  request.ts = meter_at(0, to_meter_data(opts.ts.value_or(MeterArg(kGenerateDefaultTs)), "ts"));
  request.style = opts.style.value_or(BassStyle::kRoot);
  double octave = opts.octave.value_or(BASS_DEFAULT_OCTAVE);
  // The band spans `low..low + 12`, so octave 8 is the highest base that keeps every pitch in MIDI.
  assert_integer(octave, "bass octave", -1, 8);
  assert_generation_budget(estimated_bass_notes(segments), "bass notes", opts.budget);
  ResolvedContext resolved = resolve_context(opts.ctx);
  BassRegister register_ = bass_register(resolved.instrument("bass"), opts.instrument, octave);
  request.instrument = register_.instrument;
  request.low = register_.low;
  request.key = to_key_scale(opts.key);
  request.segments = std::move(segments);
  return generate_bass_line_with(request, resolved);
}

}  // namespace cantus
