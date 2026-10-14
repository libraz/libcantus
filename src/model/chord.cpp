#include "cantus/model/chord.h"

#include <cmath>
#include <utility>

#include "cantus/core/validation.h"
#include "cantus/model/progression.h"
#include "cantus/theory/figured_bass.h"
#include "cantus/theory/spelling.h"
#include "core/validation/validation.h"
#include "model/shared.h"
#include "theory/chord/chord.h"
#include "theory/symbol/spelling.h"
#include "theory/symbol/symbol.h"

namespace cantus {

namespace {

/** A spelling hint as bare note data. */
NoteData hint_note(const PitchSpelling& hint) { return spelling_note(hint); }

/** A spelled note as a bare spelling hint. */
PitchSpelling hint_of(const NoteData& note) {
  return PitchSpelling{static_cast<double>(note.letter), static_cast<double>(note.alter)};
}

/** Whether a spelling hint still names the pitch class it is attached to (`hintMatches`). */
bool hint_matches(const std::optional<PitchSpelling>& hint, std::optional<double> pc) {
  return hint && pc && hint_for(hint, pitch_class_of(*pc)).has_value();
}

/** Move an explicit spelling hint by a spelled interval (`transposeHintByInterval`). */
std::optional<PitchSpelling> transpose_hint_by_interval(const std::optional<PitchSpelling>& hint,
                                                        const SpelledInterval& interval) {
  if (!hint) {
    return std::nullopt;
  }
  return hint_of(transpose_by_interval(hint_note(*hint), interval));
}

/** Move a chord's per-tone spelling hints by a spelled interval. */
std::optional<std::vector<PitchSpelling>> transpose_tone_hints_by_interval(
    const std::optional<std::vector<PitchSpelling>>& hints, const SpelledInterval& interval) {
  if (!hints) {
    return std::nullopt;
  }
  std::vector<PitchSpelling> out;
  for (const PitchSpelling& hint : *hints) {
    out.push_back(hint_of(transpose_by_interval(hint_note(hint), interval)));
  }
  return out;
}

/**
 * A defensive copy of plain chord data (`copyChord`): root and bass reduced to pitch classes,
 * every interval checked, a bass equal to the root dropped, and a stale spelling hint dropped.
 */
Chord copy_chord(const Chord& data) {
  Chord copy;
  copy.rootPc = pitch_class_of(data.rootPc);
  copy.quality = data.quality;
  for (std::size_t index = 0; index < data.intervals.size(); ++index) {
    copy.intervals.push_back(
        assert_finite_number(data.intervals[index], "chord intervals[" + index_text(index) + "]"));
  }
  if (data.bassPc) {
    double bass = pitch_class_of(*data.bassPc);
    if (bass != copy.rootPc) {
      copy.bassPc = bass;
    }
  }
  if (std::optional<std::vector<PitchSpelling>> tones = chord_tone_spellings(data)) {
    copy.toneSpellings = std::move(tones);
  }
  if (hint_matches(data.rootSpelling, data.rootPc)) {
    copy.rootSpelling = PitchSpelling{data.rootSpelling->letter, data.rootSpelling->alter};
  }
  // The bass spelling is the slash bass's; with no slash bass left there is nothing to name.
  if (hint_matches(data.bassSpelling, copy.bassPc)) {
    copy.bassSpelling = PitchSpelling{data.bassSpelling->letter, data.bassSpelling->alter};
  }
  return copy;
}

/**
 * The slash bass of a chord whose root spelling is settled (`deriveBassSpelling`): one of the
 * chord's own tones takes that tone's spelling, any other is spelled by the key.
 */
std::optional<PitchSpelling> derive_bass_spelling(const Chord& chord,
                                                  const std::optional<Key>& key) {
  if (!chord.bassPc) {
    return std::nullopt;
  }
  double bass_pc = *chord.bassPc;
  if (chord.rootSpelling) {
    for (std::size_t index = 0; index < chord.intervals.size(); ++index) {
      if (pitch_class_of(chord.rootPc + chord.intervals[index]) == bass_pc) {
        std::vector<NoteData> tones = spell_chord_from_root(chord, hint_note(*chord.rootSpelling));
        if (index < tones.size()) {
          return hint_of(tones[index]);
        }
        break;
      }
    }
  }
  if (!key) {
    return std::nullopt;
  }
  return hint_of(spell_pitch_class(bass_pc, key->tonic().data(), KeyArg(*key)));
}

/** A chord built from parts, wrapped (`new Chord(makeChord(...))`). */
ChordValue made(double root_pc, ChordQuality quality, std::optional<double> bass_pc) {
  return ChordValue(make_chord(root_pc, quality, bass_pc));
}

}  // namespace

ChordValue::ChordValue(const Chord& data, const std::optional<KeyArg>& key)
    : given_(copy_chord(data)) {
  if (key) {
    key_ = to_key(*key);
  }
}

Chord ChordValue::data_with_key(const std::optional<Key>& key) const {
  Chord out = copy_chord(given_);
  if (!out.rootSpelling && key) {
    out.rootSpelling = hint_of(spell_pitch_class(out.rootPc, key->tonic().data(), KeyArg(*key)));
  }
  if (!out.bassSpelling) {
    if (std::optional<PitchSpelling> bass = derive_bass_spelling(out, key)) {
      out.bassSpelling = bass;
    }
  }
  return out;
}

Chord ChordValue::data() const { return data_with_key(key_); }

Key ChordValue::resolve_analysis_key(const std::optional<KeyArg>& key) const {
  if (key) {
    return to_key(*key);
  }
  if (!key_) {
    throw InvalidInputError("chord has no key context; pass a Key or attach one with withKey()");
  }
  return *key_;
}

ChordValue ChordValue::of(const ChordRootArg& root, ChordQuality quality,
                          const std::optional<ChordRootArg>& bass) {
  std::optional<Note> bass_note;
  std::optional<double> bass_pc;
  if (bass) {
    if (const auto* name = std::get_if<std::string>(&*bass)) {
      bass_note = Note::parse(*name);
      bass_pc = bass_note->pitch_class();
    } else {
      bass_pc = std::get<double>(*bass);
    }
  }
  std::optional<Note> root_note;
  if (const auto* name = std::get_if<std::string>(&root)) {
    root_note = Note::parse(*name);
  }
  Chord data =
      make_chord(root_note ? root_note->pitch_class() : std::get<double>(root), quality, bass_pc);
  if (root_note) {
    data.rootSpelling = hint_of(root_note->data());
  }
  if (bass_note) {
    data.bassSpelling = hint_of(bass_note->data());
  }
  return ChordValue(data);
}

ChordValue ChordValue::from_data(const Chord& data) { return ChordValue(data); }

ChordValue ChordValue::from_json(const Chord& data) { return ChordValue(data); }

ChordValue ChordValue::from_figured_bass(const NoteArg& bass, std::string_view figures,
                                         const KeyArg& key) {
  // The key travels whole: the figures of an Ab minor exercise are read in Ab minor.
  return ChordValue(realize_figured_bass(to_note_data(bass), figures, key));
}

ChordValue ChordValue::parse(std::string_view symbol, const NoteNameOptions& opts) {
  return try_parse(symbol, opts).unwrap();
}

ParseResult<ChordValue> ChordValue::try_parse(std::string_view symbol,
                                              const NoteNameOptions& opts) {
  ParseResult<Chord> parsed = try_parse_chord_symbol(symbol, opts);
  if (!parsed.ok()) {
    return parse_failure_of<ChordValue>(std::move(parsed));
  }
  return ParseResult<ChordValue>::success(ChordValue(parsed.value()));
}

std::vector<ChordValue> ChordValue::detect(const std::vector<int>& pitches,
                                           const DetectChordOptions& opts) {
  std::vector<ChordValue> out;
  for (const ChordMatch& match : detect_chord(pitches, opts)) {
    out.push_back(made(match.rootPc, match.quality,
                       match.bassPc ? std::optional<double>(*match.bassPc) : std::nullopt));
  }
  return out;
}

std::vector<DetectedChordMatch> ChordValue::detect_matches(const std::vector<int>& pitches,
                                                           const DetectChordOptions& opts) {
  std::vector<DetectedChordMatch> out;
  for (const ChordMatch& match : detect_chord(pitches, opts)) {
    out.push_back(
        DetectedChordMatch{made(match.rootPc, match.quality,
                                match.bassPc ? std::optional<double>(*match.bassPc) : std::nullopt),
                           match});
  }
  return out;
}

Nullable<ChordValue> ChordValue::detect_best(const std::vector<int>& pitches,
                                             const DetectChordOptions& opts) {
  Nullable<Chord> best = detect_chord_best(pitches, opts);
  if (!best) {
    return std::nullopt;
  }
  return ChordValue(*best);
}

ChordSpec ChordValue::spec() const { return chord_spec_of(data()); }

ChordValue ChordValue::with_key(const KeyArg& key) const { return ChordValue(given_, key); }

std::vector<int> ChordValue::pitch_classes(const ChordPitchClassOptions& opts) const {
  return chord_pitch_classes(data(), opts);
}

bool ChordValue::contains(double pitch) const { return is_chord_member(pitch, data()); }

Nullable<ChordToneRole> ChordValue::role_of(double pitch) const {
  return chord_tone_role(pitch, data());
}

std::string ChordValue::roman(const std::optional<KeyArg>& key,
                              const ChordToRomanOptions& opts) const {
  Key resolved = resolve_analysis_key(key);
  return chord_to_roman(data(), resolved.data(), opts);
}

RomanExplanation ChordValue::explain(const std::optional<KeyArg>& key,
                                     const ExplainRomanOptions& opts) const {
  Key resolved = resolve_analysis_key(key);
  return explain_roman(data(), resolved.data(), opts);
}

HarmonicFunction ChordValue::function(const std::optional<KeyArg>& key) const {
  Key resolved = resolve_analysis_key(key);
  return function_of(data(), resolved.data());
}

ChordAnalysis ChordValue::analyze(const std::optional<KeyArg>& key,
                                  const AnalyzeChordOptions& opts) const {
  Key resolved = resolve_analysis_key(key);
  return analyze_chord(data(), resolved.data(), opts);
}

bool ChordValue::is_borrowed(const std::optional<KeyArg>& key) const {
  Key resolved = resolve_analysis_key(key);
  return is_borrowed_chord(data(), resolved.data());
}

Nullable<BorrowedSource> ChordValue::borrowed_source(const std::optional<KeyArg>& key) const {
  Key resolved = resolve_analysis_key(key);
  return cantus::borrowed_source(data(), resolved.data());
}

std::string ChordValue::figured_bass(const std::optional<KeyArg>& key) const {
  Key resolved = resolve_analysis_key(key);
  return figured_bass_of(data(), resolved.data());
}

std::vector<Substitution> ChordValue::substitutions(const std::optional<KeyArg>& key,
                                                    const SubstituteOptions& opts) const {
  Key resolved = resolve_analysis_key(key);
  return substitute_chord(data(), resolved.data(), opts);
}

std::vector<BorrowedChord> ChordValue::modal_interchange(const std::optional<KeyArg>& key) const {
  return modal_interchange_palette(resolve_analysis_key(key).data());
}

std::string ChordValue::symbol(const ChordSymbolOptions& opts) const {
  return format_chord_symbol(data(), opts);
}

std::vector<int> ChordValue::voice(const VoicingOptions& opts) const {
  // The carried key travels whole, as it does through the analysis methods.
  if (opts.key || !key_) {
    return voice_chord(data(), opts);
  }
  VoicingOptions keyed = opts;
  keyed.key = KeyArg(*key_);
  return voice_chord(data(), keyed);
}

std::vector<int> ChordValue::styled_voicing(const StyledVoicingOptions& opts) const {
  return voice_chord_styled(data(), opts);
}

ChordValue ChordValue::negative_harmony(const std::optional<KeyArg>& key) const {
  // The key that anchored the reflection is kept, so a later analysis still has one.
  Key resolved = resolve_analysis_key(key);
  return ChordValue(negative_harmony_mirror(data(), resolved.data()), KeyArg(resolved));
}

ChordValue ChordValue::secondary_dominant() const {
  // Only a caller-supplied spelling is transposed; a derived one follows the attached key.
  std::optional<KeyArg> key;
  if (key_) {
    key = KeyArg(*key_);
  }
  return ChordValue(secondary_dominant_of(given_), key);
}

ChordValue ChordValue::invert(double n) const {
  Chord data = copy_chord(given_);
  auto length = static_cast<double>(data.intervals.size());
  if (data.intervals.empty()) {
    throw InvalidInputError("cannot invert a chord with no intervals");
  }
  double index = std::fmod(std::fmod(n, length) + length, length);
  // The bass spelling follows from the root spelling in force at read time.
  data.bassSpelling.reset();
  if (index == 0) {
    data.bassPc.reset();
  } else {
    double interval = 0;
    if (std::trunc(index) == index && index < length) {
      interval = data.intervals[static_cast<std::size_t>(index)];
    }
    data.bassPc = pitch_class_of(data.rootPc + interval);
  }
  std::optional<KeyArg> key;
  if (key_) {
    key = KeyArg(*key_);
  }
  return ChordValue(data, key);
}

ChordValue ChordValue::transpose(double semitones) const {
  Chord moved = transpose_chord(given_, semitones);
  // Respelled where moving by letter would name a root no chart writes.
  ChordSpellings spellings = transpose_chord_spellings(
      ChordSpellings{given_.rootSpelling, given_.bassSpelling, given_.toneSpellings}, semitones);
  if (spellings.rootSpelling) {
    moved.rootSpelling = spellings.rootSpelling;
  }
  if (spellings.bassSpelling) {
    moved.bassSpelling = spellings.bassSpelling;
  }
  if (spellings.toneSpellings) {
    moved.toneSpellings = spellings.toneSpellings;
  }
  std::optional<KeyArg> key;
  if (key_) {
    key = KeyArg(key_->transpose(semitones));
  }
  return ChordValue(moved, key);
}

ChordValue ChordValue::transpose_by(const IntervalArg& interval) const {
  SpelledInterval spelled = to_spelled_interval(interval);
  Chord moved = transpose_chord(given_, spelled.semitones);
  // Only a caller-supplied spelling is transposed; a derived one follows the transposed key.
  std::optional<PitchSpelling> root = transpose_hint_by_interval(given_.rootSpelling, spelled);
  std::optional<PitchSpelling> bass = transpose_hint_by_interval(given_.bassSpelling, spelled);
  std::optional<std::vector<PitchSpelling>> tones =
      transpose_tone_hints_by_interval(given_.toneSpellings, spelled);
  if (root) {
    moved.rootSpelling = root;
  }
  if (bass) {
    moved.bassSpelling = bass;
  }
  if (tones) {
    moved.toneSpellings = tones;
  }
  std::optional<KeyArg> key;
  if (key_) {
    key = KeyArg(key_->transpose_by(spelled));
  }
  return ChordValue(moved, key);
}

std::vector<ChordScaleMatch> ChordValue::scales() const { return chord_scales(data()); }

std::vector<ChordScaleReportEntry> ChordValue::scale_report(
    const std::optional<double>& limit) const {
  return chord_scale_report(data(), limit);
}

std::vector<int> ChordValue::tensions(std::string_view scale_name,
                                      const AvailableTensionsOptions& opts) const {
  return available_tensions(data(), scale_name, opts);
}

std::vector<int> ChordValue::avoid_notes(std::string_view scale_name,
                                         const AvoidNotesOptions& opts) const {
  return cantus::avoid_notes(data(), scale_name, opts);
}

std::vector<Note> ChordValue::spell(const std::optional<KeyArg>& key) const {
  std::optional<Key> resolved = key ? std::optional<Key>(to_key(*key)) : key_;
  // An explicit key selects the spelling view before any derived hint is read.
  Chord data = data_with_key(resolved);
  std::vector<NoteData> tones;
  if (!resolved) {
    if (!data.rootSpelling) {
      throw InvalidInputError(
          "chord has no key context and no root spelling; pass a Key, attach one with "
          "withKey(), or build the chord from a symbol");
    }
    tones = spell_chord_from_root(data, hint_note(*data.rootSpelling));
  } else {
    tones = spell_chord(data, resolved->tonic().data(), KeyArg(*resolved));
  }
  if (data.bassPc && data.bassSpelling) {
    int bass_pc = pitch_class_of(*data.bassPc);
    bool sounded = false;
    for (const NoteData& tone : tones) {
      sounded = sounded || note_to_pitch_class(tone) == bass_pc;
    }
    if (!sounded) {
      tones.push_back(NoteData{data.bassSpelling->letter, data.bassSpelling->alter, std::nullopt});
    }
  }
  std::vector<Note> out;
  for (const NoteData& note : tones) {
    out.emplace_back(note);
  }
  return out;
}

Progression ChordValue::progression_to(const std::vector<ChordValue>& others) const {
  std::vector<ChordValue> chords{*this};
  chords.insert(chords.end(), others.begin(), others.end());
  std::optional<KeyArg> key;
  if (key_) {
    key = KeyArg(*key_);
  }
  return Progression(chords, key);
}

ChordSpan ChordValue::span(double start_beat) const { return span_from_chord(data(), start_beat); }

bool ChordValue::equals(const ChordValue& other) const {
  Chord a = data();
  Chord b = other.data();
  return a.rootPc == b.rootPc && a.quality == b.quality && a.bassPc == b.bassPc &&
         a.intervals == b.intervals;
}

}  // namespace cantus
