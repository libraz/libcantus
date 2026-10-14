/**
 * @file duration.h
 * @brief Public C++ API of ts/src/core/duration: note values, dots and tuplets, and their
 *        lengths in beats.
 *
 * Beats are quarter notes unless a beat unit says otherwise.
 */
#ifndef CANTUS_CORE_DURATION_H_
#define CANTUS_CORE_DURATION_H_

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

namespace cantus {

/** A base note value (`NoteValue`). */
enum class NoteValue : std::uint8_t {
  kWhole,
  kHalf,
  kQuarter,
  kEighth,
  kSixteenth,
  kThirtySecond,
  kSixtyFourth,
};

/** Every note value, longest first (`NOTE_VALUES`). */
inline constexpr std::array<NoteValue, 7> NOTE_VALUES = {
    NoteValue::kWhole,     NoteValue::kHalf,         NoteValue::kQuarter,    NoteValue::kEighth,
    NoteValue::kSixteenth, NoteValue::kThirtySecond, NoteValue::kSixtyFourth};

/** The TS name of a note value ("whole", ..., "sixtyFourth"). */
std::string_view to_string(NoteValue value);

/** The note value named `name`, or nullopt. */
std::optional<NoteValue> parse_note_value(std::string_view name);

/** A tuplet ratio: `actual` notes written in the time of `normal` (`Tuplet`). */
struct Tuplet {
  int actual = 0;
  int normal = 0;
};

/** A duration as a caller writes it (`DurationData`). */
struct DurationData {
  NoteValue base = NoteValue::kQuarter;
  /** Augmentation dots; up to four are accepted. */
  std::optional<int> dots;
  std::optional<Tuplet> tuplet;
};

/** A duration as the library spells one (`SpelledDuration`). */
struct SpelledDuration {
  NoteValue base = NoteValue::kQuarter;
  int dots = 0;
  std::optional<Tuplet> tuplet;
};

/** A bare base value or a full duration (`NoteValue | DurationData`). */
class DurationArg {
 public:
  DurationArg(NoteValue base) : value_(base) {}                // NOLINT
  DurationArg(DurationData data) : value_(std::move(data)) {}  // NOLINT
  DurationArg(const SpelledDuration& spelled)                  // NOLINT
      : value_(DurationData{spelled.base, spelled.dots, spelled.tuplet}) {}
  /** A value whose `data()` returns a spelled duration (the Duration class). */
  template <class T,
            std::enable_if_t<!std::is_same_v<std::decay_t<T>, DurationData> &&
                                 !std::is_same_v<std::decay_t<T>, SpelledDuration> &&
                                 std::is_convertible_v<decltype(std::declval<const T&>().data()),
                                                       SpelledDuration>,
                             int> = 0>
  DurationArg(const T& value) : DurationArg(SpelledDuration(value.data())) {}  // NOLINT

  /** The form this argument holds. */
  const std::variant<NoteValue, DurationData>& value() const noexcept { return value_; }

 private:
  std::variant<NoteValue, DurationData> value_;
};

/** Options of the duration conversions. */
struct DurationOptions {
  /** The length of one beat; a quarter note when absent. */
  std::optional<DurationArg> beatUnit;
};

/**
 * Length of a duration in beats (`durationToBeats`).
 * @throws InvalidInputError if the duration is malformed.
 */
double duration_to_beats(const DurationArg& duration, const DurationOptions& options = {});

/**
 * The single note value spelling a length in beats (`beatsToDuration`).
 * @throws InvalidInputError if `beats` is not positive and finite.
 * @throws NoSolutionError if no single note value spells it.
 */
SpelledDuration beats_to_duration(double beats, const DurationOptions& options = {});

/**
 * A chain of tied note values summing to a length in beats (`beatsToTiedDurations`).
 * @throws BudgetExceededError if the chain would be too long.
 */
std::vector<SpelledDuration> beats_to_tied_durations(double beats,
                                                     const DurationOptions& options = {});

}  // namespace cantus

#endif  // CANTUS_CORE_DURATION_H_
