// The fill vocabulary of ts/src/generate/drums/fills.ts.

#include "generate/drums/fills.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <string_view>

#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/vocabulary/types.h"
#include "js/value.h"

namespace cantus {

namespace {

/** FILL_TYPES as names, indexed by FillType. */
constexpr std::array<std::string_view, FILL_TYPES.size()> kFillTypeNames =
#include "generate/drums/fill_types.gen.inc"
    ;
static_assert(!kFillTypeNames.back().empty(), "FILL_TYPES and FillType disagree");

/** FILL_VELOCITY_BASES as names, indexed by FillVelocityBase. */
constexpr std::array<std::string_view, static_cast<std::size_t>(FillVelocityBase::kAccent) + 1>
    kFillVelocityBaseNames =
#include "generate/drums/fill_velocity_bases.gen.inc"
    ;
static_assert(!kFillVelocityBaseNames.back().empty(),
              "FILL_VELOCITY_BASES and FillVelocityBase disagree");

/** A generated fill stroke, with its base and articulation still by name. */
struct FillStrokeRecord {
  int voice;
  double offset;
  double duration;
  struct {
    std::string_view base;
    std::optional<double> scale;
    std::optional<double> offset;
  } velocity;
  std::optional<std::string_view> articulation;
};

/** One FILL_ARCHETYPES row: an archetype's name and its strokes. */
struct FillArchetypeRow {
  std::string_view type;
  struct {
    std::vector<std::vector<FillStrokeRecord>> atBeat;
    std::optional<bool> boundToBar;
  } shape;
};

std::array<FillArchetype, FILL_TYPES.size()> make_fill_archetypes() {
  static const std::vector<FillArchetypeRow> rows =
#include "generate/drums/fill_archetypes.gen.inc"
      ;
  std::array<FillArchetype, FILL_TYPES.size()> out;
  for (const FillArchetypeRow& row : rows) {
    FillArchetype shape;
    for (const std::vector<FillStrokeRecord>& beat : row.shape.atBeat) {
      std::vector<FillStroke> strokes;
      for (const FillStrokeRecord& record : beat) {
        FillStroke stroke;
        stroke.voice = record.voice;
        stroke.offset = record.offset;
        stroke.duration = record.duration;
        stroke.velocity.base = *parse_fill_velocity_base(record.velocity.base);
        stroke.velocity.scale = record.velocity.scale;
        stroke.velocity.offset = record.velocity.offset;
        if (record.articulation) {
          stroke.articulation = *parse_articulation(*record.articulation);
        }
        strokes.push_back(stroke);
      }
      shape.atBeat.push_back(std::move(strokes));
    }
    shape.boundToBar = row.shape.boundToBar;
    out[static_cast<std::size_t>(*parse_fill_type(row.type))] = std::move(shape);
  }
  return out;
}

using FillTable = std::vector<std::string_view>;

/** The archetype table a transition reads from, by name (`fillTableFor`). */
const FillTable& fill_table_for(SectionType from, SectionType to, DrumStyle style,
                                SectionEnergy next_energy) {
  static const FillTable kSparse =
#include "generate/drums/sparse_fills.gen.inc"
      ;
  static const FillTable kLowEnergy =
#include "generate/drums/low_energy_fills.gen.inc"
      ;
  static const FillTable kToChorusHigh =
#include "generate/drums/to_chorus_high_fills.gen.inc"
      ;
  static const FillTable kToChorus =
#include "generate/drums/to_chorus_fills.gen.inc"
      ;
  static const FillTable kFromIntro =
#include "generate/drums/from_intro_fills.gen.inc"
      ;
  static const FillTable kGenericHigh =
#include "generate/drums/generic_high_fills.gen.inc"
      ;
  static const FillTable kGeneric =
#include "generate/drums/generic_fills.gen.inc"
      ;
  if (style == DrumStyle::kSparse) {
    return kSparse;
  }
  bool high_energy = style == DrumStyle::kRock || style == DrumStyle::kFourOnFloor;
  if (next_energy == SectionEnergy::kLow) {
    return kLowEnergy;
  }
  if (to == SectionType::kChorus) {
    return high_energy ? kToChorusHigh : kToChorus;
  }
  if (from == SectionType::kIntro) {
    return kFromIntro;
  }
  return high_energy ? kGenericHigh : kGeneric;
}

/** `FILL_ARCHETYPES[id] !== undefined`: a built-in name, or a member every object inherits. */
bool names_built_in(const std::string& id) {
  return parse_fill_type(id).has_value() || js::inherits_object_member(id);
}

/** The strokes a fill plays on one beat of the fill bar (`strokesAtBeat`). */
const std::vector<FillStroke>& strokes_at_beat(const FillArchetype& shape, double beat) {
  static const std::vector<FillStroke> kNone;
  double last_beat = static_cast<double>(shape.atBeat.size()) - 1;
  double index = beat > last_beat ? (shape.boundToBar.value_or(false) ? -1 : last_beat) : beat;
  if (index < 0 || index >= static_cast<double>(shape.atBeat.size())) {
    return kNone;
  }
  return shape.atBeat[static_cast<std::size_t>(index)];
}

}  // namespace

const std::array<FillArchetype, FILL_TYPES.size()> FILL_ARCHETYPES = make_fill_archetypes();

std::string_view to_string(FillType type) { return kFillTypeNames[static_cast<std::size_t>(type)]; }

std::optional<FillType> parse_fill_type(std::string_view name) {
  return parse_named<FillType>(kFillTypeNames, name);
}

std::string_view to_string(FillVelocityBase base) {
  return kFillVelocityBaseNames[static_cast<std::size_t>(base)];
}

std::optional<FillVelocityBase> parse_fill_velocity_base(std::string_view name) {
  return parse_named<FillVelocityBase>(kFillVelocityBaseNames, name);
}

std::vector<std::string_view> fill_velocity_base_names() {
  return names_of(kFillVelocityBaseNames);
}

void assert_fill_archetype(const FillArchetype& material, const std::string& label) {
  for (std::size_t beat = 0; beat < material.atBeat.size(); ++beat) {
    const std::vector<FillStroke>& strokes = material.atBeat[beat];
    for (std::size_t index = 0; index < strokes.size(); ++index) {
      std::string name = label + " atBeat[" + index_text(beat) + "][" + index_text(index) + "]";
      const FillStroke& stroke = strokes[index];
      assert_midi_pitch(stroke.voice, name + ".voice");
      assert_finite_number(stroke.offset, name + ".offset");
      assert_finite_number(stroke.duration, name + ".duration");
      if (stroke.velocity.scale) {
        assert_finite_number(*stroke.velocity.scale, name + ".velocity.scale");
      }
      if (stroke.velocity.offset) {
        assert_range(*stroke.velocity.offset, -127, 127, name + ".velocity.offset");
      }
    }
  }
}

bool is_fill_archetype(const std::any& material) {
  return std::any_cast<FillArchetype>(&material) != nullptr;
}

const FillArchetype* fill_archetype_for(const std::string& id, const SuppliedFills& supplied) {
  for (auto it = supplied.rbegin(); it != supplied.rend(); ++it) {
    if (it->first == id) {
      return &it->second;
    }
  }
  std::optional<FillType> type = parse_fill_type(id);
  return type ? &FILL_ARCHETYPES[static_cast<std::size_t>(*type)] : nullptr;
}

double get_fill_start_beat(SectionEnergy energy) {
  switch (energy) {
    case SectionEnergy::kLow:
      return 3;
    case SectionEnergy::kMedium:
      return 2;
    case SectionEnergy::kHigh:
      return 1;
    case SectionEnergy::kPeak:
      return 0;
  }
  return 2;
}

std::optional<std::string> select_fill_type(
    SectionType from, SectionType to, DrumStyle style, SectionEnergy next_energy, const Draw& draw,
    double bar, const std::vector<std::string>& extra,
    const std::function<bool(const std::string&)>& accepts) {
  const FillTable& table = fill_table_for(from, to, style, next_energy);
  // An id a built-in already carries replaces it rather than adding a second way to draw it.
  std::vector<std::string> offered(table.begin(), table.end());
  for (const std::string& id : extra) {
    if (!names_built_in(id)) {
      offered.push_back(id);
    }
  }
  std::vector<std::string> candidates;
  for (const std::string& id : offered) {
    if (accepts(id)) {
      candidates.push_back(id);
    }
  }
  if (candidates.empty()) {
    return std::nullopt;
  }
  std::int64_t index =
      draw.range(0, static_cast<std::int64_t>(candidates.size()) - 1, {"fill", bar});
  return candidates[static_cast<std::size_t>(index)];
}

bool fill_within_ceiling(const FillArchetype& shape, double from_beat, double bar_beats,
                         std::optional<double> bpm, std::optional<double> difficulty) {
  if (!difficulty || !bpm) {
    return true;
  }
  std::vector<std::pair<int, std::vector<double>>> by_voice;
  for (double beat = from_beat; beat < bar_beats; beat += 1) {
    for (const FillStroke& stroke : strokes_at_beat(shape, beat)) {
      auto voice = std::find_if(by_voice.begin(), by_voice.end(),
                                [&stroke](const auto& held) { return held.first == stroke.voice; });
      if (voice == by_voice.end()) {
        by_voice.emplace_back(stroke.voice, std::vector<double>{beat + stroke.offset});
      } else {
        voice->second.push_back(beat + stroke.offset);
      }
    }
  }
  for (auto& voice : by_voice) {
    std::vector<double>& positions = voice.second;
    std::stable_sort(positions.begin(), positions.end());
    for (std::size_t i = 1; i < positions.size(); ++i) {
      double gap = positions[i] - positions[i - 1];
      if (gap > 0 && !sustains_strokes(gap, bpm, difficulty)) {
        return false;
      }
    }
  }
  return true;
}

void generate_fill(HitList<DrumHit>& track, double beat_tick, double beat,
                   const FillArchetype& shape, double velocity,
                   const std::function<double(double)>& place) {
  const std::vector<FillStroke>& strokes = strokes_at_beat(shape, beat);
  double fill_vel = velocity * 0.9;
  // The stroke a fill lands on is the loudest thing in the bar.
  double accent_vel = velocity + BACKBEAT_LIFT + FILL_ACCENT_LIFT;
  for (const FillStroke& stroke : strokes) {
    double base = stroke.velocity.base == FillVelocityBase::kAccent ? accent_vel : fill_vel;
    double scaled = stroke.velocity.scale ? base * *stroke.velocity.scale : base;
    track.add(stroke.voice, place(beat_tick + stroke.offset), stroke.duration,
              scaled + stroke.velocity.offset.value_or(0), stroke.articulation);
  }
}

}  // namespace cantus
