// Auxiliary percussion of ts/src/generate/drums/percussion.ts.

#include "generate/drums/percussion.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

#include "js/math.h"

namespace cantus {

namespace {

/** One activation cell: tambourine, shaker, hand-clap (`PercActivation`). */
struct PercActivation {
  bool tambourine;
  bool shaker;
  bool handclap;
};

/** Percussion activation per mood category and section index (`PERC_TABLE`). */
const std::array<std::vector<PercActivation>,
                 static_cast<std::size_t>(PercMoodCategory::kRockDark) + 1>&
perc_table() {
  static const std::array<std::vector<PercActivation>,
                          static_cast<std::size_t>(PercMoodCategory::kRockDark) + 1>
      rows = {
#include "generate/drums/perc_table.gen.inc"
      };
  return rows;
}

/** Shaker velocity factors across a beat (`SHAKER_SIXTEENTH_CURVE`, `SHAKER_EIGHTH_CURVE`). */
const std::vector<double>& shaker_sixteenth_curve() {
  static const std::vector<double> curve =
#include "generate/drums/shaker_sixteenth_curve.gen.inc"
      ;
  return curve;
}

const std::vector<double>& shaker_eighth_curve() {
  static const std::vector<double> curve =
#include "generate/drums/shaker_eighth_curve.gen.inc"
      ;
  return curve;
}

double curve_at(const std::vector<double>& curve, double index, double fallback) {
  return index >= 0 && index < static_cast<double>(curve.size())
             ? curve[static_cast<std::size_t>(index)]
             : fallback;
}

}  // namespace

PercussionConfig get_percussion_config(PercMoodCategory mood, SectionType section) {
  const auto& table = perc_table();
  std::size_t row_index = static_cast<std::size_t>(mood);
  const std::vector<PercActivation>& row =
      row_index < table.size() ? table[row_index]
                               : table[static_cast<std::size_t>(PercMoodCategory::kStandard)];
  std::size_t column = static_cast<std::size_t>(section_index(section));
  PercActivation act = column < row.size() ? row[column] : PercActivation{false, false, false};
  return PercussionConfig{act.tambourine, act.shaker, act.handclap, act.shaker};
}

void generate_aux_percussion_for_bar(HitList<DrumHit>& track, double bar_start,
                                     const PercussionConfig& config, DrumRole role,
                                     double density_mult, const Draw& draw, double bpm,
                                     const SectionCtx& sec, double swing_amount, double bar_beats) {
  if (role == DrumRole::kMinimal) {
    return;
  }
  // Tambourine and hand-claps land where the section says the backbeat is.
  std::vector<double> backbeats = backbeat_beats(sec.snareBeat3, bar_beats);

  if (config.tambourine) {
    for (double beat : backbeats) {
      double raw = 70 * density_mult * draw.float_(0.9, 1.1, {"tambourine", bar_start, beat});
      track.add(kGm.TAMBOURINE, bar_start + beat, DRUM_EIGHTH, js::max(40, js::min(90, raw)));
    }
  }

  if (config.shaker) {
    bool use16th = config.shaker16th && bpm < HH_16TH_BPM_THRESHOLD &&
                   sustains_strokes(DRUM_SIXTEENTH, bpm, sec.difficulty);
    if (use16th) {
      const std::vector<double>& vel_curve = shaker_sixteenth_curve();
      for (double beat = 0; beat < bar_beats; beat += 1) {
        for (double sub = 0; sub < 4; sub += 1) {
          // The on-beat and mid-beat shakes carry the pattern; the two between are the dial's.
          if (std::fmod(sub, 2) == 1 &&
              !draw.prob(sec.rhythmic, {"shaker16", bar_start, beat, sub})) {
            continue;
          }
          double raw = 80 * curve_at(vel_curve, sub, 0.5) * density_mult *
                       draw.float_(0.9, 1.1, {"shaker", bar_start, beat, sub});
          track.add(kGm.SHAKER, swing16(bar_start + beat + sub * DRUM_SIXTEENTH, sec, swing_amount),
                    DRUM_SIXTEENTH, js::max(25, js::min(85, raw)));
        }
      }
    } else {
      const std::vector<double>& vel_curve = shaker_eighth_curve();
      for (double beat = 0; beat < bar_beats; beat += 1) {
        for (double sub = 0; sub < 2; sub += 1) {
          double raw = 80 * curve_at(vel_curve, sub, 0.6) * density_mult *
                       draw.float_(0.9, 1.1, {"shaker", bar_start, beat, sub});
          track.add(kGm.SHAKER, swing16(bar_start + beat + sub * DRUM_EIGHTH, sec, swing_amount),
                    DRUM_EIGHTH, js::max(25, js::min(85, raw)));
        }
      }
    }
  }

  if (config.handclap) {
    for (double beat : backbeats) {
      double raw = 85 * density_mult * draw.float_(0.9, 1.1, {"handclap", bar_start, beat});
      track.add(kGm.HANDCLAP, bar_start + beat, DRUM_EIGHTH, js::max(50, js::min(100, raw)));
    }
  }
}

}  // namespace cantus
