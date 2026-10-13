/**
 * @file phrase.h
 * @brief Internal entry points of ts/src/analyze/form/phrase.ts beside the public API in
 *        cantus/analyze/form.h: the phrase search over a timeline and options a host reads on
 *        demand, and the wording of a cadence.
 */
#ifndef CANTUS_SRC_ANALYZE_FORM_PHRASE_H_
#define CANTUS_SRC_ANALYZE_FORM_PHRASE_H_

#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "analyze/timeline/timeline.h"
#include "cantus/analyze/form.h"

namespace cantus {

/**
 * A length option as the search reads it: the value given, or `fallback` when the option is
 * absent. The reader checks the value the way TS does where it reads it.
 */
using BeatsOption = std::function<double(double fallback)>;

/**
 * What phrases_from_timeline() reads from its timeline and options, each when TS first reads it,
 * so a caller holding them in another form fails in the order TS does. `opts` carries the rest.
 */
struct PhraseSource {
  /** The timeline's segment beats, which `assertChordTimeline` has checked. */
  std::vector<SegmentSpan> segments;
  /** The timeline's chords, read when a cadence scan first needs them. */
  ChordReads chords;
  /** `opts.totalBeats ?? notesEnd`, as the number the search takes the maximum of. */
  BeatsOption total_beats;
  /** `opts.restBeats ?? fallback`, checked as TS checks it. */
  BeatsOption rest_beats;
  /** `opts.longNoteBeats ?? fallback`. */
  BeatsOption long_note_beats;
  /** `opts.minPhraseBeats ?? fallback`. */
  BeatsOption min_phrase_beats;
  /** `opts.expectedPhraseBeats ?? fallback`. */
  BeatsOption expected_phrase_beats;
  /** The key context cadence detection runs against; unset infers one from the notes. */
  std::function<KeyAtBeat()> key;
  /** The downbeats of `opts.hypermeter`, read when first needed. */
  std::function<std::vector<double>()> given_downbeats;
};

/** The phrases and, for each, the segment its closing cadence arrived on. */
struct PhraseReading {
  std::vector<Phrase> phrases;
  std::vector<std::optional<std::size_t>> arrivals;
};

/**
 * phrases_from_timeline() over a source. `opts` supplies the meter, the hypermeter given (its
 * downbeats come from the source) and the budget; the options the source reads are not read from
 * it.
 * @throws InvalidInputError if a note or an option is invalid.
 */
PhraseReading phrases_over(const PhraseSource& source, const std::vector<NoteEvent>& notes,
                           const PhraseOptions& opts);

/** Name a cadence the way a rationale reads it (`describeCadence`), from its parts as text. */
std::string describe_cadence_text(const std::string& type,
                                  const std::optional<std::string>& strength,
                                  const std::string& at_beat);

/** Choose which of the candidate stops become phrase boundaries (`choosePhrasePath`). */
std::vector<std::size_t> choose_phrase_path(const std::vector<double>& beats,
                                            const std::vector<double>& strengths,
                                            double min_phrase_beats, double expected);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FORM_PHRASE_H_
