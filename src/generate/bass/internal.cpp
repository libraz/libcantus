// The placement rules of ts/src/generate/bass/internal.ts.

#include "generate/bass/internal.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"
#include "core/instrument/profile.h"
#include "core/validation/validation.h"
#include "generate/drums/internal.h"
#include "js/math.h"
#include "js/number.h"
#include "js/sort.h"
#include "theory/tendency/tendency.h"

namespace cantus {

double fold_into_band(double midi, double low) {
  double raised = midi + 12 * js::max(0.0, std::ceil((low - midi) / 12));
  return raised - 12 * js::max(0.0, std::ceil((raised - low - 12) / 12));
}

double place_pc(double pc, double anchor, double low) {
  return fold_into_band(pc + 12 * js::round((anchor - pc) / 12), low);
}

double place_above_bass(double pc, double bass_midi) {
  return fold_into_band(pc + 12 * js::round((bass_midi - pc) / 12), bass_midi);
}

double place_root(double pc, double low) { return low + pitch_class_of(pc - low); }

std::vector<BarTile> bar_tiles(double start_beat, double end_beat, const TimeSignature& ts) {
  double bar_beats = beats_per_bar(ts);
  std::vector<BarTile> tiles;
  for (double index = 0;; index += 1) {
    double tile_start = start_beat + index * bar_beats;
    if (tile_start >= end_beat - BEAT_EPS) {
      break;
    }
    tiles.push_back(BarTile{tile_start, js::min(tile_start + bar_beats, end_beat)});
  }
  return tiles;
}

double mid_bar_pulse(double bar_start, const TimeSignature& ts) {
  double pulse = pulse_beats(ts);
  return bar_start + std::floor((beats_per_bar(ts) / 2 + BEAT_EPS) / pulse) * pulse;
}

void assert_bass_segment_at(const std::vector<BassSegment>& segments, std::size_t index) {
  const BassSegment& segment = segments[index];
  std::string label = "segments[" + index_text(index) + "]";
  assert_range(segment.startBeat, 0, kMaxSafeInteger, label + ".startBeat");
  assert_range(segment.endBeat, 0, kMaxSafeInteger, label + ".endBeat");
  if (segment.endBeat <= segment.startBeat) {
    throw InvalidInputError(label + " must have a positive duration");
  }
  if (index > 0 && segment.startBeat < segments[index - 1].endBeat - BEAT_EPS) {
    throw InvalidInputError("bass segments must not overlap: segments " + index_text(index - 1) +
                            " and " + index_text(index) + " overlap");
  }
}

void assert_bass_segments(const std::vector<BassSegment>& segments) {
  for (std::size_t index = 0; index < segments.size(); ++index) {
    assert_bass_segment_at(segments, index);
  }
}

void sort_bass_segments(std::vector<BassSegment>& segments) {
  js::array_sort(segments, [](const BassSegment& a, const BassSegment& b) {
    return a.startBeat - b.startBeat;
  });
}

std::vector<int> chord_tone_pcs(const Chord& chord) {
  std::vector<int> pcs;
  for (double interval : chord.intervals) {
    int pc = pitch_class_of(chord.rootPc + interval);
    if (std::find(pcs.begin(), pcs.end(), pc) == pcs.end()) {
      pcs.push_back(pc);
    }
  }
  if (pcs.empty()) {
    pcs.push_back(pitch_class_of(chord.rootPc));
  }
  return pcs;
}

int bass_fifth_pc_of(const Chord& chord) {
  return fifth_pc_of(chord).value_or(pitch_class_of(chord.rootPc));
}

int bass_pc_of(const Chord& chord) { return pitch_class_of(chord.bassPc.value_or(chord.rootPc)); }

std::vector<int> bass_tone_cycle(const Chord& chord) {
  int bass = bass_pc_of(chord);
  std::vector<int> tones = chord_tone_pcs(chord);
  auto at = std::find(tones.begin(), tones.end(), bass);
  std::vector<int> cycle;
  if (at == tones.end()) {
    cycle.push_back(bass);
    cycle.insert(cycle.end(), tones.begin(), tones.end());
  } else {
    cycle.insert(cycle.end(), at, tones.end());
    cycle.insert(cycle.end(), tones.begin(), at);
  }
  return cycle;
}

std::vector<double> beat_positions(double start, double end, const TimeSignature& ts) {
  std::vector<double> positions;
  double bar_beats = beats_per_bar(ts);
  double pulse = pulse_beats(ts);
  double first_bar = std::floor(start / bar_beats);
  double last_bar = std::floor((end - BEAT_EPS) / bar_beats);
  for (double bar = first_bar; bar <= last_bar; bar += 1) {
    double bar_start = bar * bar_beats;
    double first_pulse = js::max(0.0, std::ceil((start - bar_start - BEAT_EPS) / pulse));
    for (double index = first_pulse;; index += 1) {
      double position = bar_start + index * pulse;
      if (position >= bar_start + bar_beats - BEAT_EPS || position >= end - BEAT_EPS) {
        break;
      }
      if (position >= start - BEAT_EPS) {
        positions.push_back(position);
      }
    }
  }
  // A segment shorter than a pulse still needs a bass note.
  if (positions.empty()) {
    positions.push_back(start);
  }
  return positions;
}

double band_floor(double low, const std::optional<StringedProfile>& instrument) {
  if (!instrument) {
    return low;
  }
  InstrumentRange range = instrument_range(*instrument);
  double dropped = low - 12 * js::max(0.0, std::ceil((low + 12 - range.high) / 12));
  return dropped + 12 * js::max(0.0, std::ceil((range.low - dropped) / 12));
}

namespace {

/** The neighbour of `target` on the side `dir` points to. */
double neighbor_on_side(double target, double dir, const KeyScale& key, bool chromatic) {
  double semitone = target + dir;
  if (chromatic) {
    return semitone;
  }
  double cand = nearest_scale_tone(target + dir * 2, key);
  double step = std::abs(cand - target);
  return step >= 1 && step <= 2 ? cand : semitone;
}

}  // namespace

double bass_approach_note(double target, double from, const KeyScale& key, bool chromatic) {
  double dir = from <= target ? -1 : 1;
  double near = neighbor_on_side(target, dir, key, chromatic);
  double far = neighbor_on_side(target, -dir, key, chromatic);
  if (is_midi_pitch(near) && near != from) {
    return near;
  }
  return is_midi_pitch(far) ? far : near;
}

BassRegister bass_register(const std::optional<InstrumentProfile>& named,
                           const std::optional<InstrumentProfileArg>& given, double octave) {
  BassRegister out;
  if (!given) {
    if (named) {
      if (const StringedProfile* stringed = std::get_if<StringedProfile>(&*named)) {
        out.instrument = *stringed;
      }
    }
  } else {
    out.instrument = to_stringed_profile(*given, "instrument");
  }
  out.low = band_floor(octave * 12 + 12, out.instrument);
  return out;
}

std::vector<BassSegment> read_bass_segments(const std::vector<BassSegmentArg>& timeline) {
  std::vector<BassSegment> segments;
  for (const BassSegmentArg& segment : timeline) {
    segments.push_back(
        BassSegment{segment.startBeat, segment.endBeat, to_chord_data(segment.chord)});
  }
  sort_bass_segments(segments);
  assert_bass_segments(segments);
  return segments;
}

double segments_end(const std::vector<BassSegment>& segments) {
  double end = -std::numeric_limits<double>::infinity();
  for (const BassSegment& seg : segments) {
    end = js::max(end, seg.endBeat);
  }
  return end;
}

double sounding_pitch(double placed, const std::optional<InstrumentProfile>& instrument) {
  if (!instrument) {
    return placed;
  }
  return fold_in(static_cast<int>(assert_midi_pitch(placed, "pitch")), *instrument);
}

double place_tone(double pc, double root_midi, double low, bool over_bass) {
  return over_bass ? place_above_bass(pc, root_midi) : place_pc(pc, root_midi, low);
}

}  // namespace cantus
