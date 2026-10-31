/**
 * @file groove.h
 * @brief Public C++ API of ts/src/generate/groove: humanization, and the timing-and-velocity
 *        feel of a performance captured as a reusable template.
 *
 * Positions and durations are measured in quarter-note beats. Randomness goes through the seeded
 * positional source of the generation context, so results are fully reproducible.
 */
#ifndef CANTUS_GENERATE_GROOVE_H_
#define CANTUS_GENERATE_GROOVE_H_

#include <optional>
#include <string>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"

namespace cantus {

/** Options of humanize() (`HumanizeOptions`). */
struct HumanizeOptions {
  /**
   * Time signature used to derive metric accents, a meter map read bar by bar; 4/4 when absent.
   */
  std::optional<MeterArg> ts;
  /** Maximum timing jitter in quarter-note beats, applied as plus or minus; 0.02 when absent. */
  std::optional<double> timing;
  /** Maximum velocity jitter in MIDI units, applied as plus or minus; 8 when absent. */
  std::optional<double> velocity;
  /** How much louder strong beats get than weak ones, in MIDI units; 12 when absent. */
  std::optional<double> accent;
  /** Velocity assumed for events with none of their own; 80 when absent. */
  std::optional<double> baseVelocity;
  /** The generation context; `{ seed: 0 }` when absent. */
  std::optional<GenerationContextInput> ctx;
  /** The name this call draws under; "humanize" when absent. */
  std::optional<std::string> part;
};

/**
 * Nudge the timing and velocity of note events with small, seeded randomness plus a metric accent
 * (`humanize`). Notes that never sound are dropped; the rest come back as copies in input order.
 * @throws InvalidInputError if an option is outside its range or an event is malformed.
 */
std::vector<NoteEvent> humanize(const std::vector<NoteEvent>& events,
                                const HumanizeOptions& opts = {});

/** The recorded feel at a single grid slot (`GrooveSlot`). */
struct GrooveSlot {
  /** Average `actualStartBeat - quantizedBeat` of the events landing on this slot. */
  double timingOffset = 0;
  /** Average velocity of the events landing on this slot, or null if none carried one. */
  Nullable<double> velocity;
};

/** A per-bar grid of timing and velocity deviations captured from a performance. */
struct GrooveTemplate {
  /** Grid resolution: equal grid steps per quarter-note beat. */
  int subdivision = 0;
  /** Number of grid slots per bar (`beatsPerBar(ts) * subdivision`). */
  int slotsPerBar = 0;
  /** One entry per grid slot, in slot-index order. */
  std::vector<GrooveSlot> slots;
  /** The time signature the template was extracted under; no check is made when absent. */
  std::optional<TimeSignature> ts;
};

/**
 * Capture the feel of a performance as a template (`extractGrooveTemplate`). The subdivision is a
 * sixteenth-note grid (4) when absent.
 * @throws InvalidInputError if the meter is malformed or changes signature, or the subdivision or
 *   an event is malformed.
 */
GrooveTemplate extract_groove_template(const std::vector<NoteEvent>& events, const MeterArg& ts,
                                       std::optional<int> subdivision = std::nullopt);

/**
 * Snap events to a template's grid and offset them by its recorded deviations
 * (`applyGrooveTemplate`). Notes that never sound are omitted.
 * @throws InvalidInputError if `ts` changes signature, the template's meter or slot count does
 *   not fit `ts`, a slot carries a non-finite offset or a velocity outside [0, 127], or an event is
 *   malformed.
 */
std::vector<NoteEvent> apply_groove_template(const std::vector<NoteEvent>& events,
                                             const GrooveTemplate& groove_template,
                                             const MeterArg& ts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_GROOVE_H_
