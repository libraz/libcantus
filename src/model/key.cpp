#include "cantus/model/key.h"

#include <cctype>
#include <string>
#include <utility>

#include "cantus/core/validation.h"
#include "cantus/model/chord.h"
#include "cantus/model/progression.h"
#include "cantus/theory/spelling.h"
#include "cantus/theory/transposition.h"
#include "js/math.h"
#include "js/number.h"
#include "model/limits.gen.h"
#include "model/shared.h"
#include "theory/scale/name.h"
#include "theory/scale/relations.h"

namespace cantus {

namespace {

/** The tonic a mode's reference scale is spelled on; C spells both modes plainly. */
const NoteData kReferenceTonic =
#include "model/reference_tonic.gen.inc"
    ;

/**
 * The word a key names its scale with: the mode word for a plain major or minor key, the
 * built-in scale's own name written as words for everything else (`scaleWord`).
 */
std::string scale_word(int mask, bool is_minor) {
  std::optional<std::string_view> name = scale_name_of_mask(mask);
  if (!name) {
    return is_minor ? "minor" : "major";
  }
  if (*name == "major") {
    return "major";
  }
  if (*name == "naturalMinor") {
    return "minor";
  }
  // `name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()`
  std::string out;
  for (std::size_t index = 0; index < name->size(); ++index) {
    char c = (*name)[index];
    if (index > 0 && std::isupper(static_cast<unsigned char>(c)) != 0) {
      char before = (*name)[index - 1];
      if (std::islower(static_cast<unsigned char>(before)) != 0 ||
          std::isdigit(static_cast<unsigned char>(before)) != 0) {
        out += ' ';
      }
    }
    out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return out;
}

/** The tonic a key arriving as a bare key/scale is written with (`spelledTonicFor`). */
Note spelled_tonic_for(const KeyArg& scale) { return Note(resolve_key(scale).tonic); }

/** The tonic as bare note data, without an octave. */
NoteData bare(const Note& note) { return NoteData{note.letter(), note.alter(), std::nullopt}; }

}  // namespace

std::string_view to_string(PitchClassOrder order) {
  return order == PitchClassOrder::kAscending ? "ascending" : "degree";
}

std::optional<PitchClassOrder> parse_pitch_class_order(std::string_view name) {
  if (name == "degree") {
    return PitchClassOrder::kDegree;
  }
  if (name == "ascending") {
    return PitchClassOrder::kAscending;
  }
  return std::nullopt;
}

Key::Key(const KeyScale& scale, const Note& tonic, std::optional<KeyVariant> variant)
    : tonic_(tonic) {
  assert_integer(scale.rootPc, "scale.rootPc");
  assert_integer(scale.modeMask12, "scale.modeMask12", 1, CHROMATIC_MASK);
  if ((scale.modeMask12 & 1) == 0) {
    throw InvalidInputError("scale.modeMask12 must include the tonic (bit 0)");
  }
  int root_pc = pitch_class_of(scale.rootPc);
  if (tonic.pitch_class() != root_pc) {
    throw InvalidInputError("tonic " + tonic.name() +
                            " does not match the scale root pitch class " + js::to_string(root_pc) +
                            "; pass a tonic that spells the scale root, or omit it to have one "
                            "chosen");
  }
  if (variant) {
    assert_key_variant(*variant, scale.modeMask12);
  }
  scale_ = KeyScale{root_pc, scale.modeMask12};
  variant_ = variant ? *variant : variant_of_mask(scale.modeMask12);
}

Key Key::from_spelled(const ResolvedKey& spelled) {
  return Key(spelled.scale, Note(spelled.tonic), spelled.variant);
}

Key Key::major(std::string_view root) {
  Note tonic = Note::parse(root);
  return Key(major_key(tonic.pitch_class()).scale(), tonic);
}

Key Key::major(double root) {
  SpelledKeyScale scale = major_key(root);
  return Key(scale.scale(), spelled_tonic_for(scale));
}

Key Key::minor(std::string_view root) {
  Note tonic = Note::parse(root);
  return Key(minor_key(tonic.pitch_class()).scale(), tonic);
}

Key Key::minor(double root) {
  SpelledKeyScale scale = minor_key(root);
  return Key(scale.scale(), spelled_tonic_for(scale));
}

Key Key::named(std::string_view name, std::string_view root) {
  Note tonic = Note::parse(root);
  return Key(scale_by_name(name, tonic.pitch_class()).scale(), tonic);
}

Key Key::named(std::string_view name, double root) {
  SpelledKeyScale scale = scale_by_name(name, pitch_class_of(root));
  return Key(scale.scale(), spelled_tonic_for(scale));
}

Key Key::parse(std::string_view text, const NoteNameOptions& opts) {
  return try_parse(text, opts).unwrap();
}

ParseResult<Key> Key::try_parse(std::string_view text, const NoteNameOptions& opts) {
  ParseResult<ResolvedKey> parsed = try_resolve_key_name(text, opts);
  if (!parsed.ok()) {
    return parse_failure_of<Key>(std::move(parsed));
  }
  const ResolvedKey& key = parsed.value();
  return ParseResult<Key>::success(Key(key.scale, Note(key.tonic), key.variant));
}

Key Key::from_fifths(double fifths, KeyMode mode) {
  return from_spelled(key_from_fifths(fifths, mode));
}

Key Key::of(const KeyArg& key, const std::optional<Note>& tonic) {
  ResolvedKey resolved = resolve_key(key);
  return Key(resolved.scale, tonic ? *tonic : Note(resolved.tonic), resolved.variant);
}

Key Key::from_json(const ResolvedKey& data) {
  return Key(data.scale, Note(data.tonic), data.variant);
}

Key Key::from_data(const ResolvedKey& data) { return from_json(data); }

std::vector<Key> Key::detect(const std::vector<int>& pitches, const DetectKeyOptions& opts) {
  std::vector<Key> out;
  for (DetectedKeyMatch& match : detect_matches(pitches, opts)) {
    out.push_back(std::move(match.key));
  }
  return out;
}

std::vector<DetectedKeyMatch> Key::detect_matches(const std::vector<int>& pitches,
                                                  const DetectKeyOptions& opts) {
  std::vector<DetectedKeyMatch> out;
  for (const KeyMatch& match : detect_key(pitches, opts)) {
    out.push_back(detected_key_match(match));
  }
  return out;
}

Nullable<Key> Key::detect_best(const std::vector<int>& pitches, const DetectKeyOptions& opts) {
  Nullable<KeyMatch> best = detect_key_best(pitches, opts);
  if (!best) {
    return std::nullopt;
  }
  return detected_key_match(*best).key;
}

bool Key::equals(const Key& other) const {
  KeyScale scale = other.scale();
  return scale_.rootPc == scale.rootPc && scale_.modeMask12 == scale.modeMask12;
}

bool Key::is_minor() const { return is_minor_key(scale_); }

int Key::fifths() const { return key_signature_fifths(tonic_.data(), scale_); }

std::optional<std::string_view> Key::scale_name() const {
  for (const NamedScaleMask& named : NAMED_SCALES) {
    if (named.mask == scale_.modeMask12) {
      return named.name;
    }
  }
  return std::nullopt;
}

ResolvedKey Key::data() const { return ResolvedKey{scale_, tonic_.data(), variant_}; }

std::vector<int> Key::pitch_classes(PitchClassOrder order) const {
  return order == PitchClassOrder::kAscending ? diatonic_pitch_classes(scale_)
                                              : scale_tones_in_degree_order(scale_);
}

std::optional<ScaleSystem> Key::system() const { return scale_system_of(scale_); }

bool Key::supports_functional_harmony() const {
  return cantus::supports_functional_harmony(scale_);
}

Key Key::relative() const { return from_spelled(relative_key_of(tonic_.data(), scale_)); }

Key Key::parallel() const { return from_spelled(parallel_key_of(tonic_.data(), scale_)); }

Key Key::dominant_key() const { return from_spelled(dominant_key_of(tonic_.data(), scale_)); }

Key Key::subdominant_key() const { return from_spelled(subdominant_key_of(tonic_.data(), scale_)); }

Nullable<Key> Key::enharmonic() const {
  Nullable<ResolvedKey> other = enharmonic_key_of(tonic_.data(), scale_);
  if (!other) {
    return std::nullopt;
  }
  return from_spelled(*other);
}

std::vector<RelatedKeyEntry> Key::related_keys() const {
  std::vector<RelatedKeyEntry> out;
  for (const RelatedKey& related : related_keys_of(tonic_.data(), scale_)) {
    out.push_back(
        RelatedKeyEntry{related.relation,
                        from_spelled(ResolvedKey{related.scale, related.tonic, related.variant})});
  }
  return out;
}

Nullable<KeyRelation> Key::relation_to(const Key& other) const {
  return key_relation_between(data(), other.data());
}

std::vector<KeyPivot> Key::pivots_to(const KeyArg& other) const {
  std::vector<KeyPivot> out;
  for (PivotChord& pivot : pivot_chords(scale_, other)) {
    out.push_back(KeyPivot{ChordValue(pivot.chord, KeyArg(*this)), std::move(pivot.romanFrom),
                           std::move(pivot.romanTo)});
  }
  return out;
}

Note Key::degree(double n) const {
  std::vector<Note> scale = notes();
  assert_integer(n, "degree", 1, static_cast<double>(scale.size()));
  return scale[static_cast<std::size_t>(n) - 1];
}

KeyMode Key::mode_of_degree(double n) const {
  if (static_cast<int>(pitch_classes().size()) != KEY_HEPTATONIC_DEGREES) {
    return is_minor() ? KeyMode::kMinor : KeyMode::kMajor;
  }
  ChordQuality quality = cantus::diatonic_triad(n, scale_).quality;
  return quality == ChordQuality::kMin || quality == ChordQuality::kDim ? KeyMode::kMinor
                                                                        : KeyMode::kMajor;
}

Key Key::mode_on(KeyMode mode, const Note& tonic) {
  int root_pc = tonic.pitch_class();
  SpelledKeyScale scale = mode == KeyMode::kMinor ? minor_key(root_pc) : major_key(root_pc);
  return Key(scale.scale(), tonic).as_written();
}

Key Key::key_on_degree(double n, const std::optional<KeyMode>& mode) const {
  Note tonic = degree(n);
  return mode_on(mode ? *mode : mode_of_degree(n), tonic);
}

Key Key::key_having_tonic_as_degree(double n, const std::optional<KeyMode>& mode) const {
  KeyMode resolved = mode ? *mode : (is_minor() ? KeyMode::kMinor : KeyMode::kMajor);
  // The interval from degree 1 to degree n is a property of the mode, read off its scale on C.
  std::vector<NoteData> reference =
      spell_scale(kReferenceTonic, resolved == KeyMode::kMinor ? minor_key(0) : major_key(0));
  assert_integer(n, "degree", 1, static_cast<double>(reference.size()));
  SpelledInterval step = spelled_interval(reference[0], reference[static_cast<std::size_t>(n) - 1]);
  // Negating a zero span yields -0, which compares unequal to 0.
  SpelledInterval down{step.number, step.quality, step.semitones == 0 ? 0 : -step.semitones, true};
  Note tonic(transpose_by_interval(tonic_.data(), down));
  return mode_on(resolved, tonic);
}

Key Key::transpose_by(const IntervalArg& interval) const {
  SpelledInterval step = to_spelled_interval(interval);
  KeyScale scale{pitch_class_of(scale_.rootPc + step.semitones), scale_.modeMask12};
  return Key(scale, Note(transpose_by_interval(tonic_.data(), step)), variant_);
}

Interval Key::interval_to(const Key& other) const {
  return Interval::from_data(spelled_interval(bare(tonic_), bare(other.tonic())));
}

Key Key::transpose(double semitones) const {
  assert_finite_number(semitones, "semitones");
  KeyScale scale{pitch_class_of(scale_.rootPc + js::round(semitones)), scale_.modeMask12};
  return Key(scale, tonic_.transpose(semitones), variant_).as_written();
}

Key Key::as_written() const {
  if (is_written_tonic(tonic_.data(), scale_)) {
    return *this;
  }
  Nullable<ResolvedKey> other = enharmonic_key_of(tonic_.data(), scale_);
  if (!other) {
    return *this;
  }
  Note respelled(other->tonic);
  return respelled.pitch_class() != pitch_class_of(scale_.rootPc)
             ? *this
             : Key(scale_, respelled, variant_);
}

Key Key::for_instrument(const IntervalArg& instrument) const {
  Note tonic(to_written_pitch(tonic_.data(), instrument));
  return Key(KeyScale{tonic.pitch_class(), scale_.modeMask12}, tonic, variant_).as_written();
}

std::vector<Note> Key::notes() const {
  std::vector<Note> out;
  for (const NoteData& note : spell_scale(tonic_.data(), scale_)) {
    out.emplace_back(note);
  }
  return out;
}

std::vector<std::string> Key::note_names(const NoteNameOptions& opts) const {
  std::vector<std::string> out;
  for (const Note& note : notes()) {
    out.push_back(note.format(opts));
  }
  return out;
}

std::vector<Note> Key::spell_pitch_classes(const std::vector<double>& pcs,
                                           const std::optional<NoteArg>& tonic) const {
  NoteData anchor = tonic ? to_note_data(*tonic) : tonic_.data();
  std::vector<Note> out;
  for (const NoteData& note : cantus::spell_pitch_classes(pcs, anchor, scale_)) {
    out.emplace_back(note);
  }
  return out;
}

ChordValue Key::chord(double degree, const std::optional<ChordQuality>& quality) const {
  Chord data = quality ? chord_from_degree(degree, *quality, scale_)
                       : cantus::diatonic_triad(degree, scale_);
  return ChordValue(data, KeyArg(*this));
}

ChordValue Key::diatonic_triad(double degree) const {
  return ChordValue(cantus::diatonic_triad(degree, scale_), KeyArg(*this));
}

ChordValue Key::diatonic_seventh(double degree) const {
  return ChordValue(cantus::diatonic_seventh(degree, scale_), KeyArg(*this));
}

ChordValue Key::roman(std::string_view text) const {
  // The key goes whole: a numeral naming a chromatic chord is spelled from the tonic.
  return ChordValue(roman_to_chord(text, data()), KeyArg(*this));
}

ChordValue Key::augmented_sixth(AugmentedSixthKind kind) const {
  return ChordValue(augmented_sixth_chord(kind, key_identity(*this)), KeyArg(*this));
}

Progression Key::progression(const std::vector<std::string>& romans) const {
  std::vector<ChordValue> chords;
  for (const std::string& text : romans) {
    chords.push_back(roman(text));
  }
  return Progression(chords, KeyArg(*this));
}

bool Key::contains(double pitch) const { return is_scale_tone(pitch, scale_); }

bool Key::contains(const Note& note) const { return is_scale_tone(note.pitch_class(), scale_); }

double Key::nearest_tone(double pitch) const { return nearest_scale_tone(pitch, scale_); }

Nullable<int> Key::degree_of(double pitch) const {
  int degree = pitch_to_scale_degree(pitch, scale_);
  if (degree == -1) {
    return std::nullopt;
  }
  return degree;
}

std::string Key::to_string(const NoteNameOptions& opts) const {
  if (opts.system && *opts.system != NoteNameSystem::kEnglish) {
    return format_key_name(
        KeyName{tonic_.data(), is_minor() ? KeyNameMode::kMinor : KeyNameMode::kMajor}, opts);
  }
  return tonic_.name() + " " + scale_word(scale_.modeMask12, is_minor());
}

DetectedKeyMatch detected_key_match(const KeyMatch& match) {
  // The same spelling the detector's own rationale is written with.
  ResolvedKey resolved = resolve_key(match.key);
  resolved.variant = match.variant;
  return DetectedKeyMatch{Key::from_json(resolved), match.mode,        match.variant,
                          match.scaleName,          match.fit,         match.score,
                          match.rationale,          match.alternatives};
}

Key to_key(const KeyArg& value) {
  if (const auto* name = std::get_if<std::string>(&value.value())) {
    return Key::parse(*name);
  }
  const KeyData& data = std::get<KeyData>(value.value());
  KeyScale scale = to_key_scale(KeyArg(data.scale));
  if (data.tonic) {
    return Key(scale, Note(*data.tonic), data.variant);
  }
  return Key(scale, spelled_tonic_for(scale), data.variant);
}

ResolvedKey key_identity(const Key& key) { return key.data(); }

}  // namespace cantus
