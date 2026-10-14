// The lick placement of ts/src/generate/bass/licks.ts.

#include "generate/bass/licks.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <utility>

#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "core/instrument/profile.h"
#include "core/validation/validation.h"
#include "generate/bass/degrees.h"
#include "generate/bass/internal.h"
#include "generate/bass/licks_data.h"
#include "generate/bass/limits.gen.h"
#include "generate/context/difficulty.h"
#include "generate/drums/vocabulary.h"
#include "generate/vocabulary/transform.h"
#include "js/math.h"

namespace cantus {

namespace {

/** A lick note as a grid model: the stream is the limb, else the voice. */
struct LickNoteModel {
  using Event = LickNote;
  using Velocity = double;
  using StreamKey = std::string;

  static double step(const LickNote& e) { return e.step; }
  static double velocity(const LickNote& e) { return e.velocity; }
  static double scaled(double v, double factor) { return v * factor; }
  static bool louder(double a, double b) { return a > b; }
  static std::string stream_text(const LickNote& e) {
    return e.limb ? *e.limb : (e.voice ? *e.voice : std::string());
  }
  static std::string stream_key(const LickNote& e) { return stream_text(e); }
  static bool same_stream(const std::string& a, const std::string& b) { return a == b; }
  static LickNote placed(const LickNote& e, double at) {
    LickNote out = e;
    out.step = at;
    return out;
  }
  static LickNote placed(const LickNote& e, double at, double v) {
    LickNote out = e;
    out.step = at;
    out.velocity = v;
    return out;
  }
};

/** The options deform reads when a lick is shaped: the density, the meter and the mute test. */
struct LickDeformPlan {
  const TimeSignature& ts;
  double density;
  std::optional<double> ornament_amount;

  FigureRate rate() const { return FigureRate::kStraight; }
  std::optional<double> rhythmic() const { return density; }
  TimeSignature signature() const { return ts; }
  std::optional<OrnamentRequest<LickNoteModel>> ornament() const {
    if (!ornament_amount) {
      return std::nullopt;
    }
    return OrnamentRequest<LickNoteModel>{
        [](const LickNote& e) { return e.articulation == Articulation::kMute; }, *ornament_amount};
  }
};

/** A note on its way into the line, before durations are measured from it. */
struct RawLickNote {
  double startBeat;
  double pitch;
  double velocity;
  std::optional<LickNote> note;
};

/** The figure a tile played, and where that tile began. */
struct PlayedTile {
  LickMaterial material;
  double tileStart;
};

/** The note carrying a position, if one is written there (the last one written). */
RawLickNote* sounding_at(std::vector<RawLickNote>& raw, double at) {
  for (std::size_t index = raw.size(); index > 0; --index) {
    RawLickNote& item = raw[index - 1];
    if (std::abs(item.startBeat - at) < BEAT_EPS) {
      return &item;
    }
  }
  return nullptr;
}

/** The last onset the figure itself states between two positions, if any. */
std::optional<double> material_onset_in(const std::optional<PlayedTile>& played, double from,
                                        double to) {
  if (!played) {
    return std::nullopt;
  }
  std::optional<double> last;
  for (const LickNote& note : played->material.notes) {
    double at = played->tileStart + note.step * STEP_BEATS;
    if (at < from - BEAT_EPS || at > to - BEAT_EPS) {
      continue;
    }
    last = last ? js::max(*last, at) : at;
  }
  return last;
}

/** The pitch the line is coming from at a position. */
double last_pitch_before(const std::vector<RawLickNote>& raw, double at, double fallback) {
  for (std::size_t index = raw.size(); index > 0; --index) {
    const RawLickNote& item = raw[index - 1];
    if (item.startBeat < at - BEAT_EPS) {
      return item.pitch;
    }
  }
  return fallback;
}

/** The step a figure begins on, which is where the segment sounds its root. */
double anchor_step_of(const LickMaterial& material, double span_beats) {
  std::optional<double> first;
  for (const LickNote& note : material.notes) {
    if (!first || note.step < *first) {
      first = note.step;
    }
  }
  if (!first || *first < 0 || *first * STEP_BEATS >= span_beats - BEAT_EPS) {
    return 0;
  }
  return *first;
}

/** Deform a figure to the segment it is played over, and reject it beyond the ceiling. */
std::optional<std::vector<LickNote>> fit_to_segment(const LickMaterial& material, double span_beats,
                                                    double density, const ResolvedContext& resolved,
                                                    const Draw& draw, double index, double tile,
                                                    double bpm, std::optional<double> difficulty,
                                                    const TimeSignature& ts) {
  double span = assert_span_steps(material.lengthSteps);
  LickDeformPlan plan{ts, density, resolved.ornament};
  std::vector<LickNote> deformed = deform_figure<LickNoteModel>(
      material.notes, span, plan, BoundSampler{draw, {std::string("lickShape"), index, tile}});
  // A figure longer than the chord it is played over is cut at the chord change.
  double span_steps = span_beats / STEP_BEATS;
  std::vector<LickNote> inside;
  for (const LickNote& note : deformed) {
    if (note.step < span_steps - BEAT_EPS) {
      inside.push_back(note);
    }
  }
  if (inside.empty() ||
      (difficulty && !figure_within_ceiling<LickNoteModel>(inside, bpm, *difficulty))) {
    return std::nullopt;
  }
  return inside;
}

}  // namespace

double estimated_lick_bars(const std::vector<BassSegment>& segments, const TimeSignature& ts) {
  double bar_beats = beats_per_bar(ts);
  double count = 0;
  for (const BassSegment& segment : segments) {
    count += js::max(1.0, std::ceil((segment.endBeat - segment.startBeat) / bar_beats));
  }
  return count;
}

std::vector<NoteEvent> place_licks_with(const LickRequest& request,
                                        const ResolvedContext& resolved) {
  const std::vector<BassSegment>& segments = request.segments;
  const TimeSignature& ts = request.ts;
  Draw draw = resolved.part("bass");
  double bpm = resolved.bpm.value_or(LICK_DEFAULT_BPM);
  double density = resolved.rhythmic.value_or(LICK_DEFAULT_DENSITY);
  std::optional<double> difficulty = resolved.difficulty ? resolved.difficulty : request.difficulty;
  double low = request.low;

  std::vector<BassLick> caller_licks = vocabulary_of_kind<LickMaterial>(resolved.vocabulary);
  for (std::size_t index = 0; index < caller_licks.size(); ++index) {
    assert_lick_material(caller_licks[index].material,
                         "lick vocabulary[" + index_text(index) + "]");
  }
  std::vector<BassLick> dictionary = merge_vocabulary(BASS_LICKS, std::make_optional(caller_licks));
  std::optional<InstrumentProfile> instrument;
  if (request.instrument) {
    instrument = InstrumentProfile(*request.instrument);
  }

  std::vector<RawLickNote> raw;
  for (std::size_t index = 0; index < segments.size(); ++index) {
    const BassSegment& segment = segments[index];
    double segment_index = static_cast<double>(index);
    int root_pc = bass_pc_of(segment.chord);
    // Where this chord sounds its bass note, and what its quality settles about the degrees it
    // does not state: both are properties of the chord, so both are read once per segment.
    double root_midi = place_root(root_pc, low);
    const LickQuality* quality = request.qualities.empty() ? nullptr : &request.qualities[index];
    std::optional<std::vector<int>> implied = implied_scale_tones(
        segment.chord, quality != nullptr && quality->unknown ? &*quality->unknown : nullptr);
    bool last_tile_played = false;
    std::optional<PlayedTile> played_tile;
    double first_onset = segment.startBeat;

    std::vector<BarTile> tiles = bar_tiles(segment.startBeat, segment.endBeat, ts);
    for (std::size_t tile = 0; tile < tiles.size(); ++tile) {
      double tile_index = static_cast<double>(tile);
      double tile_start = tiles[tile].startBeat;
      double remaining = segment.endBeat - tile_start;
      // The figure this tile would play is decided before the density dial is consulted.
      VocabularyQuery query;
      query.genre = request.genre;
      query.bpm = bpm;
      query.ts = MeterArg(ts);
      query.difficulty = difficulty;
      if (quality == nullptr || (!quality->absent && !quality->foreign)) {
        query.quality = segment.chord.quality;
      }
      if (instrument) {
        query.articulations = request.instrument->articulations;
      }
      SeedPath choice_path{std::string("lickChoice"), segment_index, tile_index};
      std::optional<BassLick> entry;
      if (quality != nullptr && quality->foreign) {
        // A quality no figure names fits only the figures that name none.
        detail::check_pick(draw, choice_path);
        std::vector<BassLick> fitting;
        for (const BassLick& candidate : select_vocabulary(dictionary, query)) {
          if (!candidate.fitsOver) {
            fitting.push_back(candidate);
          }
        }
        if (!fitting.empty()) {
          entry = fitting[detail::pick_index(fitting.size(), draw, choice_path)];
        }
      } else {
        entry = pick_vocabulary(dictionary, query, draw, choice_path);
      }
      bool takes_lick =
          entry && draw.prob(density, {std::string("lick"), segment_index, tile_index});
      std::optional<std::vector<LickNote>> notes;
      if (takes_lick) {
        notes = fit_to_segment(entry->material, remaining, density, resolved, draw, segment_index,
                               tile_index, bpm, difficulty, ts);
      }
      last_tile_played = notes.has_value();
      if (notes && entry) {
        played_tile = PlayedTile{entry->material, tile_start};
      }

      double root_step = entry ? anchor_step_of(entry->material, remaining) : 0;
      double root_at = tile_start + root_step * STEP_BEATS;
      if (tile == 0) {
        first_onset = root_at;
      }
      // Where the figure states its own note on this position, that note is the one that sounds.
      raw.push_back(RawLickNote{root_at, root_midi, BASS_STRONG_VELOCITY, std::nullopt});

      if (notes) {
        // Over a slash chord the figure is written above the bass the chord names.
        double figure_root =
            !segment.chord.bassPc
                ? place_pc(pitch_class_of(segment.chord.rootPc), root_midi, low)
                : place_above_bass(pitch_class_of(segment.chord.rootPc), root_midi);
        for (const LickNote& lick_note : *notes) {
          double at = tile_start + lick_note.step * STEP_BEATS;
          double alter = lick_note.alter.value_or(0);
          double offset =
              degree_semitone(lick_note.degree, alter, segment.chord, request.scale, implied);
          double pitch = std::abs(at - root_at) < BEAT_EPS && lick_note.degree == 1 && alter == 0
                             ? root_midi
                             : figure_root + offset;
          double velocity =
              js::round((is_strong_beat(at, ts) ? BASS_STRONG_VELOCITY : BASS_WEAK_VELOCITY) *
                        lick_note.velocity);
          raw.push_back(RawLickNote{at, pitch, velocity, lick_note});
        }
      }
    }

    // The connecting tone between one figure and the next is the walking line's approach note.
    const BassSegment* next = index + 1 < segments.size() ? &segments[index + 1] : nullptr;
    if (next != nullptr && last_tile_played) {
      double last_beat = next->startBeat - STEP_BEATS * BEAT_STEPS;
      double approach_at =
          material_onset_in(played_tile, last_beat, next->startBeat).value_or(last_beat);
      if (approach_at > first_onset + BEAT_EPS) {
        double next_root = place_root(bass_pc_of(next->chord), low);
        RawLickNote* occupied = sounding_at(raw, approach_at);
        double distance = occupied == nullptr ? 0 : std::abs(occupied->pitch - next_root);
        if (occupied == nullptr || distance < 1 || distance > 2) {
          double from = last_pitch_before(raw, approach_at, root_midi);
          double midi =
              bass_approach_note(next_root, from, request.scale,
                                 draw.prob(0.5, {std::string("lickApproach"), segment_index}));
          if (occupied == nullptr) {
            raw.push_back(RawLickNote{approach_at, midi, BASS_WEAK_VELOCITY, std::nullopt});
          } else {
            occupied->pitch = midi;
          }
        }
      }
    }
  }

  std::stable_sort(raw.begin(), raw.end(), [](const RawLickNote& a, const RawLickNote& b) {
    return a.startBeat < b.startBeat;
  });
  double last_end = -std::numeric_limits<double>::infinity();
  for (const BassSegment& seg : segments) {
    last_end = js::max(last_end, seg.endBeat);
  }
  std::vector<NoteEvent> out;
  for (std::size_t i = 0; i < raw.size(); ++i) {
    const RawLickNote& item = raw[i];
    double next_start = i + 1 < raw.size() ? raw[i + 1].startBeat : last_end;
    double length = std::numeric_limits<double>::infinity();
    if (item.note && item.note->lengthSteps) {
      length = *item.note->lengthSteps * STEP_BEATS;
    }
    double duration_beat = js::min(next_start - item.startBeat, length);
    if (duration_beat <= BEAT_EPS) {
      continue;
    }
    double placed = item.pitch;
    if (instrument) {
      placed = fold_in(static_cast<int>(assert_midi_pitch(item.pitch, "pitch")), *instrument);
    }
    NoteEvent event;
    event.pitch = static_cast<int>(clamp_to_midi(placed, "generated bass pitch"));
    event.startBeat = item.startBeat;
    event.durationBeat = duration_beat;
    event.velocity = static_cast<int>(js::max(1.0, js::min(127.0, item.velocity)));
    if (item.note && item.note->articulation) {
      event.articulation = item.note->articulation;
    }
    out.push_back(event);
  }
  return out;
}

std::vector<NoteEvent> place_licks(const std::vector<BassSegmentArg>& timeline, const KeyArg& key,
                                   const PlaceLicksOptions& opts) {
  assert_generation_budget(static_cast<double>(timeline.size()), "lick segments", opts.budget);
  LickRequest request;
  request.genre = opts.genre;
  request.ts = meter_at(0, to_meter_data(opts.ts.value_or(MeterArg(kBassDefaultTs)), "ts"));
  double octave = opts.octave.value_or(BASS_DEFAULT_OCTAVE);
  assert_integer(octave, "lick octave", -1, 8);
  // Key and chords are read into their plain form once, here at the boundary.
  request.scale = to_key_scale(key);
  std::vector<BassSegment> segments;
  for (const BassSegmentArg& segment : timeline) {
    segments.push_back(
        BassSegment{segment.startBeat, segment.endBeat, to_chord_data(segment.chord)});
  }
  sort_bass_segments(segments);
  assert_bass_segments(segments);
  if (segments.empty()) {
    return {};
  }
  assert_generation_budget(estimated_lick_bars(segments, request.ts), "lick bars", opts.budget);
  ResolvedContext resolved = resolve_context(opts.ctx);
  // The caller's own ceiling is checked whether or not the context also names one.
  if (opts.difficulty) {
    request.difficulty = assert_difficulty(*opts.difficulty, "lick difficulty");
  }
  BassRegister register_ = bass_register(resolved.instrument("bass"), opts.instrument, octave);
  request.instrument = register_.instrument;
  request.low = register_.low;
  request.segments = std::move(segments);
  return place_licks_with(request, resolved);
}

}  // namespace cantus
