/**
 * @file tendency.h
 * @brief Internal facts of ts/src/theory/tendency that the layers above share: what a chord is to
 *        a key. The leading tone, the dominant's sonority, the diatonic and Neapolitan readings,
 *        and which degrees of a key can be made a local tonic.
 */
#ifndef CANTUS_SRC_THEORY_TENDENCY_TENDENCY_H_
#define CANTUS_SRC_THEORY_TENDENCY_TENDENCY_H_

#include <optional>
#include <vector>

#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** A degree a chord can tonicize (`TonicizableDegree`). */
struct TonicizableDegree {
  /** 1-based degree number in the key's heptatonic frame. */
  int degreeNumber = 1;
  /** Pitch class of the degree's root. */
  int rootPc = 0;
  /** Whether the degree's own triad is minor, which cases its numeral. */
  bool lower = false;
};

/** The qualities a leading-tone chord takes (`LEADING_TONE_QUALITIES`). */
extern const std::vector<ChordQuality> LEADING_TONE_QUALITIES;

/** Whether every pitch class of a chord belongs to the key's scale (`isDiatonicChord`). */
bool is_diatonic_chord(const Chord& chord, const KeyScale& key);

/** Whether a chord's interval template carries a major third above its root (`hasMajorThird`). */
bool has_major_third(const Chord& chord);

/** Whether a chord sounds a major third with a minor seventh (`soundsDominantSeventh`). */
bool sounds_dominant_seventh(const Chord& chord);

/** Whether a chord sounds a major triad: a major third with no seventh (`soundsMajorTriad`). */
bool sounds_major_triad(const Chord& chord);

/** Whether a chord has the dominant's sonority (`hasDominantSonority`). */
bool has_dominant_sonority(const Chord& chord);

/** Whether a chord is the key's own dominant (`isDominantChordOf`). */
bool is_dominant_chord_of(const Chord& chord, const KeyScale& key);

/** Whether a chord is the Neapolitan of a key that lacks the flat second (`isNeapolitanChordOf`).
 */
bool is_neapolitan_chord_of(const Chord& chord, const KeyScale& key);

/** The seven-degree frame a key's degrees are counted in (`heptatonicFrameOf`). */
KeyScale heptatonic_frame_of(const KeyScale& key);

/** The degrees of a key that can be made a local tonic, in degree order (`tonicizableDegrees`). */
std::vector<TonicizableDegree> tonicizable_degrees(const KeyScale& key);

/** The degree an applied dominant may tonicize at a pitch class, or null (`appliedDominantTarget`).
 */
Nullable<TonicizableDegree> applied_dominant_target(double root_pc, const KeyScale& key);

/** Whether a key cadences through the raised seventh of the harmonic minor
 * (`cadencesThroughRaisedSeventh`). */
bool cadences_through_raised_seventh(const KeyScale& key);

/** The pitch class a semitone below the tonic (`leadingTonePcOf`). */
int leading_tone_pc_of(const KeyScale& key);

/** Whether a chord sounds the diminished triad a leading-tone chord is built on. */
bool sounds_diminished_triad(const Chord& chord);

/** Whether a chord is the key's leading-tone chord (`isLeadingToneChordOf`). */
bool is_leading_tone_chord_of(const Chord& chord, const KeyScale& key);

/** Whether the key's leading tone functions as one in a chord (`isFunctioningLeadingTone`). */
bool is_functioning_leading_tone(const Chord& chord, const KeyScale& key);

/** The chord's own seventh as a pitch class, if it has one (`seventhPcOf`). */
std::optional<int> seventh_pc_of(const Chord& chord);

/** The chord's own fifth as a pitch class, if it has one (`fifthPcOf`). */
std::optional<int> fifth_pc_of(const Chord& chord);

/** Whether a written melodic interval falls by a diatonic step (`isDescendingStep`). */
bool is_descending_step(const SpelledInterval& interval);

/** Whether a leading tone falls a third onto the arriving chord's fifth
 * (`isFrustratedLeadingTone`). */
bool is_frustrated_leading_tone(double from_pitch, double to_pitch, const Chord& next_chord);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_TENDENCY_TENDENCY_H_
