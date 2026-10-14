#include "cantus/model/duration.h"

#include <utility>
#include <variant>

#include "js/number.h"

namespace cantus {

namespace {

/**
 * A defensive copy of a written duration, with its dot count stated. The reading is the check:
 * duration_to_beats() holds the value to the duration module's own rules.
 */
SpelledDuration copy_duration(const DurationArg& value) {
  duration_to_beats(value);
  if (const auto* base = std::get_if<NoteValue>(&value.value())) {
    return SpelledDuration{*base, 0, std::nullopt};
  }
  const DurationData& data = std::get<DurationData>(value.value());
  SpelledDuration spelled{data.base, data.dots.value_or(0), std::nullopt};
  if (data.tuplet) {
    spelled.tuplet = Tuplet{data.tuplet->actual, data.tuplet->normal};
  }
  return spelled;
}

}  // namespace

Duration::Duration(const DurationArg& value) : spelled_(copy_duration(value)) {}

Duration Duration::of(NoteValue base, int dots, std::optional<Tuplet> tuplet) {
  return Duration(DurationData{base, dots, tuplet});
}

Duration Duration::of_beats(double beats, const DurationOptions& options) {
  return Duration(beats_to_duration(beats, options));
}

std::vector<Duration> Duration::tie_chain(double beats, const DurationOptions& options) {
  std::vector<Duration> chain;
  for (const SpelledDuration& spelled : beats_to_tied_durations(beats, options)) {
    chain.push_back(Duration(spelled));
  }
  return chain;
}

Duration Duration::from_data(const DurationArg& data) { return Duration(data); }

Duration Duration::from_json(const DurationArg& data) { return Duration(data); }

double Duration::beats(const DurationOptions& options) const {
  return duration_to_beats(spelled_, options);
}

bool Duration::equals(const Duration& other) const {
  const SpelledDuration& b = other.spelled_;
  bool same_tuplet = spelled_.tuplet.has_value() == b.tuplet.has_value() &&
                     (!spelled_.tuplet || (spelled_.tuplet->actual == b.tuplet->actual &&
                                           spelled_.tuplet->normal == b.tuplet->normal));
  return spelled_.base == b.base && spelled_.dots == b.dots && same_tuplet;
}

std::string Duration::to_string() const {
  std::string out(cantus::to_string(spelled_.base));
  out.append(static_cast<std::size_t>(spelled_.dots), '.');
  if (spelled_.tuplet) {
    out +=
        " " + js::to_string(spelled_.tuplet->actual) + ":" + js::to_string(spelled_.tuplet->normal);
  }
  return out;
}

}  // namespace cantus
