/**
 * @file motif.h
 * @brief Internal pieces of ts/src/generate/motif/index.ts: the transforms and the development
 *        over notes already checked, which say which input note each result is a copy of.
 *
 * TS copies a note with `{ ...note }` where it only moves a field, so everything else the note
 * carries stays on the copy. A MotifResult names the note it copies, if any, so a caller holding
 * more than the typed fields can give the copy the same.
 */
#ifndef CANTUS_SRC_GENERATE_MOTIF_MOTIF_H_
#define CANTUS_SRC_GENERATE_MOTIF_MOTIF_H_

#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/motif.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** One note of a transformed or developed cell, in the numbers TS computes it in. */
struct MotifResult {
  double pitch = 0;
  double startBeat = 0;
  double durationBeat = 0;
  /** The index of the input note this one is a copy of, when it is one. */
  std::optional<std::size_t> source;
};

/** The options of generateMotif once its bars, meter, context, key and chord are read. */
struct MotifPlan {
  double bars = 0;
  double barBeats = 0;
  MotifContour contour = MotifContour::kArch;
  KeyScale key;
  std::optional<Chord> chord;
  /** `String(quality)` when the chord's quality is no name the table has: refused when read. */
  std::optional<std::string> unknownChordQuality;
};

/** generateMotif from the point its context is resolved; the note budget is already charged. */
MotifCell generate_motif_with(const MotifPlan& plan, const ResolvedContext& ctx);

/** The meter assumed when none is supplied (`DEFAULT_TS`). */
extern const TimeSignature kMotifDefaultTs;

/** The names of MOTIF_TRANSFORMS, for assert_one_of(). */
std::vector<std::string_view> motif_transform_names();

/** The names of the contours, for assert_one_of(). */
std::vector<std::string_view> motif_contour_names();

/** The total beat span a cell covers, from its first onset to its last offset (`cellSpan`). */
double cell_span(const std::vector<NoteEvent>& notes);

/**
 * The checks of transformUnchecked that follow the cell's own: the transform, then the amount.
 * @throws InvalidInputError for an amount the transform refuses.
 */
void assert_transform_amount(MotifTransform transform, std::optional<double> amount);

/**
 * The pitches of notes as numbers. TS keeps a pitch of -0 as -0; a caller holding the wire values
 * passes them to the functions below instead.
 */
std::vector<double> note_pitches(const std::vector<NoteEvent>& notes);

/** `transformCell` over notes the cell checks have accepted, with their pitches as written. */
std::vector<MotifResult> transform_notes(const std::vector<NoteEvent>& notes,
                                         const std::vector<double>& pitches,
                                         MotifTransform transform, std::optional<double> amount,
                                         const std::optional<KeyScale>& key);

/** The pitch classes of a chord, read when a position asks for them. */
using ChordTones = std::function<std::vector<int>()>;

/** The chord sounding at a beat, as the pitch classes it would give; empty for none. */
using ChordAt = std::function<std::optional<ChordTones>(double)>;

/** `developMotif` over notes the cell checks have accepted, with their pitches as written. */
std::vector<MotifResult> develop_notes(const std::vector<NoteEvent>& notes,
                                       const std::vector<double>& pitches, const ChordAt& chord_at,
                                       const KeyScale& scale, double bars,
                                       const TimeSignature& meter);

/** The notes of a result, as note events: a copy keeps the velocity and articulation it had. */
std::vector<NoteEvent> result_notes(const std::vector<NoteEvent>& source,
                                    const std::vector<MotifResult>& results);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_MOTIF_MOTIF_H_
