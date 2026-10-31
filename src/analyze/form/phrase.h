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

#include "analyze/form/hypermeter.h"
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
  /**
   * `opts.totalBeats`, unset when absent or null. The search checks its range before holding it
   * to the span start; a reader of another form checks only that it is a finite number.
   */
  std::function<std::optional<double>()> total_beats;
  /** `opts.restBeats ?? fallback`, checked as TS checks it. */
  BeatsOption rest_beats;
  /** `opts.longNoteBeats ?? fallback`. */
  BeatsOption long_note_beats;
  /** `opts.minPhraseBeats ?? fallback`. */
  BeatsOption min_phrase_beats;
  /** `opts.expectedPhraseBeats ?? fallback`. */
  BeatsOption expected_phrase_beats;
  /** The key context cadence detection runs against; unset reads one from `modulations`. */
  std::function<KeyAtBeat()> key;
  /** `detectModulations(timeline.segments, opts)`, asked for only when `key` is unset. */
  std::function<std::vector<KeyRegion>(const KeyTimelineOptions&)> modulations;
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

/**
 * The key in force at each beat over modulation regions, as its pitch classes, falling back to C
 * major (`keyContextFor` with no key given).
 */
KeyAtBeat modulation_key_at(std::vector<KeyRegion> regions);

/**
 * The cadences that mark a boundary, each once (`boundaryCadences`): the hits whose type is
 * known, the segment each arrived on where `found_arrivals` names it, and the span each arrival
 * chord sounds through.
 */
struct BoundaryCadences {
  std::vector<CadenceHit> hits;
  std::vector<std::size_t> arrivals;
  std::vector<CadenceSpan> spans;
};

/** boundary_cadences() over the hits a scan found, index for index with `found_arrivals`. */
BoundaryCadences boundary_cadences(const std::vector<CadenceHit>& found,
                                   const std::vector<std::size_t>& found_arrivals,
                                   const std::vector<SegmentSpan>& segments);

/** boundary_cadences() over a typed timeline, its cadences read against `key`. */
BoundaryCadences boundary_cadences(const ChordTimeline& timeline, const KeyContext& key);

/** Name a cadence the way a rationale reads it (`describeCadence`), from its parts as text. */
std::string describe_cadence_text(const std::string& type,
                                  const std::optional<std::string>& strength,
                                  const std::string& at_beat);

/** Per stop, the beat its cadence arrived on and the evidence left without that cadence. */
struct HeldCadences {
  std::vector<double> arrivals;
  std::vector<double> uncredited;
};

/**
 * Choose which of the candidate stops become phrase boundaries (`choosePhrasePath`). With `held`,
 * a stop whose cadence arrived before the phrase that would end there is worth only its other
 * evidence.
 */
std::vector<std::size_t> choose_phrase_path(const std::vector<double>& beats,
                                            const std::vector<double>& strengths,
                                            double min_phrase_beats, double expected,
                                            const HeldCadences* held = nullptr);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FORM_PHRASE_H_
