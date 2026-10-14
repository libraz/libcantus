// How a melody note stands against a plan's harmony: ts/src/generate/plan/harmony.ts.

#include "generate/plan/harmony.h"

#include <algorithm>
#include <memory>
#include <string_view>

#include "analyze/keys/keys.h"
#include "cantus/analyze/voice.h"
#include "cantus/core/limits.h"
#include "cantus/theory/chord.h"
#include "generate/plan/internal.h"
#include "generate/plan/limits.gen.h"
#include "js/sort.h"

namespace cantus {

namespace {

/** A generated cadence-degrees row: the cadence's name and the scale degrees it closes on. */
struct CadenceDegreesRow {
  std::string_view cadence;
  std::vector<int> degrees;
};

const std::vector<CadenceDegreesRow> kCadenceDegrees =
#include "generate/plan/cadence_degrees.gen.inc"
    ;

constexpr std::string_view kHarmonyOkKinds[] =
#include "generate/plan/harmony_ok_kind_names.gen.inc"
    ;

bool harmony_ok(std::string_view kind) {
  return std::find(std::begin(kHarmonyOkKinds), std::end(kHarmonyOkKinds), kind) !=
         std::end(kHarmonyOkKinds);
}

}  // namespace

std::function<ResolvedKey(double)> plan_key_at(const CompositionPlan& plan) {
  auto regions = std::make_shared<std::vector<KeyRegion>>();
  std::vector<PlannedChord> ordered = plan.harmony;
  js::array_sort(ordered, [](const PlannedChord& a, const PlannedChord& b) {
    return a.startBeat - b.startBeat;
  });
  for (const PlannedChord& chord : ordered) {
    KeyRegion region;
    region.startBeat = chord.startBeat;
    region.endBeat = chord.endBeat;
    region.key = plan.keys[static_cast<std::size_t>(chord.key)];
    region.confidence = 1;
    regions->push_back(std::move(region));
  }
  auto lookup = std::make_shared<KeyLookup>(*regions, plan.keys.front());
  return [regions, lookup](double beat) { return (*lookup)(beat); };
}

std::optional<std::vector<int>> cadence_pitch_classes(const CompositionPlan& plan,
                                                      const ChordTimeline& timeline,
                                                      CadenceType cadence, double beat) {
  if (cadence == CadenceType::kDeceptive) {
    Nullable<Chord> chord = timeline.at(beat);
    if (!chord) {
      return std::nullopt;
    }
    return chord_pitch_classes(*chord);
  }
  const PlannedChord* entry = nullptr;
  for (const PlannedChord& chord : plan.harmony) {
    if (beat >= chord.startBeat && beat < chord.endBeat) {
      entry = &chord;
      break;
    }
  }
  std::vector<int> tones = scale_tones_in_degree_order(
      scale_of(plan.keys[entry != nullptr ? static_cast<std::size_t>(entry->key) : 0]));
  std::vector<int> allowed;
  for (const CadenceDegreesRow& row : kCadenceDegrees) {
    if (row.cadence == to_string(cadence)) {
      for (int degree : row.degrees) {
        if (degree >= 1 && static_cast<std::size_t>(degree) <= tones.size()) {
          allowed.push_back(tones[static_cast<std::size_t>(degree - 1)]);
        }
      }
    }
  }
  return allowed;
}

HarmonyMisfits plan_harmony_misfits(const CompositionPlan& plan, const ChordTimeline& timeline) {
  auto key_at = std::make_shared<std::function<ResolvedKey(double)>>(plan_key_at(plan));
  auto held = std::make_shared<ChordTimeline>(timeline);
  auto meters = std::make_shared<MeterMap>(plan.meters);
  return [key_at, held, meters](const std::vector<NoteEvent>& line) {
    KeyAtBeat scale_at = [key_at](double beat) { return scale_of((*key_at)(beat)); };
    std::vector<VoiceNote> voice;
    for (const NoteEvent& note : line) {
      VoiceNote read;
      static_cast<NoteEvent&>(read) = note;
      voice.push_back(std::move(read));
    }
    std::vector<AnalyzedNote> analyzed =
        analyze_voice(voice, [held](double beat) { return held->at(beat); }, KeyContext(scale_at));
    std::vector<std::optional<std::vector<std::string>>> out;
    for (std::size_t index = 0; index < line.size(); ++index) {
      const NoteEvent& note = line[index];
      PositionClass position = position_class(note.startBeat, *meters);
      if (position == PositionClass::kOff) {
        out.push_back(std::nullopt);
        continue;
      }
      std::vector<std::string> kinds;
      if (index < analyzed.size()) {
        for (const TheoryLabel& label : analyzed[index].labels) {
          kinds.emplace_back(to_string(label.kind));
        }
      }
      if (std::any_of(kinds.begin(), kinds.end(),
                      [](const std::string& kind) { return harmony_ok(kind); })) {
        out.push_back(std::nullopt);
        continue;
      }
      if (position == PositionClass::kWeak && is_scale_tone(note.pitch, scale_at(note.startBeat))) {
        out.push_back(std::nullopt);
        continue;
      }
      out.push_back(std::move(kinds));
    }
    return out;
  };
}

}  // namespace cantus
