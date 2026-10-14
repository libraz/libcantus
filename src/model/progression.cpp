#include "cantus/model/progression.h"

#include <cmath>
#include <utility>

#include "cantus/model/timeline.h"
#include "js/number.h"

namespace cantus {

namespace {

/** `ToIntegerOrInfinity` of an array index: NaN reads as 0, fractions are truncated. */
double integer_or_infinity(double value) { return std::isnan(value) ? 0 : std::trunc(value); }

/** A relative slice bound resolved against a length, as Array.prototype.slice resolves it. */
std::size_t slice_bound(const std::optional<double>& bound, std::size_t length,
                        std::size_t fallback) {
  if (!bound) {
    return fallback;
  }
  double relative = integer_or_infinity(*bound);
  auto size = static_cast<double>(length);
  double resolved = relative < 0 ? (relative + size < 0 ? 0 : relative + size)
                                 : (relative > size ? size : relative);
  return static_cast<std::size_t>(resolved);
}

}  // namespace

Progression::Progression(const std::vector<ChordValue>& chords, const std::optional<KeyArg>& key) {
  if (key) {
    key_ = to_key(*key);
  }
  // The key is applied to every member, including chords that already carry one.
  for (const ChordValue& chord : chords) {
    chords_.push_back(key_ ? chord.with_key(KeyArg(*key_)) : chord);
  }
}

std::optional<KeyArg> Progression::carried_key() const {
  if (!key_) {
    return std::nullopt;
  }
  return KeyArg(*key_);
}

Progression Progression::of(const std::vector<ChordValue>& chords,
                            const std::optional<KeyArg>& key) {
  return Progression(chords, key);
}

Progression Progression::from_spans(const std::vector<ChordSpan>& spans,
                                    const std::optional<KeyArg>& key) {
  std::vector<ChordValue> chords;
  for (const ChordSpan& span : spans) {
    chords.push_back(ChordValue::from_data(chord_from_span(span)));
  }
  return Progression(chords, key);
}

Progression Progression::from_json(const ProgressionData& data) {
  std::optional<KeyArg> key;
  if (data.key) {
    key = KeyArg(Key::from_json(*data.key));
  }
  std::vector<ChordValue> chords;
  for (const Chord& chord : data.chords) {
    chords.push_back(ChordValue::from_json(chord));
  }
  return Progression(chords, key);
}

Progression Progression::from_data(const ProgressionData& data) { return from_json(data); }

std::optional<ChordValue> Progression::at(double index) const {
  double relative = integer_or_infinity(index);
  auto size = static_cast<double>(chords_.size());
  double position = relative < 0 ? relative + size : relative;
  if (position < 0 || position >= size) {
    return std::nullopt;
  }
  return chords_[static_cast<std::size_t>(position)];
}

bool Progression::equals(const Progression& other) const {
  if (chords_.size() != other.length()) {
    return false;
  }
  for (std::size_t index = 0; index < chords_.size(); ++index) {
    if (!chords_[index].equals(other.chords()[index])) {
      return false;
    }
  }
  return true;
}

Progression Progression::add(const ChordValue& chord) const {
  std::vector<ChordValue> chords = chords_;
  chords.push_back(chord);
  return Progression(chords, carried_key());
}

Progression Progression::map(
    const std::function<ChordValue(const ChordValue&, std::size_t)>& fn) const {
  std::vector<ChordValue> chords;
  for (std::size_t index = 0; index < chords_.size(); ++index) {
    chords.push_back(fn(chords_[index], index));
  }
  return Progression(chords, carried_key());
}

Progression Progression::filter(
    const std::function<bool(const ChordValue&, std::size_t)>& pred) const {
  std::vector<ChordValue> chords;
  for (std::size_t index = 0; index < chords_.size(); ++index) {
    if (pred(chords_[index], index)) {
      chords.push_back(chords_[index]);
    }
  }
  return Progression(chords, carried_key());
}

Progression Progression::slice(const std::optional<double>& start,
                               const std::optional<double>& end) const {
  std::size_t from = slice_bound(start, chords_.size(), 0);
  std::size_t to = slice_bound(end, chords_.size(), chords_.size());
  std::vector<ChordValue> chords;
  for (std::size_t index = from; index < to; ++index) {
    chords.push_back(chords_[index]);
  }
  return Progression(chords, carried_key());
}

Progression Progression::concat(const Progression& other) const { return concat(other.chords()); }

Progression Progression::concat(const std::vector<ChordValue>& chords) const {
  std::vector<ChordValue> joined = chords_;
  joined.insert(joined.end(), chords.begin(), chords.end());
  return Progression(joined, carried_key());
}

int Progression::index_of(const ChordValue& chord) const {
  for (std::size_t index = 0; index < chords_.size(); ++index) {
    if (chords_[index].equals(chord)) {
      return static_cast<int>(index);
    }
  }
  return -1;
}

Progression Progression::with_key(const KeyArg& key) const { return Progression(chords_, key); }

std::vector<std::vector<int>> Progression::voice(const VoicingOptions& opts) const {
  std::vector<ChordArg> chords;
  for (const ChordValue& chord : chords_) {
    chords.emplace_back(chord.data());
  }
  // The carried key travels whole: the voicer spells the chords it scores.
  if (opts.key || !key_) {
    return voice_progression(chords, opts);
  }
  VoicingOptions keyed = opts;
  keyed.key = KeyArg(*key_);
  return voice_progression(chords, keyed);
}

Key Progression::resolve_analysis_key(const std::optional<KeyArg>& key) const {
  if (key) {
    return to_key(*key);
  }
  if (!key_) {
    throw InvalidInputError(
        "progression has no key context; pass a Key or attach one with withKey()");
  }
  return *key_;
}

std::vector<std::string> Progression::roman(const std::optional<KeyArg>& key,
                                            const ChordToRomanOptions& opts) const {
  Key resolved = resolve_analysis_key(key);
  std::vector<std::string> out;
  for (const ChordValue& chord : chords_) {
    out.push_back(chord.roman(KeyArg(resolved), opts));
  }
  return out;
}

std::vector<HarmonicFunction> Progression::functions(const std::optional<KeyArg>& key) const {
  Key resolved = resolve_analysis_key(key);
  std::vector<HarmonicFunction> out;
  for (const ChordValue& chord : chords_) {
    out.push_back(chord.function(KeyArg(resolved)));
  }
  return out;
}

ProgressionAnalysis Progression::analyze(const std::optional<KeyArg>& key,
                                         const ProgressionAnalyzeOptions& opts) const {
  Key resolved = resolve_analysis_key(key);
  ProgressionAnalysis out;
  for (const ChordValue& chord : chords_) {
    out.chords.push_back(chord.analyze(KeyArg(resolved), opts));
  }
  std::size_t count = chords_.size();
  if (count < 2) {
    return out;
  }
  DetectCadenceOptions cadence;
  cadence.alternatives = opts.alternatives;
  cadence.approach = opts.approach;
  // The chord before the closing pair comes from the progression itself, as cadences() takes it.
  if (count >= 3) {
    cadence.approach = ChordArg(chords_[count - 3].data());
  }
  if (opts.voicing) {
    const std::vector<std::vector<double>>& voicing = *opts.voicing;
    if (voicing.size() != count && voicing.size() != 2) {
      throw InvalidInputError(
          "voicing must hold one voicing per chord (" + js::to_string(static_cast<double>(count)) +
          ") or the closing pair; received " + js::to_string(static_cast<double>(voicing.size())));
    }
    cadence.voicing = std::array<std::vector<double>, 2>{voicing[voicing.size() - 2],
                                                         voicing[voicing.size() - 1]};
  }
  out.cadence = detect_cadence(chords_[count - 2].data(), chords_[count - 1].data(),
                               resolved.data(), cadence);
  return out;
}

std::vector<ScaleChoice> Progression::scales() const {
  std::vector<Chord> chords;
  for (const ChordValue& chord : chords_) {
    chords.push_back(chord.data());
  }
  return scales_for_changes(chords);
}

std::vector<CadenceResult> Progression::cadences(const std::optional<KeyArg>& key,
                                                 const ProgressionCadenceOptions& opts) const {
  Key resolved = resolve_analysis_key(key);
  std::vector<CadenceResult> found;
  for (std::size_t index = 1; index < chords_.size(); ++index) {
    DetectCadenceOptions pair;
    pair.alternatives = opts.alternatives;
    // The progression supplies its own predecessor wherever it has one.
    if (index >= 2) {
      pair.approach = ChordArg(chords_[index - 2].data());
    } else {
      pair.approach = opts.approach;
    }
    if (opts.voicing) {
      const std::vector<std::vector<double>>& voicing = *opts.voicing;
      pair.voicing = std::array<std::vector<double>, 2>{
          index - 1 < voicing.size() ? voicing[index - 1] : std::vector<double>{},
          index < voicing.size() ? voicing[index] : std::vector<double>{}};
    }
    found.push_back(
        detect_cadence(chords_[index - 1].data(), chords_[index].data(), resolved.data(), pair));
  }
  return found;
}

Progression Progression::substitute(double index, SubstitutionType type,
                                    const SubstituteOptions& opts) const {
  auto size = static_cast<double>(chords_.size());
  double position = index < 0 ? size + index : index;
  if (!(position >= 0 && position < size && std::trunc(position) == position)) {
    throw InvalidInputError("progression has no chord at index " + js::to_string(index) +
                            "; it holds " + js::to_string(size));
  }
  const ChordValue& target = chords_[static_cast<std::size_t>(position)];
  Key key = resolve_analysis_key(std::nullopt);
  for (Substitution& candidate : substitute_chord(target.data(), key.data(), opts)) {
    if (candidate.type == type) {
      std::vector<ChordValue> chords = chords_;
      chords[static_cast<std::size_t>(position)] = ChordValue(candidate.chord);
      return Progression(chords, KeyArg(key));
    }
  }
  throw InvalidInputError("no " + std::string(cantus::to_string(type)) + " substitution for " +
                          target.symbol() + " in " + key.to_string());
}

Timeline Progression::timeline(double beats_each) const {
  return Timeline::from_progression(*this, beats_each);
}

Progression Progression::transpose(double semitones) const {
  std::optional<KeyArg> key;
  if (key_) {
    key = KeyArg(key_->transpose(semitones));
  }
  std::vector<ChordValue> chords;
  for (const ChordValue& chord : chords_) {
    chords.push_back(chord.transpose(semitones));
  }
  return Progression(chords, key);
}

Progression Progression::transpose_by(const IntervalArg& interval) const {
  std::optional<KeyArg> key;
  if (key_) {
    key = KeyArg(key_->transpose_by(interval));
  }
  std::vector<ChordValue> chords;
  for (const ChordValue& chord : chords_) {
    chords.push_back(chord.transpose_by(interval));
  }
  return Progression(chords, key);
}

Progression Progression::transpose_to(const KeyArg& target) const {
  if (!key_) {
    throw InvalidInputError(
        "progression has no key context; attach one with withKey() before transposing to "
        "another key");
  }
  Key resolved = to_key(target);
  SpelledInterval interval = key_->interval_to(resolved).data();
  std::vector<ChordValue> chords;
  for (const ChordValue& chord : chords_) {
    chords.push_back(chord.transpose_by(interval));
  }
  return Progression(chords, KeyArg(resolved));
}

std::string Progression::to_string() const {
  std::string out;
  for (std::size_t index = 0; index < chords_.size(); ++index) {
    if (index > 0) {
      out += ' ';
    }
    out += chords_[index].symbol();
  }
  return out;
}

ProgressionData Progression::to_json() const {
  ProgressionData out;
  for (const ChordValue& chord : chords_) {
    out.chords.push_back(chord.to_json());
  }
  if (key_) {
    out.key = key_->to_json();
  }
  return out;
}

}  // namespace cantus
