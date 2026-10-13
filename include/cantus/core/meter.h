/**
 * @file meter.h
 * @brief Public C++ API of ts/src/core/meter: time signatures, meter maps and bar arithmetic.
 *
 * Positions and durations are quarter-note beats; beat 0 is the first downbeat, so a pickup sits
 * at negative beats. Bar indices and in-bar offsets are `double`: they are computed from
 * arbitrary finite beats and may leave every integer type.
 */
#ifndef CANTUS_CORE_METER_H_
#define CANTUS_CORE_METER_H_

#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"

namespace cantus {

/** A time signature: numerator over a note-value denominator, with an optional grouping. */
struct TimeSignature {
  int numerator = 0;
  int denominator = 0;
  /** Group lengths, in main pulses or (compound numerators) in denominator units. */
  std::optional<std::vector<int>> grouping;
};

/** One time signature and the beat at which it takes effect. */
struct MeterChange {
  double startBeat = 0;
  TimeSignature ts;
};

/** A piece's meter over time: the signatures in force, in strictly increasing beat order. */
using MeterMap = std::vector<MeterChange>;

/** One signature, or the map of a piece that changes meter (`MeterData`). */
using MeterData = std::variant<TimeSignature, MeterMap>;

/**
 * Anything that names a meter (`MeterLike`): a signature text such as "6/8", a TimeSignature,
 * a MeterMap, or any value whose `data()` returns one of those (the Meter class).
 */
class MeterArg {
 public:
  /** The forms a MeterArg holds. */
  using Value = std::variant<std::string, TimeSignature, MeterMap>;

  MeterArg(std::string text) : value_(std::move(text)) {}         // NOLINT
  MeterArg(std::string_view text) : value_(std::string(text)) {}  // NOLINT
  MeterArg(const char* text) : value_(std::string(text)) {}       // NOLINT
  MeterArg(TimeSignature ts) : value_(std::move(ts)) {}           // NOLINT
  MeterArg(MeterMap map) : value_(std::move(map)) {}              // NOLINT
  MeterArg(MeterData data)                                        // NOLINT
      : value_(std::holds_alternative<TimeSignature>(data)
                   ? Value(std::get<TimeSignature>(std::move(data)))
                   : Value(std::get<MeterMap>(std::move(data)))) {}
  /** A value whose `data()` returns meter data. */
  template <
      class T,
      std::enable_if_t<std::is_convertible_v<decltype(std::declval<const T&>().data()), MeterData>,
                       int> = 0>
  MeterArg(const T& value) : MeterArg(MeterData(value.data())) {}  // NOLINT

  /** The form this argument holds. */
  const Value& value() const noexcept { return value_; }

 private:
  Value value_;
};

/** A position as a 0-based bar index and a quarter-note offset within the bar. */
struct BarPosition {
  double bar = 0;
  double beat = 0;
};

/** Options of format_time_signature(). */
struct FormatTimeSignatureOptions {
  /** Render an additive grouping as "a+b+c/d". */
  std::optional<bool> grouping;
};

/** Options of resolve_meters(): the meter as `meters`, or as `ts` sugar for one signature. */
struct ResolveMetersOptions {
  std::optional<MeterArg> ts;
  std::optional<MeterArg> meters;
};

/**
 * Resolve any meter-shaped value to validated meter data (`toMeterData`).
 * @throws InvalidInputError if the value names no meter or the meter is malformed.
 */
MeterData to_meter_data(const MeterArg& value, std::string_view name = "meter");

/** Parse "4/4", "6/8" or the additive "2+2+3/8" (`parseTimeSignature`). */
TimeSignature parse_time_signature(std::string_view text);

/** parse_time_signature() reporting failure instead of throwing it (`tryParseTimeSignature`). */
ParseResult<TimeSignature> try_parse_time_signature(std::string_view text);

/** "n/d", or "a+b+c/d" when asked for a grouping text can spell (`formatTimeSignature`). */
std::string format_time_signature(const MeterArg& ts, const FormatTimeSignatureOptions& opts = {});

/** Whether the meter is compound (`isCompound`); a map reads as its opening signature. */
bool is_compound(const MeterArg& ts);

/** Bar length in quarter-note beats (`beatsPerBar`); a map reads as its opening signature. */
double beats_per_bar(const MeterArg& ts);

/** The time signature in force at a beat (`meterAt`). */
TimeSignature meter_at(double beat_in_quarters, const MeterArg& meter);

/** Beat at which the bar containing a beat begins (`barStartBeat`). */
double bar_start_beat(double beat_in_quarters, const MeterArg& meter);

/** 0-based bar index of a beat, negative inside a pickup (`barIndexAt`). */
double bar_index_at(double beat_in_quarters, const MeterArg& meter);

/** Length of the bar containing a beat, shortened by a meter change (`beatsPerBarAt`). */
double beats_per_bar_at(double beat_in_quarters, const MeterArg& meter);

/** The meter map named by `ts` or `meters`; 4/4 when neither is given (`resolveMeters`). */
MeterMap resolve_meters(const ResolveMetersOptions& opts, std::string_view name = "meters");

/** Main pulses (felt beats) per bar (`pulsesPerBar`). */
int pulses_per_bar(const MeterArg& ts);

/** Bar index and in-bar offset of an absolute beat (`beatToBarPosition`). */
BarPosition beat_to_bar_position(double beat_in_quarters, const MeterArg& meter);

/** Length of one main pulse in quarter-note beats (`pulseBeats`). */
double pulse_beats(const MeterArg& ts);

/** The 1-based felt-beat number of a bar position (`barPositionToPulse`). */
double bar_position_to_pulse(const BarPosition& pos, const MeterArg& meter);

/** "bar.beat" or "bar.beat+fraction", both 1-based (`formatBarPosition`). */
std::string format_bar_position(double beat_in_quarters, const MeterArg& meter, int decimals = 2);

/** Absolute beat of a bar position (`barPositionToBeat`). */
double bar_position_to_beat(const BarPosition& pos, const MeterArg& meter);

/** Metric weight 0..3 of a position (`metricWeight`). */
int metric_weight(double beat_in_quarters, const MeterArg& meter);

/** Whether a position weighs 2 or more (`isStrongBeat`). */
bool is_strong_beat(double beat_in_quarters, const MeterArg& meter);

/** `count` equal durations summing to `total_beats` (`tuplet`). */
std::vector<double> tuplet(double total_beats, int count);

}  // namespace cantus

#endif  // CANTUS_CORE_METER_H_
