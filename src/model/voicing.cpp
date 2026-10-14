#include "cantus/model/voicing.h"

#include <algorithm>
#include <utility>

#include "cantus/core/validation.h"
#include "cantus/theory/spelling.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** A line of MIDI pitches spelled in a key: a bare number is spelled by the key. */
std::vector<NoteData> spell_pitches(const std::vector<double>& pitches, const ResolvedKey& key) {
  std::vector<NoteData> out;
  for (double pitch : pitches) {
    out.push_back(spell_pitch(pitch, key.tonic, key, {}));
  }
  return out;
}

/** A line of notes spelled in a key: a number by the key, anything else as it names itself. */
std::vector<NoteData> spell_line(const std::vector<NoteArg>& line, const ResolvedKey& key) {
  std::vector<NoteData> out;
  for (const NoteArg& value : line) {
    if (const auto* number = std::get_if<double>(&value.value())) {
      out.push_back(spell_pitch(*number, key.tonic, key, {}));
    } else {
      out.push_back(to_note_data(value));
    }
  }
  return out;
}

/**
 * A line of pitches as notes: spelled by the key when one is known, else as sharp-spelled MIDI,
 * the reading a bare number gets from to_note_data().
 */
std::vector<Nullable<NoteData>> line_of(const std::vector<double>& pitches,
                                        const std::optional<ResolvedKey>& key) {
  std::vector<Nullable<NoteData>> out;
  std::vector<NoteData> notes;
  if (key) {
    notes = spell_pitches(pitches, *key);
  } else {
    for (double pitch : pitches) {
      notes.push_back(to_note_data(NoteArg(pitch)));
    }
  }
  for (NoteData& note : notes) {
    out.emplace_back(std::move(note));
  }
  return out;
}

/** The voicing options with the chord's own key filled in; an explicit `opts.key` wins. */
VoicingOptions with_carried_key(const std::optional<KeyArg>& chord_key,
                                const VoicingOptions& opts) {
  VoicingOptions out = opts;
  if (!out.key && chord_key) {
    out.key = chord_key;
  }
  return out;
}

std::vector<double> to_doubles(const std::vector<int>& pitches) {
  return std::vector<double>(pitches.begin(), pitches.end());
}

}  // namespace

Voicing::Voicing(const std::vector<double>& pitches) {
  if (pitches.empty()) {
    throw InvalidInputError("a voicing must contain at least one pitch");
  }
  // Every pitch is checked rather than copied blind, and the order is the caller's: a voicing
  // that is not ascending is what voice crossing is.
  for (std::size_t index = 0; index < pitches.size(); ++index) {
    pitches_.push_back(assert_midi_pitch(pitches[index], "pitches[" + index_text(index) + "]"));
  }
}

Voicing Voicing::of(const std::vector<double>& pitches) { return Voicing(pitches); }

Voicing Voicing::for_chord(const ChordArg& chord, const StyledVoicingOptions& opts) {
  return Voicing(to_doubles(voice_chord_styled(chord, opts)));
}

Voicing Voicing::satb(const ChordArg& chord, const VoicingOptions& opts,
                      const std::optional<KeyArg>& chord_key) {
  Chord data = to_chord_data(chord);
  return Voicing(to_doubles(voice_chord(data, with_carried_key(chord_key, opts))));
}

Voicing Voicing::from_data(const std::vector<double>& data) { return Voicing(data); }

Voicing Voicing::from_json(const std::vector<double>& data) { return Voicing(data); }

std::vector<VoiceRange> Voicing::satb_ranges() {
  std::vector<VoiceRange> out;
  for (const VoiceRange& range : SATB_RANGES) {
    out.push_back(VoiceRange{range.min, range.max});
  }
  return out;
}

VoiceRange Voicing::range() const { return VoiceRange{js::min(pitches_), js::max(pitches_)}; }

std::vector<Note> Voicing::spell(const KeyArg& key, const std::optional<ChordArg>& chord) const {
  ResolvedKey resolved = resolve_key(key);
  std::vector<NoteData> spelled = chord ? spell_voicing(pitches_, to_chord_data(*chord), resolved)
                                        : spell_pitches(pitches_, resolved);
  std::vector<Note> out;
  for (const NoteData& note : spelled) {
    out.emplace_back(note);
  }
  return out;
}

Voicing Voicing::next(const ChordArg& chord, const VoicingOptions& opts,
                      const std::optional<KeyArg>& chord_key) const {
  Chord data = to_chord_data(chord);
  return Voicing(to_doubles(next_voicing(pitches_, data, with_carried_key(chord_key, opts))));
}

double Voicing::cost_to(const Voicing& other) const {
  return voice_leading_cost(pitches_, other.pitches_);
}

std::vector<PartWritingViolation> Voicing::check_to(const Voicing& other,
                                                    const std::array<ChordArg, 2>& chords,
                                                    const KeyArg& key,
                                                    const PartWritingOptions& opts) const {
  // The key is passed on whole: the exercise is graded on the letters it is written with.
  ResolvedKey resolved = resolve_key(key);
  Chord from = to_chord_data(chords[0]);
  Chord to = to_chord_data(chords[1]);
  std::vector<SpelledVoicing> voicings = {spell_voicing(pitches_, from, resolved),
                                          spell_voicing(other.pitches_, to, resolved)};
  return check_part_writing(voicings, {from, to}, resolved, opts);
}

std::vector<PartWritingViolation> Voicing::species(const std::vector<NoteArg>& cantus_firmus,
                                                   int species, const KeyArg& mode,
                                                   const SpeciesOptions& opts) const {
  ResolvedKey resolved = resolve_key(mode);
  std::vector<NoteData> given = spell_line(cantus_firmus, resolved);
  std::vector<NoteData> written = spell_pitches(pitches_, resolved);
  return check_species(given, written, species, resolved, opts);
}

VoiceIndependenceReport Voicing::independence(const Voicing& other,
                                              const VoicingIndependenceOptions& opts) const {
  std::optional<ResolvedKey> resolved;
  if (opts.key) {
    resolved = resolve_key(*opts.key);
  }
  // `key` is this class's own addition: it spells the two lines and is not forwarded.
  const VoiceIndependenceOptions& rest = opts;
  std::vector<Nullable<NoteData>> lead = line_of(pitches_, resolved);
  std::vector<Nullable<NoteData>> counter = line_of(other.pitches_, resolved);
  return voice_independence(lead, counter, rest);
}

SafetyContext Voicing::context(const VoicingSafetyQuery& query) const {
  SafetyContext out;
  const std::vector<double>* previous = query.previous ? &query.previous->pitches_ : nullptr;
  for (std::size_t index = 0; index < pitches_.size(); ++index) {
    VoiceSnapshot voice;
    voice.pitch = static_cast<int>(pitches_[index]);
    if (previous != nullptr && index < previous->size()) {
      voice.prevPitch = static_cast<int>((*previous)[index]);
    }
    out.otherVoices.push_back(voice);
  }
  out.profile = query.profile;
  if (query.chord) {
    out.chord = Nullable<Chord>(to_chord_data(*query.chord));
  }
  out.key = resolve_key(query.key).scale;
  out.strongBeat = query.strongBeat;
  out.prevPitch = query.prevPitch;
  out.vocalLow = query.vocalLow;
  out.vocalHigh = query.vocalHigh;
  return out;
}

SafetyResult Voicing::safety_of(int pitch, const VoicingSafetyQuery& query,
                                const EvaluateSafetyOptions& opts) const {
  SafetyQuery full;
  static_cast<SafetyContext&>(full) = context(query);
  full.candidatePitch = pitch;
  return evaluate_safety(full, opts);
}

std::vector<double> Voicing::safe_pitches(const VoicingSafetyQuery& query, double pitch_low,
                                          double pitch_high) const {
  return enumerate_safe_pitches(context(query), pitch_low, pitch_high);
}

Voicing Voicing::invert(int n) const {
  assert_integer(n, "voicing inversion", -128, 128);
  // No voice moves, so the voicing is unchanged, the order its voices were written in included.
  if (n == 0) {
    return *this;
  }
  // Each move is made in turn: which voice moves second depends on where the first landed.
  auto ascending = [](double a, double b) { return a < b; };
  std::vector<double> pitches = pitches_;
  std::stable_sort(pitches.begin(), pitches.end(), ascending);
  for (int moved = 0; moved < (n < 0 ? -n : n); ++moved) {
    std::size_t index = n > 0 ? 0 : pitches.size() - 1;
    double pitch = pitches[index] + (n > 0 ? 12 : -12);
    pitches.erase(pitches.begin() + static_cast<std::ptrdiff_t>(index));
    pitches.push_back(assert_midi_pitch(pitch, "inverted voice"));
    std::stable_sort(pitches.begin(), pitches.end(), ascending);
  }
  return Voicing(pitches);
}

bool Voicing::equals(const Voicing& other) const { return pitches_ == other.pitches_; }

std::string Voicing::to_string() const {
  std::string out;
  for (std::size_t index = 0; index < pitches_.size(); ++index) {
    if (index > 0) {
      out += ' ';
    }
    out += js::to_string(pitches_[index]);
  }
  return out;
}

}  // namespace cantus
