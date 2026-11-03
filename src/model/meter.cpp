#include "cantus/model/meter.h"

#include <utility>

#include "model/shared.h"

namespace cantus {

Meter::Meter(const TimeSignature& ts) : ts_(copy_checked_time_signature(ts)) {}

Meter Meter::of(int numerator, int denominator, std::optional<std::vector<int>> grouping) {
  return Meter(TimeSignature{numerator, denominator, std::move(grouping)});
}

Meter Meter::parse(std::string_view text) { return Meter(parse_time_signature(text)); }

ParseResult<Meter> Meter::try_parse(std::string_view text) {
  ParseResult<TimeSignature> parsed = try_parse_time_signature(text);
  if (!parsed.ok()) {
    return parse_failure_of<Meter>(std::move(parsed));
  }
  return ParseResult<Meter>::success(Meter(parsed.value()));
}

Meter Meter::from_data(const TimeSignature& data) { return Meter(data); }

Meter Meter::from_json(const TimeSignature& data) { return Meter(data); }

bool Meter::is_compound() const { return cantus::is_compound(MeterArg(ts_)); }

double Meter::beats_per_bar() const { return cantus::beats_per_bar(MeterArg(ts_)); }

int Meter::pulses_per_bar() const { return cantus::pulses_per_bar(MeterArg(ts_)); }

double Meter::pulse_beats() const { return cantus::pulse_beats(MeterArg(ts_)); }

std::string Meter::format(const FormatTimeSignatureOptions& opts) const {
  return format_time_signature(MeterArg(ts_), opts);
}

int Meter::weight_at(double beat_in_quarters) const {
  return metric_weight(beat_in_quarters, MeterArg(ts_));
}

bool Meter::is_strong_beat(double beat_in_quarters) const {
  return cantus::is_strong_beat(beat_in_quarters, MeterArg(ts_));
}

BarPosition Meter::bar_position_at(double beat_in_quarters) const {
  return beat_to_bar_position(beat_in_quarters, MeterArg(ts_));
}

std::string Meter::format_position(double beat_in_quarters, int decimals) const {
  return format_bar_position(beat_in_quarters, MeterArg(ts_), decimals);
}

std::vector<double> Meter::tuplet(double total_beats, int count) const {
  return cantus::tuplet(total_beats, count);
}

bool Meter::equals(const Meter& other) const {
  return ts_.numerator == other.ts_.numerator && ts_.denominator == other.ts_.denominator &&
         ts_.grouping == other.ts_.grouping;
}

std::string Meter::to_string() const { return format(); }

}  // namespace cantus
