// Meter and time signatures of ts/src/core/meter/index.ts.

#include "core/meter/meter.h"

#include <cmath>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/validation.h"
#include "core/errors/errors.h"
#include "core/meter/internal.h"
#include "core/meter/limits.gen.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"

namespace cantus {

namespace {

/** The meter assumed when a caller names none (`DEFAULT_TS`). */
const TimeSignature kDefaultTs =
#include "core/meter/default_ts.gen.inc"
    ;

std::string num(double x) { return js::to_string(x); }

std::string join(const std::vector<int>& values, std::string_view separator) {
  std::string out;
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i > 0) {
      out += separator;
    }
    out += num(values[i]);
  }
  return out;
}

bool is_meter_map(const MeterData& data) { return std::holds_alternative<MeterMap>(data); }

/** Whether `value` is a whole multiple of `unit`, within BEAT_EPS. */
bool is_multiple(double value, double unit) {
  if (unit == 0) {
    return false;
  }
  double ratio = value / unit;
  return std::fabs(ratio - js::round(ratio)) < BEAT_EPS;
}

/** A code unit `\s` matches. */
bool is_js_space(char16_t c) {
  return (c >= 0x09 && c <= 0x0D) || c == 0x20 || c == 0xA0 || c == 0x1680 ||
         (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F ||
         c == 0x3000 || c == 0xFEFF;
}

bool is_ascii_digit(char16_t c) { return c >= u'0' && c <= u'9'; }

/** `Number.parseInt(token.trim(), 10)` of a run of `\d` between `\s`. */
double parse_token(std::u16string_view token) {
  std::size_t begin = 0;
  std::size_t end = token.size();
  while (begin < end && is_js_space(token[begin])) {
    ++begin;
  }
  while (end > begin && is_js_space(token[end - 1])) {
    --end;
  }
  return js::parse_int(js::from_utf16(token.substr(begin, end - begin)), 10);
}

/**
 * The reading both parsers share: `^\s*((?:\d+\s*\+\s*)*\d+)\s*\/\s*(\d+)\s*$`, then the
 * signature checks; throws on anything it cannot read.
 */
TimeSignature read_time_signature(std::string_view text) {
  InvalidInputError invalid("Invalid time signature: " + std::string(text));
  std::u16string u = js::to_utf16(text);
  std::size_t i = 0;
  auto skip_space = [&] {
    while (i < u.size() && is_js_space(u[i])) {
      ++i;
    }
  };
  auto digits = [&] {
    std::size_t start = i;
    while (i < u.size() && is_ascii_digit(u[i])) {
      ++i;
    }
    return i > start;
  };
  skip_space();
  std::size_t group_begin = i;
  if (!digits()) {
    throw invalid;
  }
  while (true) {
    std::size_t before = i;
    skip_space();
    if (i < u.size() && u[i] == u'+') {
      ++i;
      skip_space();
      if (!digits()) {
        throw invalid;
      }
      continue;
    }
    i = before;
    break;
  }
  std::size_t group_end = i;
  skip_space();
  if (i >= u.size() || u[i] != u'/') {
    throw invalid;
  }
  ++i;
  skip_space();
  std::size_t denominator_begin = i;
  if (!digits()) {
    throw invalid;
  }
  std::size_t denominator_end = i;
  skip_space();
  if (i != u.size()) {
    throw invalid;
  }

  std::vector<double> tokens;
  std::u16string_view group(u.data() + group_begin, group_end - group_begin);
  std::size_t from = 0;
  while (true) {
    std::size_t plus = group.find(u'+', from);
    tokens.push_back(parse_token(group.substr(from, plus - from)));
    if (plus == std::u16string_view::npos) {
      break;
    }
    from = plus + 1;
  }
  double numerator = 0;
  for (double t : tokens) {
    numerator += t;
  }
  double denominator = parse_token(
      std::u16string_view(u.data() + denominator_begin, denominator_end - denominator_begin));
  if (!is_safe_integer(numerator) || !is_safe_integer(denominator) || numerator <= 0 ||
      denominator <= 0) {
    throw invalid;
  }
  // assertTimeSignature(ts, `time signature ${text}`) on the parsed numbers, which may not fit an
  // int until the checks have bounded them.
  std::string name = "time signature " + std::string(text);
  assert_positive_int(numerator, name + ".numerator");
  assert_positive_int(denominator, name + ".denominator");
  TimeSignature ts{static_cast<int>(numerator), static_cast<int>(denominator), std::nullopt};
  if (tokens.size() > 1) {
    double sum = 0;
    std::vector<int> grouping;
    for (std::size_t k = 0; k < tokens.size(); ++k) {
      sum += assert_positive_int(tokens[k], name + ".grouping[" + index_text(k) + "]");
      grouping.push_back(static_cast<int>(tokens[k]));
    }
    assert_grouping_sum(numerator, sum, name);
    ts.grouping = std::move(grouping);
  }
  return ts;
}

/** The signature in force at a beat of resolved meter data (`meterAtChecked`). */
const TimeSignature& meter_at_checked(double beat, const MeterData& meter) {
  if (const auto* ts = std::get_if<TimeSignature>(&meter)) {
    return *ts;
  }
  const MeterMap& map = std::get<MeterMap>(meter);
  return map[entry_index_of(map, beat)].ts;
}

/** The single signature a meter names; a map reads as its opening one (`readSignature`). */
TimeSignature read_signature(const MeterArg& value, std::string_view name) {
  MeterData resolved = read_meter_data(value, name);
  return meter_at_checked(0, resolved);
}

double bar_start_checked(double beat, const MeterData& meter) {
  if (const auto* map = std::get_if<MeterMap>(&meter)) {
    return bar_start_of(*map, beat);
  }
  double bar_len = bar_beats_of(std::get<TimeSignature>(meter));
  return std::floor(beat / bar_len + BEAT_EPS) * bar_len;
}

double bar_index_checked(double beat, const MeterData& meter) {
  if (const auto* map = std::get_if<MeterMap>(&meter)) {
    return bar_index_of(*map, beat);
  }
  return std::floor(beat / bar_beats_of(std::get<TimeSignature>(meter)) + BEAT_EPS);
}

BarPosition bar_position_checked(double beat, const MeterData& meter) {
  return BarPosition{bar_index_checked(beat, meter), beat - bar_start_checked(beat, meter)};
}

/** The signature governing a bar index (`meterAtBarChecked`). */
const TimeSignature& meter_at_bar_checked(double bar, const MeterData& meter) {
  if (const auto* map = std::get_if<MeterMap>(&meter)) {
    assert_finite_number(bar, "position.bar");
    return meter_at_checked(beat_of_bar_index(*map, bar), meter);
  }
  return std::get<TimeSignature>(meter);
}

double pulse_checked(const BarPosition& pos, const MeterData& meter) {
  return pos.beat / pulse_beats_of(meter_at_bar_checked(pos.bar, meter)) + 1;
}

/** Whether `pulse_index` is the head pulse of one of the groups. */
bool is_group_head(const std::vector<double>& grouping, double pulse_index) {
  double acc = 0;
  for (double g : grouping) {
    if (acc == pulse_index) {
      return true;
    }
    acc += g;
  }
  return false;
}

/** Whether every group is the same length. */
bool is_uniform_grouping(const std::vector<double>& grouping) {
  for (double entry : grouping) {
    if (entry != grouping[0]) {
      return false;
    }
  }
  return true;
}

/** The longest step both lengths are a whole number of (`commonStep`). */
double common_step(double a, double b) {
  double longer = js::max(a, b);
  double shorter = js::min(a, b);
  for (int i = 0; i < 8 && shorter > BEAT_EPS; ++i) {
    double remainder = longer - std::floor(longer / shorter + BEAT_EPS) * shorter;
    longer = shorter;
    shorter = remainder > BEAT_EPS ? remainder : 0;
  }
  double smallest = a > 0 && b > 0 ? js::min(a, b) : js::max(a, b);
  return longer > BEAT_EPS && longer <= smallest + BEAT_EPS ? longer : smallest;
}

}  // namespace

MeterData read_meter_data(const MeterArg& value, std::string_view name) {
  const MeterArg::Value& v = value.value();
  if (const auto* text = std::get_if<std::string>(&v)) {
    ParseResult<TimeSignature> parsed = try_parse_time_signature(*text);
    if (parsed.ok()) {
      return std::move(parsed).value();
    }
    // The reading is the parser's; the failure names the argument the caller filled.
    throw InvalidInputError(std::string(name) + " must name a time signature; " +
                            parsed.error().message());
  }
  if (const auto* ts = std::get_if<TimeSignature>(&v)) {
    return assert_time_signature(*ts, name);
  }
  return assert_meter_map(std::get<MeterMap>(v), name);
}

MeterData to_meter_data(const MeterArg& value, std::string_view name) {
  return read_meter_data(value, name);
}

TimeSignature parse_time_signature(std::string_view text) {
  return try_parse_time_signature(text).unwrap();
}

ParseResult<TimeSignature> try_parse_time_signature(std::string_view text) {
  try {
    return ParseResult<TimeSignature>::success(read_time_signature(text));
  } catch (...) {
    return parse_failure<TimeSignature>();
  }
}

std::string format_time_signature(const MeterArg& ts, const FormatTimeSignatureOptions& opts) {
  TimeSignature signature = read_signature(ts, "ts");
  if (opts.grouping.value_or(false) && signature.grouping) {
    const std::vector<int>& grouping = *signature.grouping;
    if (grouping_sum_of(signature) == signature.numerator) {
      return join(grouping, "+") + "/" + num(signature.denominator);
    }
    // A grouping counted in pulses on a compound numerator has no additive spelling; where its
    // groups differ, the plain form would name a bar weighted differently.
    std::optional<std::vector<double>> pulse_grouping = pulse_grouping_of(signature);
    if (pulse_grouping && !is_uniform_grouping(*pulse_grouping)) {
      throw InvalidInputError("ts carries a grouping no signature text can spell: " +
                              join(grouping, "+") + " counted in the pulses of " +
                              num(signature.numerator) + "/" + num(signature.denominator) +
                              ". Format it without the grouping to name the bar it is written in.");
    }
  }
  return num(signature.numerator) + "/" + num(signature.denominator);
}

bool is_compound(const MeterArg& ts) {
  TimeSignature signature = read_signature(ts, "ts");
  return is_compound_numerator(signature.numerator) && !is_additive_reading(signature);
}

double beats_per_bar(const MeterArg& ts) { return bar_beats_of(read_signature(ts, "ts")); }

TimeSignature meter_at(double beat_in_quarters, const MeterArg& meter) {
  assert_finite_number(beat_in_quarters, "beat");
  return meter_at_checked(beat_in_quarters, read_meter_data(meter));
}

double bar_start_beat(double beat_in_quarters, const MeterArg& meter) {
  assert_finite_number(beat_in_quarters, "beat");
  return bar_start_checked(beat_in_quarters, read_meter_data(meter));
}

double bar_index_at(double beat_in_quarters, const MeterArg& meter) {
  assert_finite_number(beat_in_quarters, "beat");
  return bar_index_checked(beat_in_quarters, read_meter_data(meter));
}

double beats_per_bar_at(double beat_in_quarters, const MeterArg& meter) {
  assert_finite_number(beat_in_quarters, "beat");
  MeterData data = read_meter_data(meter);
  if (const auto* map = std::get_if<MeterMap>(&data)) {
    return bar_length_of(*map, beat_in_quarters);
  }
  return bar_beats_of(meter_at(beat_in_quarters, meter));
}

MeterMap resolve_meters(const ResolveMetersOptions& opts, std::string_view name) {
  if (opts.ts && opts.meters) {
    throw InvalidInputError(std::string(name) +
                            " and ts name the same thing; give one or the other, not both");
  }
  const std::optional<MeterArg>& given = opts.meters ? opts.meters : opts.ts;
  if (!given) {
    return MeterMap{MeterChange{0, kDefaultTs}};
  }
  MeterData resolved = to_meter_data(*given, opts.meters ? name : "ts");
  if (auto* map = std::get_if<MeterMap>(&resolved)) {
    return std::move(*map);
  }
  return MeterMap{MeterChange{0, std::get<TimeSignature>(std::move(resolved))}};
}

int pulses_per_bar(const MeterArg& ts) {
  return static_cast<int>(pulse_count_of(read_signature(ts, "ts")));
}

BarPosition beat_to_bar_position(double beat_in_quarters, const MeterArg& meter) {
  assert_finite_number(beat_in_quarters, "beat");
  return bar_position_checked(beat_in_quarters, read_meter_data(meter));
}

double pulse_beats(const MeterArg& ts) { return pulse_beats_of(read_signature(ts, "ts")); }

double bar_position_to_pulse(const BarPosition& pos, const MeterArg& meter) {
  // The bar is checked before the meter is read, whichever form the meter came in.
  assert_integer(pos.bar, "position.bar");
  assert_finite_number(pos.beat, "position.beat");
  return pulse_checked(pos, read_meter_data(meter));
}

std::string format_bar_position(double beat_in_quarters, const MeterArg& meter, int decimals) {
  assert_integer(decimals, "decimals", 0, 100);
  assert_finite_number(beat_in_quarters, "beat");
  MeterData resolved = read_meter_data(meter);
  BarPosition position = bar_position_checked(beat_in_quarters, resolved);
  const TimeSignature& ts = meter_at_checked(beat_in_quarters, resolved);
  double pulse = pulse_checked(position, MeterData(ts));
  double rounded = js::number(js::to_fixed(pulse, decimals));
  double bar_length = is_meter_map(resolved)
                          ? bar_length_of(std::get<MeterMap>(resolved), beat_in_quarters)
                          : bar_beats_of(std::get<TimeSignature>(resolved));
  // A short bar keeps the felt beats it started; anything past them belongs to the next bar.
  double pulses_in_bar = std::ceil(bar_length / pulse_beats_of(ts) - BEAT_EPS);
  if (rounded >= pulses_in_bar + 1) {
    double next_bar =
        bar_index_checked(bar_start_checked(beat_in_quarters, resolved) + bar_length, resolved);
    return num(next_bar + 1) + ".1";
  }
  double whole_pulse = std::floor(rounded);
  double fraction = js::number(js::to_fixed(rounded - whole_pulse, decimals));
  std::string head = num(position.bar + 1) + "." + num(whole_pulse);
  return fraction == 0 ? head : head + "+" + num(fraction);
}

double bar_position_to_beat(const BarPosition& pos, const MeterArg& meter) {
  assert_integer(pos.bar, "bar position bar");
  assert_finite_number(pos.beat, "bar position beat");
  MeterData resolved = read_meter_data(meter);
  if (const auto* map = std::get_if<MeterMap>(&resolved)) {
    return beat_of_bar_index(*map, pos.bar) + pos.beat;
  }
  return pos.bar * bar_beats_of(std::get<TimeSignature>(resolved)) + pos.beat;
}

int metric_weight(double beat_in_quarters, const MeterArg& meter) {
  assert_finite_number(beat_in_quarters, "beat");
  MeterData resolved = read_meter_data(meter);
  const TimeSignature& ts = meter_at_checked(beat_in_quarters, resolved);
  double beat = beat_in_quarters - bar_start_checked(beat_in_quarters, resolved);
  double pulse = pulse_beats_of(ts);
  if (!is_multiple(beat, pulse)) {
    return 0;
  }
  double pulses = pulse_count_of(ts);
  double pulse_index = std::fmod(js::round(beat / pulse), pulses);
  if (pulse_index == 0) {
    return 3;
  }
  // Equal groups state no accent only when they restate the meter's own division; an additive
  // reading has flattened the bar, so its groups are the only accents it has.
  std::optional<std::vector<double>> grouping = pulse_grouping_of(ts);
  if (grouping && (is_additive_reading(ts) || !is_uniform_grouping(*grouping))) {
    return is_group_head(*grouping, pulse_index) ? 2 : 1;
  }
  if (std::fmod(pulses, 2) == 0 && pulse_index == pulses / 2) {
    return 2;
  }
  return 1;
}

double metric_grid_unit(const MeterArg& meter) {
  MeterData resolved = read_meter_data(meter);
  const auto* map = std::get_if<MeterMap>(&resolved);
  if (map == nullptr) {
    return pulse_beats_of(std::get<TimeSignature>(resolved));
  }
  std::vector<MeterSegment> segments = meter_segments(*map);
  double unit = 0;
  for (const MeterSegment& segment : segments) {
    unit = common_step(unit, pulse_beats_of(segment.ts));
  }
  if (unit <= 0) {
    return pulse_beats_of(kDefaultTs);
  }
  // Bars are laid from beat 0, so each change is measured from there.
  double on_changes = unit;
  for (const MeterSegment& segment : segments) {
    on_changes = common_step(on_changes, std::fabs(segment.barAnchor));
  }
  // An onset a hair off a beat would divide the grid down to the hair; past the division limit
  // it is read as unmeasured.
  return on_changes * MAX_CHANGE_DIVISIONS >= unit - BEAT_EPS ? on_changes : unit;
}

bool is_strong_beat(double beat_in_quarters, const MeterArg& meter) {
  return metric_weight(beat_in_quarters, meter) >= 2;
}

std::vector<double> tuplet(double total_beats, int count) {
  assert_range(total_beats, 0, kMaxSafeInteger, "tuplet total beats");
  assert_positive_int(count, "tuplet count");
  return std::vector<double>(static_cast<std::size_t>(count), total_beats / count);
}

}  // namespace cantus
