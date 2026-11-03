/**
 * @file codec_t1.h
 * @brief Wire codec of the types of theory/chord, theory/scale, theory/spelling:
 *        CANTUS_JSON_FIELDS for output, and readers of the `*Like` and record inputs.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_T1_H_
#define CANTUS_SRC_OPS_CODEC_T1_H_

#include <string>
#include <string_view>
#include <vector>

#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/spelling.h"
#include "js/value.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"
#include "ops/validate.h"

namespace cantus {

inline json::Value to_json(KeyVariant v) { return json::Value(to_string(v)); }
inline json::Value to_json(KeyRelation r) { return json::Value(to_string(r)); }
inline json::Value to_json(ScaleSystem s) { return json::Value(to_string(s)); }
inline json::Value to_json(ChordQuality q) { return json::Value(to_string(q)); }
inline json::Value to_json(ChordBase b) { return json::Value(to_string(b)); }
inline json::Value to_json(ChordSeventh s) { return json::Value(to_string(s)); }
inline json::Value to_json(ChordToneRole r) { return json::Value(to_string(r)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(SpelledKeyScale, rootPc, modeMask12, tonic, variant)
/** The order keyFromFifths and every relation write a key in; resolveKey writes scale first. */
CANTUS_JSON_FIELDS(ResolvedKey, tonic, scale, variant)
CANTUS_JSON_FIELDS(RelatedKey, tonic, scale, variant, relation)
CANTUS_JSON_FIELDS(ScaleLadderPosition, rung, offset)
CANTUS_JSON_FIELDS(Alteration, degree, alter)
/** The order normalizeChordSpec builds a spec in. */
CANTUS_JSON_FIELDS(ChordSpec, rootPc, base, alterations, additions, omissions, seventh, bassPc)
CANTUS_JSON_FIELDS(PitchSpelling, letter, alter)
CANTUS_JSON_FIELDS(Chord, rootPc, quality, intervals, bassPc, rootSpelling, bassSpelling,
                   toneSpellings)
/** The order spanFromChord builds a span in. */
CANTUS_JSON_FIELDS(ChordSpan, rootPc, quality, startBeat, bassPc, intervals, degree,
                   secondaryDominant)
CANTUS_JSON_FIELDS(ChordSegment, startBeat, endBeat, chord)

/**
 * A resolved key `{scale, tonic, variant}`, the order resolveKey, tryResolveKeyName and
 * `Key#toJSON` write it.
 */
json::Value scale_first(const ResolvedKey& key);

/** The names of the key variants, for assert_one_of(). */
std::vector<std::string_view> key_variant_names();

/** `toKeyScale` over a wire KeyLike: a validated key/scale. */
KeyScale read_key_like(const json::Value& value);

/** A scale name argument, which TS refuses unless it is a string (`resolveScaleName`). */
const std::string& scale_name_arg(const json::Value& name);

/**
 * `resolveKey`'s reading of a wire KeyLike: a name, or the scale with the tonic and variant it
 * carries, each read the way TS reads it before the key is resolved.
 */
KeyArg read_key_arg(const json::Value& value);

/**
 * What `chordPcMask` checks of a wire chord before it reads the tones: a record whose intervals
 * are an array, each of which sums with the root to a finite pitch (the sum is JS addition, so a
 * string on either side makes it text), then the bass when `include_bass`.
 * @throws InvalidInputError with the TS message.
 */
void assert_mask_inputs(const json::Value& chord, bool include_bass = true);

/**
 * `chordToneSpellings` over a wire chord: one hint per interval, each read as a note (assertNote)
 * before its pitch class is compared with the tone's (`pitchClass(chord.rootPc + interval)`, a JS
 * sum), or nullopt when the list does not run one per interval or a hint names another tone.
 */
std::optional<std::vector<PitchSpelling>> read_tone_spellings(const json::Value& chord);

/**
 * What `chordToneLetterOffsets` reads of a wire chord: its tone spellings, then each interval up
 * to the root's (`pitchClass(interval) === 0`). Returns whether the chord names its tones' letters.
 */
bool reads_tone_letter_offsets(const json::Value& chord);

/**
 * What `chordRootSpelling` reads of a wire chord's root hint before it chooses it: the letter's
 * natural pitch class plus the alteration, as JS sums them.
 */
void read_root_hint(const json::Value& chord);

/**
 * What `spellChord` reads of an asserted wire chord's spelling hints: the root hint
 * (read_root_hint), then the tone spellings (reads_tone_letter_offsets).
 */
void read_spelled_hints(const json::Value& chord);

/**
 * What `refineByContext` reads of a wire context that read_spelling_context() cannot refuse, once
 * `pc` is a chromatic tone: a `chordRoot` beside no chord, or a null chord beside one, and each
 * neighbour (`next`, `previous`) whose distance from `pc` makes it the evidence.
 */
void read_context_evidence(const json::Value& context, double pc, const NoteData& tonic,
                           const KeyScale& key);

/** `assertModeMask` over a wire value. */
int read_mode_mask(const json::Value& value, std::string_view name);

/** `maskOf(value, name)` over a wire value: a record carrying a mode mask. */
int read_mask_of(const json::Value& value, std::string_view name);

/**
 * The quality a wire value names when `assertChordQuality` accepts it: a string the quality table
 * holds as its own key. Every wire reading of a chord quality goes through here.
 */
std::optional<ChordQuality> known_chord_quality(const json::Value& value);

/** `assertChordQuality` over a wire value. */
ChordQuality read_chord_quality(const json::Value& value);

/**
 * `assertChordQuality(chord.quality)` over a wire chord.
 * @throws InvalidInputError "Unknown chord quality: ..." for a quality no table has.
 */
ChordQuality assert_chord_quality(const json::Value& chord);

/**
 * `assertChord(value, name)` over a wire value: a record with a finite root and a known quality.
 * Returns the record.
 */
const json::Value& assert_chord(const json::Value& value, std::string_view name = "chord");

/**
 * A wire chord as a typed one, each field converted the way JS arithmetic reads it. The checks TS
 * makes are the adapter's, through the readers above; a quality TS never reads may be unknown and
 * reads as `fallback`.
 */
Chord read_chord_fields(const json::Value& value, ChordQuality fallback = ChordQuality::kMaj);

/**
 * What `chordSpecOf` reads of a wire chord's intervals (`chord.intervals ?? []`, then
 * `chordSpecFromIntervals` over a non-empty list): the offsets when every one is a number, else an
 * empty list, standing for a template with no structural reading.
 * @throws js::TypeError where JS cannot iterate the value, or cannot sort or compare its entries
 *         (a symbol, a bigint beside another value).
 */
std::vector<double> read_spec_intervals(const json::Value& intervals);

/**
 * What `chordSpecOf` reads of a chord's quality: the quality names the spec only when the
 * template has no structural reading of its own (`chordSpecForQuality`).
 */
void read_spec_quality(const Chord& chord, const json::Value& quality);

/**
 * What `hasInterval(chord, semitones)` reads of a wire chord whose intervals are an array: each
 * interval as a pitch, up to the first whose pitch class is `semitones`. Returns whether one is.
 */
bool reads_interval(const json::Value& chord, int semitones);

/** `copySpanIntervals`'s checks over a wire template. */
std::vector<double> read_span_intervals(const json::Value& intervals);

/** `makeChord`'s prologue over wire arguments: the root, the bass when given, the quality. */
Chord make_chord_from_wire(const json::Value& root, const json::Value& quality,
                           const json::Value& bass);

/**
 * `chordFromSpan`'s checks over a wire span: the root, the bass when given, the quality and the
 * interval template. The span's start beat is left at 0.
 */
ChordSpan read_chord_span(const json::Value& span);

/** `assertChordSpec` over a wire value. */
ChordSpec read_chord_spec(const json::Value& value);

/** `assertOptions(context)` and the fields of a wire SpellingContext. */
SpellingContext read_spelling_context(const json::Value& value);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_T1_H_
