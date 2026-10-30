#include "cantus/model/interval.h"

#include <utility>

#include "cantus/core/interval.h"
#include "cantus/model/note.h"
#include "cantus/theory/counterpoint.h"
#include "js/number.h"
#include "model/limits.gen.h"
#include "model/shared.h"

namespace cantus {

namespace {

/** The simple interval a diatonic number belongs to: the octave and its multiples stay octaves. */
int simple_degree(int number) {
  int reduced = ((number - 1) % 7) + 1;
  return reduced == 1 && number > 1 ? OCTAVE_DEGREES : reduced;
}

/** The quality an interval's inversion carries. */
std::string invert_quality(const std::string& quality) {
  if (quality == "P") {
    return "P";
  }
  if (quality == "M") {
    return "m";
  }
  if (quality == "m") {
    return "M";
  }
  return std::string(quality.size(), quality.front() == 'A' ? 'd' : 'A');
}

}  // namespace

Interval::Interval(int number, std::string quality, double semitones, bool descending)
    : number_(number),
      quality_(std::move(quality)),
      semitones_(semitones),
      descending_(descending) {}

Interval Interval::between(const Note& a, const Note& b) { return a.interval_to(b); }

Interval Interval::of(int number, std::string_view quality, double semitones) {
  return from_data(IntervalData{number, std::string(quality), semitones, std::nullopt});
}

Interval Interval::from_data(const IntervalArg& data) {
  SpelledInterval checked = to_spelled_interval(data);
  return Interval(checked.number, std::move(checked.quality), checked.semitones,
                  checked.descending);
}

Interval Interval::from_json(const IntervalArg& data) { return from_data(data); }

Interval Interval::parse(std::string_view name) { return try_parse(name).unwrap(); }

ParseResult<Interval> Interval::try_parse(std::string_view name) {
  ParseResult<SpelledInterval> parsed = try_parse_interval(name);
  if (!parsed.ok()) {
    return parse_failure_of<Interval>(std::move(parsed));
  }
  return ParseResult<Interval>::success(from_data(parsed.value()));
}

std::string Interval::name() const {
  return std::string(descending_ ? "-" : "") + quality_ + js::to_string(number_);
}

SpelledInterval Interval::data() const {
  return SpelledInterval{number_, quality_, semitones_, descending_};
}

Interval Interval::invert() const {
  int inverted = INVERSION_SUM - simple_degree(number_);
  std::string quality = invert_quality(quality_);
  return of(inverted, quality, interval_semitones(inverted, quality));
}

Interval Interval::negate() const {
  // The flag is flipped rather than derived from the negated span: a unison spans zero semitones.
  return Interval(number_, quality_, semitones_ == 0 ? 0 : -semitones_, !descending_);
}

bool Interval::is_consonant(bool two_voice) const {
  return classify_spelled_interval(data(), two_voice) != ConsonanceClass::kDissonance;
}

bool Interval::equals(const Interval& other) const {
  return number_ == other.number_ && quality_ == other.quality_ && semitones_ == other.semitones_ &&
         descending_ == other.descending_;
}

}  // namespace cantus
