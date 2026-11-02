// Note values, dots and tuplets of ts/src/core/duration/index.ts.

#include "cantus/core/duration.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** A generated NOTE_VALUE_QUARTERS row. */
struct NamedQuarters {
  std::string_view name;
  double quarters;
};

/** A generated SPELLED_TUPLETS entry: no tuplet, or a ratio. */
struct TupletSlot {
  constexpr TupletSlot(std::nullopt_t) {}  // NOLINT
  constexpr TupletSlot(int actual_notes, int normal_notes)
      : present(true), actual(actual_notes), normal(normal_notes) {}
  bool present = false;
  int actual = 0;
  int normal = 0;
};

constexpr std::array<std::string_view, NOTE_VALUES.size()> kNoteValueNames = {
#include "core/duration/note_values.gen.inc"
};
static_assert(!kNoteValueNames.back().empty(), "NOTE_VALUES and NoteValue disagree");

constexpr std::array<NamedQuarters, NOTE_VALUES.size()> kNoteValueQuarters = {
#include "core/duration/note_value_quarters.gen.inc"
};
static_assert(!kNoteValueQuarters.back().name.empty(),
              "NOTE_VALUE_QUARTERS and NoteValue disagree");
static_assert(
    [] {
      for (std::size_t i = 0; i < kNoteValueQuarters.size(); ++i) {
        if (kNoteValueQuarters[i].name != kNoteValueNames[i]) {
          return false;
        }
      }
      return true;
    }(),
    "NOTE_VALUE_QUARTERS is not in NoteValue order");

constexpr std::array<TupletSlot, 4> kSpelledTuplets = {
#include "core/duration/spelled_tuplets.gen.inc"
};

/** Length of each base value in quarter notes (`NOTE_VALUE_QUARTERS[base]`). */
double base_quarters(NoteValue base) {
  return kNoteValueQuarters[static_cast<std::size_t>(base)].quarters;
}

/** Length in quarter notes of a base value with dots and an optional tuplet. */
double quarters_of_parts(NoteValue base, int dots, const std::optional<Tuplet>& tuplet) {
  double dotted = base_quarters(base) * (2 - js::pow(2, -dots));
  return tuplet ? (dotted * tuplet->normal) / tuplet->actual : dotted;
}

/** A tuplet read from a slot of SPELLED_TUPLETS. */
std::optional<Tuplet> tuplet_of(const TupletSlot& slot) {
  if (!slot.present) {
    return std::nullopt;
  }
  return Tuplet{slot.actual, slot.normal};
}

/** Validate a duration, accepting the bare base value as shorthand (`assertDuration`). */
DurationData assert_duration(const DurationArg& value, std::string_view name) {
  if (const auto* base = std::get_if<NoteValue>(&value.value())) {
    return DurationData{*base, 0, std::nullopt};
  }
  const auto& data = std::get<DurationData>(value.value());
  int dots = 0;
  if (data.dots) {
    dots = static_cast<int>(assert_integer(*data.dots, join_name(name, ".dots"), 0, MAX_DOTS));
  }
  if (!data.tuplet) {
    return DurationData{data.base, dots, std::nullopt};
  }
  Tuplet tuplet{static_cast<int>(assert_positive_int(
                    data.tuplet->actual, join_name(name, ".tuplet.actual"), MAX_TUPLET)),
                static_cast<int>(assert_positive_int(
                    data.tuplet->normal, join_name(name, ".tuplet.normal"), MAX_TUPLET))};
  return DurationData{data.base, dots, tuplet};
}

/** Length of a validated duration in quarter notes. */
double quarters_of(const DurationData& duration) {
  return quarters_of_parts(duration.base, duration.dots.value_or(0), duration.tuplet);
}

/** Length of the beat unit in quarter notes; a quarter note unless overridden. */
double beat_quarters(const DurationOptions& options) {
  if (!options.beatUnit) {
    return base_quarters(NoteValue::kQuarter);
  }
  return quarters_of(assert_duration(*options.beatUnit, "beatUnit"));
}

/** The conventional spelling of a length in quarter notes, if it has one. */
std::optional<SpelledDuration> spell_quarters(double quarters) {
  for (const TupletSlot& slot : kSpelledTuplets) {
    std::optional<Tuplet> tuplet = tuplet_of(slot);
    for (int dots = 0; dots <= MAX_SPELLED_DOTS; ++dots) {
      for (NoteValue base : NOTE_VALUES) {
        if (std::fabs(quarters_of_parts(base, dots, tuplet) - quarters) <= DURATION_EPS) {
          return SpelledDuration{base, dots, tuplet};
        }
      }
    }
  }
  return std::nullopt;
}

/** Require a positive, finite beat count. */
double assert_positive_beats(double beats, std::string_view name) {
  assert_finite_number(beats, name);
  if (beats <= 0) {
    throw InvalidInputError(std::string(name) + " must be positive; received " +
                            js::to_string(beats));
  }
  return beats;
}

}  // namespace

std::string_view to_string(NoteValue value) {
  return kNoteValueNames[static_cast<std::size_t>(value)];
}

std::optional<NoteValue> parse_note_value(std::string_view name) {
  for (std::size_t i = 0; i < kNoteValueNames.size(); ++i) {
    if (kNoteValueNames[i] == name) {
      return NOTE_VALUES[i];
    }
  }
  return std::nullopt;
}

double duration_to_beats(const DurationArg& duration, const DurationOptions& options) {
  double quarters = quarters_of(assert_duration(duration, "duration"));
  return quarters / beat_quarters(options);
}

SpelledDuration beats_to_duration(double beats, const DurationOptions& options) {
  assert_positive_beats(beats, "beats");
  std::optional<SpelledDuration> spelled = spell_quarters(beats * beat_quarters(options));
  if (!spelled) {
    throw NoSolutionError("no single note value spells " + js::to_string(beats) + " beats");
  }
  return *spelled;
}

std::vector<SpelledDuration> beats_to_tied_durations(double beats, const DurationOptions& options) {
  assert_positive_beats(beats, "beats");
  double quarters = beats * beat_quarters(options);
  if (std::optional<SpelledDuration> single = spell_quarters(quarters)) {
    return {*single};
  }
  assert_generation_budget(std::ceil(quarters / base_quarters(NoteValue::kWhole)) +
                               static_cast<double>(NOTE_VALUES.size()),
                           "tie chain length");
  std::vector<SpelledDuration> chain;
  double remaining = quarters;
  double previous_quarters = 0;
  while (remaining > DURATION_EPS) {
    // The undotted values a tie chain is built from, longest first.
    std::optional<NoteValue> next;
    for (NoteValue candidate : NOTE_VALUES) {
      if (base_quarters(candidate) <= remaining + DURATION_EPS) {
        next = candidate;
        break;
      }
    }
    if (!next) {
      throw NoSolutionError("no chain of tied note values sums to " + js::to_string(beats) +
                            " beats");
    }
    double next_quarters = base_quarters(*next);
    SpelledDuration* last = chain.empty() ? nullptr : &chain.back();
    const SpelledDuration* before = chain.size() < 2 ? nullptr : &chain[chain.size() - 2];
    // A value followed by exactly its own half is one dotted note, not a tie, as long as the
    // dotted result still fits under the value it is tied after.
    std::optional<double> dotted;
    if (last != nullptr && last->dots < MAX_SPELLED_DOTS) {
      dotted = quarters_of_parts(last->base, last->dots + 1, std::nullopt);
    }
    bool stays_in_order =
        dotted &&
        (before == nullptr ||
         *dotted <= quarters_of_parts(before->base, before->dots, before->tuplet) + DURATION_EPS);
    if (last != nullptr && stays_in_order &&
        std::fabs(next_quarters * 2 - previous_quarters) <= DURATION_EPS) {
      last->dots += 1;
    } else {
      chain.push_back(SpelledDuration{*next, 0, std::nullopt});
    }
    previous_quarters = next_quarters;
    remaining -= next_quarters;
  }
  return chain;
}

}  // namespace cantus
