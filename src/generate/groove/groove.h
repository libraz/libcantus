/**
 * @file groove.h
 * @brief Internal pieces of ts/src/generate/groove/index.ts: humanize once its options are read.
 */
#ifndef CANTUS_SRC_GENERATE_GROOVE_GROOVE_H_
#define CANTUS_SRC_GENERATE_GROOVE_GROOVE_H_

#include <optional>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/groove.h"

namespace cantus {

/** The options of humanize after their checks. */
struct HumanizeRequest {
  /** The meter accents are read against, in the signature in force at each note. */
  MeterData ts;
  double timing = 0;
  double velocityJitter = 0;
  double accent = 0;
  double baseVelocity = 0;
};

/** One note after a template is applied: its onset, and the velocity the slot recorded, if any. */
struct GroovedNote {
  double startBeat = 0;
  std::optional<double> velocity;
};

/**
 * applyGrooveTemplate over the sounding notes of a template the checks have accepted: each note
 * snapped to its slot and offset by the slot's timing; the velocity is the slot's rounded average
 * where it recorded one.
 */
std::vector<GroovedNote> groove_notes(const std::vector<NoteEvent>& sounding,
                                      const GrooveTemplate& groove_template,
                                      const TimeSignature& meter);

/**
 * The one signature a groove grid is laid on (`grooveSignature`).
 * @throws InvalidInputError if the meter changes signature.
 */
TimeSignature groove_signature(const MeterData& meter);

/** The meter humanize reads accents against when the caller names none (`DEFAULT_TS`). */
extern const TimeSignature kGrooveDefaultTs;

/** humanize over the sounding notes, from the point its draw is resolved. */
std::vector<NoteEvent> humanize_with(const std::vector<NoteEvent>& sounding,
                                     const HumanizeRequest& request, const Draw& draw);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_GROOVE_GROOVE_H_
