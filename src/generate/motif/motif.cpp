// The motif generator, transforms and development of ts/src/generate/motif/index.ts.

#include "generate/motif/motif.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/motif/limits.gen.h"
#include "js/math.h"
#include "js/number.h"
#include "js/sort.h"

namespace cantus {

namespace {

constexpr std::string_view kTransformNames[] =
#include "generate/motif/motif_transforms.gen.inc"
    ;
static_assert(sizeof(kTransformNames) / sizeof(kTransformNames[0]) == MOTIF_TRANSFORMS.size(),
              "MOTIF_TRANSFORMS and MotifTransform disagree");

/** Whether a beat position falls on a bar line of a `bar_beats`-long bar. */
bool is_downbeat(double start_beat, double bar_beats) {
  double bar = start_beat / bar_beats;
  return std::abs(bar - js::round(bar)) < BEAT_EPS;
}

/** Nearest chord tone to `pitch`, preferring the lower pitch on a tie. */
double nearest_chord_tone(double pitch, const Chord& chord) {
  std::vector<int> pcs = chord_pitch_classes(chord);
  auto has = [&pcs](int pc) { return std::find(pcs.begin(), pcs.end(), pc) != pcs.end(); };
  for (int d = 0; d <= 12; ++d) {
    if (has(pitch_class_of(pitch - d))) {
      return pitch - d;
    }
    if (has(pitch_class_of(pitch + d))) {
      return pitch + d;
    }
  }
  return pitch;
}

/**
 * Pick the pitch a developed note takes: the nearest pitch its position allows that no different
 * note of the same tile already took, a tie going the way the melody was moving.
 */
double developed_pitch(double pitch, const std::function<bool(double)>& allows, double direction,
                       const std::map<double, double>& taken) {
  double ahead = direction >= 0 ? 1 : -1;
  for (int d = 0; d <= MOTIF_MAX_DEVELOP_SHIFT; ++d) {
    std::vector<double> candidates;
    if (d == 0) {
      candidates = {pitch};
    } else {
      candidates = {pitch + ahead * d, pitch - ahead * d};
    }
    for (double candidate : candidates) {
      if (candidate < 0 || candidate > 127 || !allows(candidate)) {
        continue;
      }
      auto owner = taken.find(candidate);
      if (owner == taken.end() || owner->second == pitch) {
        return candidate;
      }
    }
  }
  return pitch;
}

/** Earliest onset in a cell; the time origin for timing transforms. */
double cell_origin(const std::vector<NoteEvent>& notes) {
  double origin = std::numeric_limits<double>::infinity();
  for (const NoteEvent& note : notes) {
    origin = js::min(origin, note.startBeat);
  }
  return std::isfinite(origin) ? origin : 0;
}

/** Latest offset in a cell. */
double cell_end(const std::vector<NoteEvent>& notes) {
  double end = -std::numeric_limits<double>::infinity();
  for (const NoteEvent& note : notes) {
    end = js::max(end, note.startBeat + note.durationBeat);
  }
  return std::isfinite(end) ? end : 0;
}

/** The results in time order: a stable sort by onset. */
void in_time_order(std::vector<MotifResult>& notes) {
  js::array_sort(
      notes, [](const MotifResult& a, const MotifResult& b) { return a.startBeat - b.startBeat; });
}

/** The pitch an inversion reflects about: the cell's earliest note. */
double pivot_pitch(const std::vector<NoteEvent>& notes, const std::vector<double>& pitches) {
  std::optional<std::size_t> pivot;
  for (std::size_t i = 0; i < notes.size(); ++i) {
    if (!pivot || notes[i].startBeat < notes[*pivot].startBeat) {
      pivot = i;
    }
  }
  return pivot ? pitches[*pivot] : 0;
}

/** Diatonic scale-degree offsets shaping a contour of `count` notes. */
std::vector<double> contour_offsets(const std::optional<MotifContour>& contour, std::size_t count) {
  std::vector<double> offsets;
  for (std::size_t i = 0; i < count; ++i) {
    double index = static_cast<double>(i);
    double last = static_cast<double>(count) - 1;
    if (!contour) {
      continue;
    }
    switch (*contour) {
      case MotifContour::kAscending:
        offsets.push_back(index);
        break;
      case MotifContour::kDescending:
        offsets.push_back(-index);
        break;
      case MotifContour::kArch:
        // Symmetric rise-and-fall: a palindrome that starts and ends on the tonic.
        offsets.push_back(js::min(index, last - index));
        break;
      case MotifContour::kWave: {
        static constexpr double kWave[] = {0, 1, 0, -1};
        offsets.push_back(kWave[i % 4]);
        break;
      }
    }
  }
  return offsets;
}

/** Reject a cell whose pitches have left the MIDI range. */
void assert_in_range(const std::vector<MotifResult>& notes) {
  for (const MotifResult& note : notes) {
    if (note.pitch < 0 || note.pitch > 127) {
      throw InvalidInputError("transformed motif pitch " + js::to_string(note.pitch) +
                              " is outside the MIDI range 0..127");
    }
  }
}

/** Scale a cell's timing about its origin by `factor`. */
std::vector<MotifResult> scale_time(const std::vector<NoteEvent>& notes,
                                    const std::vector<double>& pitches, double factor) {
  double origin = cell_origin(notes);
  std::vector<MotifResult> out;
  for (std::size_t i = 0; i < notes.size(); ++i) {
    out.push_back(MotifResult{pitches[i], origin + (notes[i].startBeat - origin) * factor,
                              notes[i].durationBeat * factor, std::nullopt});
  }
  return out;
}

/** The transform itself, before the range check. */
std::vector<MotifResult> transform_unchecked(const std::vector<NoteEvent>& notes,
                                             const std::vector<double>& pitches,
                                             MotifTransform transform, std::optional<double> amount,
                                             const std::optional<KeyScale>& key) {
  std::vector<MotifResult> out;
  switch (transform) {
    case MotifTransform::kTransposeChromatic: {
      double semis = amount.value_or(0);
      for (std::size_t i = 0; i < notes.size(); ++i) {
        out.push_back(
            MotifResult{pitches[i] + semis, notes[i].startBeat, notes[i].durationBeat, i});
      }
      return out;
    }
    case MotifTransform::kTransposeDiatonic: {
      double degrees = amount.value_or(1);
      for (std::size_t i = 0; i < notes.size(); ++i) {
        // With a key, shift by scale degrees; without one, shift chromatically.
        double pitch =
            key ? shift_by_scale_degrees(pitches[i], degrees, *key) : pitches[i] + degrees;
        out.push_back(MotifResult{pitch, notes[i].startBeat, notes[i].durationBeat, i});
      }
      return out;
    }
    case MotifTransform::kInvert: {
      double pivot = pivot_pitch(notes, pitches);
      for (std::size_t i = 0; i < notes.size(); ++i) {
        out.push_back(
            MotifResult{2 * pivot - pitches[i], notes[i].startBeat, notes[i].durationBeat, i});
      }
      return out;
    }
    case MotifTransform::kRetrograde: {
      if (notes.empty()) {
        return out;
      }
      double start = cell_origin(notes);
      double end = cell_end(notes);
      for (std::size_t i = 0; i < notes.size(); ++i) {
        out.push_back(MotifResult{pitches[i],
                                  start + (end - (notes[i].startBeat + notes[i].durationBeat)),
                                  notes[i].durationBeat, std::nullopt});
      }
      return out;
    }
    case MotifTransform::kAugment:
      return scale_time(notes, pitches, amount.value_or(2));
    case MotifTransform::kDiminish:
      return scale_time(notes, pitches, 1 / amount.value_or(2));
    case MotifTransform::kSequence: {
      double degrees = amount.value_or(2);
      double span = cell_span(notes);
      // Delegates to transposeDiatonic: diatonic with a key, otherwise by semitones.
      std::vector<MotifResult> copy =
          transform_notes(notes, pitches, MotifTransform::kTransposeDiatonic, degrees, key);
      for (std::size_t i = 0; i < notes.size(); ++i) {
        out.push_back(MotifResult{pitches[i], notes[i].startBeat, notes[i].durationBeat, i});
      }
      for (const MotifResult& note : copy) {
        out.push_back(
            MotifResult{note.pitch, note.startBeat + span, note.durationBeat, note.source});
      }
      return out;
    }
  }
  return out;
}

}  // namespace

const TimeSignature kMotifDefaultTs =
#include "generate/motif/default_ts.gen.inc"
    ;

std::string_view to_string(MotifTransform transform) {
  return kTransformNames[static_cast<std::size_t>(transform)];
}

std::optional<MotifTransform> parse_motif_transform(std::string_view name) {
  for (MotifTransform transform : MOTIF_TRANSFORMS) {
    if (to_string(transform) == name) {
      return transform;
    }
  }
  return std::nullopt;
}

std::vector<std::string_view> motif_transform_names() {
  return std::vector<std::string_view>(std::begin(kTransformNames), std::end(kTransformNames));
}

std::string_view to_string(MotifContour contour) {
  switch (contour) {
    case MotifContour::kArch:
      return "arch";
    case MotifContour::kAscending:
      return "ascending";
    case MotifContour::kDescending:
      return "descending";
    case MotifContour::kWave:
      return "wave";
  }
  return "arch";
}

std::optional<MotifContour> parse_motif_contour(std::string_view name) {
  for (MotifContour contour : {MotifContour::kArch, MotifContour::kAscending,
                               MotifContour::kDescending, MotifContour::kWave}) {
    if (to_string(contour) == name) {
      return contour;
    }
  }
  return std::nullopt;
}

double cell_span(const std::vector<NoteEvent>& notes) {
  if (notes.empty()) {
    return 0;
  }
  double start = cell_origin(notes);
  double end = cell_end(notes);
  return end - start;
}

void assert_transform_amount(MotifTransform transform, std::optional<double> amount) {
  if (amount) {
    assert_finite_number(*amount, "motif transform amount");
  }
  if ((transform == MotifTransform::kTransposeChromatic ||
       transform == MotifTransform::kTransposeDiatonic || transform == MotifTransform::kSequence) &&
      amount) {
    assert_integer(
        *amount,
        std::string(transform == MotifTransform::kTransposeChromatic ? "chromatic" : "diatonic") +
            " transform amount");
  }
  if ((transform == MotifTransform::kAugment || transform == MotifTransform::kDiminish) && amount &&
      *amount <= 0) {
    throw InvalidInputError("time transform amount must be positive");
  }
}

std::vector<MotifResult> transform_notes(const std::vector<NoteEvent>& notes,
                                         const std::vector<double>& pitches,
                                         MotifTransform transform, std::optional<double> amount,
                                         const std::optional<KeyScale>& key) {
  assert_transform_amount(transform, amount);
  // Every transform leaves through here, so this is where the result is put back into time order.
  std::vector<MotifResult> out = transform_unchecked(notes, pitches, transform, amount, key);
  in_time_order(out);
  assert_in_range(out);
  return out;
}

std::vector<MotifResult> develop_notes(const std::vector<NoteEvent>& notes,
                                       const std::vector<double>& pitches, const ChordAt& chord_at,
                                       const KeyScale& scale, double bars,
                                       const TimeSignature& meter) {
  double span = cell_span(notes);
  double bar_beats = beats_per_bar(meter);
  double total_beats = bars * bar_beats;
  double origin = cell_origin(notes);
  std::vector<MotifResult> out;

  if (span <= 0) {
    for (std::size_t i = 0; i < notes.size(); ++i) {
      out.push_back(MotifResult{pitches[i], notes[i].startBeat, notes[i].durationBeat, i});
    }
    in_time_order(out);
    return out;
  }

  // A degenerate near-zero span is clamped so the tile count stays finite, and the offset is
  // stepped multiplicatively so rounding error cannot accumulate over tiles.
  double tile_span = js::max(span, MOTIF_MIN_TILE_SPAN);
  double tile_count = std::ceil(total_beats / tile_span);
  assert_generation_budget(tile_count * static_cast<double>(notes.size()), "developed motif notes");
  for (double k = 0; k < tile_count; k += 1) {
    double offset = k * tile_span;
    // Placed pitch by cell pitch, so a tile cannot fold two of the cell's pitches onto one.
    std::map<double, double> taken;
    std::optional<double> previous;
    for (std::size_t note_index = 0; note_index < notes.size(); ++note_index) {
      const NoteEvent& n = notes[note_index];
      double cell_pitch = pitches[note_index];
      double start_beat = offset + (n.startBeat - origin);
      if (start_beat >= total_beats) {
        continue;
      }
      std::optional<ChordTones> chord = chord_at(start_beat);
      // The head of the cell and the bar lines are where the ear reads the harmony.
      bool structural = n.startBeat == origin || is_downbeat(start_beat, bar_beats);
      std::vector<int> chord_tones;
      bool use_chord = chord && structural;
      if (use_chord) {
        chord_tones = (*chord)();
      }
      std::function<bool(double)> allows = [&](double candidate) {
        if (use_chord) {
          return std::find(chord_tones.begin(), chord_tones.end(), pitch_class_of(candidate)) !=
                 chord_tones.end();
        }
        return is_scale_tone(candidate, scale);
      };
      double direction = previous ? cell_pitch - *previous : 0;
      double pitch = developed_pitch(cell_pitch, allows, direction, taken);
      taken[pitch] = cell_pitch;
      previous = cell_pitch;
      // A note that would run past the span is cut at its end.
      out.push_back(MotifResult{pitch, start_beat,
                                js::min(n.durationBeat, total_beats - start_beat), std::nullopt});
    }
  }
  in_time_order(out);
  return out;
}

std::vector<NoteEvent> result_notes(const std::vector<NoteEvent>& source,
                                    const std::vector<MotifResult>& results) {
  std::vector<NoteEvent> out;
  for (const MotifResult& result : results) {
    NoteEvent note;
    if (result.source) {
      note = source[*result.source];
    }
    note.pitch = static_cast<int>(result.pitch);
    note.startBeat = result.startBeat;
    note.durationBeat = result.durationBeat;
    out.push_back(note);
  }
  return out;
}

MotifCell generate_motif_with(const MotifPlan& plan, const ResolvedContext& ctx) {
  double total_beats = plan.bars * plan.barBeats;
  double note_count = js::max(3.0, plan.bars * 2);
  double beats_per_note = total_beats / note_count;
  double jitter_prob = ctx.ornament.value_or(0);
  Draw draw = ctx.part("motif");
  double tonic = pitch_class_of(plan.key.rootPc) + 60;
  std::vector<double> offsets = contour_offsets(plan.contour, static_cast<std::size_t>(note_count));

  MotifCell cell;
  for (double i = 0; i < note_count; i += 1) {
    // Opt-in, direction-balanced jitter: disabled by default so the contour is preserved exactly.
    double jitter = 0;
    if (draw.prob(jitter_prob, {std::string("jitter"), i})) {
      jitter = draw.prob(0.5, {std::string("direction"), i}) ? 1 : -1;
    }
    std::size_t at = static_cast<std::size_t>(i);
    double pitch =
        shift_by_scale_degrees(tonic, (at < offsets.size() ? offsets[at] : 0) + jitter, plan.key);
    double start_beat = i * beats_per_note;
    if (plan.chord && is_downbeat(start_beat, plan.barBeats)) {
      if (plan.unknownChordQuality) {
        throw InvalidInputError("Unknown chord quality: " + *plan.unknownChordQuality);
      }
      pitch = nearest_chord_tone(pitch, *plan.chord);
    }
    NoteEvent note;
    note.pitch = static_cast<int>(clamp_to_midi(pitch, "generated motif pitch"));
    note.startBeat = start_beat;
    note.durationBeat = beats_per_note;
    cell.notes.push_back(note);
  }
  return cell;
}

MotifCell generate_motif(const MotifOptions& opts) {
  MotifPlan plan;
  plan.contour = opts.contour.value_or(MotifContour::kArch);
  plan.bars = assert_positive_int(opts.bars, "motif bars");
  // The meter is read once, here: a motif is one repeated bar grid.
  plan.barBeats =
      beats_per_bar(meter_at(0, to_meter_data(opts.ts.value_or(MeterArg(kMotifDefaultTs)), "ts")));
  assert_generation_budget(js::max(3.0, plan.bars * 2), "motif notes");
  // The dial is handed over as it was given: `jitter` is sugar for the context's ornament dial.
  ResolvedContext ctx = resolve_context_with(opts.ctx, ContextSugar{opts.jitter});
  // Key and chord are read into their plain form once, here at the boundary.
  plan.key = to_key_scale(opts.key);
  if (opts.chord) {
    plan.chord = to_chord_data(*opts.chord);
  }
  return generate_motif_with(plan, ctx);
}

std::vector<double> note_pitches(const std::vector<NoteEvent>& notes) {
  std::vector<double> pitches;
  for (const NoteEvent& note : notes) {
    pitches.push_back(note.pitch);
  }
  return pitches;
}

std::vector<NoteEvent> motif_to_note_events(const MotifCell& cell) {
  assert_note_events(cell.notes, "motif cell notes");
  return cell.notes;
}

MotifCell transform_motif(const MotifCell& cell, MotifTransform transform,
                          std::optional<double> amount, const std::optional<KeyArg>& key) {
  // The key is read into its plain form once, here at the boundary.
  std::optional<KeyScale> scale;
  if (key) {
    scale = to_key_scale(*key);
  }
  assert_note_events(cell.notes, "motif notes");
  assert_transform_amount(transform, amount);
  return MotifCell{result_notes(
      cell.notes, transform_notes(cell.notes, note_pitches(cell.notes), transform, amount, scale))};
}

MotifCell develop_motif(const MotifCell& cell, const ChordTimeline& timeline, const KeyArg& key,
                        int bars, const MeterArg& ts) {
  TimeSignature meter = meter_at(0, to_meter_data(ts, "ts"));
  assert_chord_timeline(timeline);
  assert_positive_int(bars, "development bars");
  assert_note_events(cell.notes, "motif notes");
  KeyScale scale = to_key_scale(key);
  return MotifCell{result_notes(
      cell.notes, develop_notes(
                      cell.notes, note_pitches(cell.notes),
                      [&timeline](double beat) -> std::optional<ChordTones> {
                        Nullable<Chord> chord = timeline.at(beat);
                        if (!chord) {
                          return std::nullopt;
                        }
                        Chord held = *chord;
                        return ChordTones([held]() { return chord_pitch_classes(held); });
                      },
                      scale, bars, meter))};
}

}  // namespace cantus
