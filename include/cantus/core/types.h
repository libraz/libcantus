/**
 * @file types.h
 * @brief Public C++ API of ts/src/core/types.ts: the library-wide key and note shapes.
 *
 * Articulation is only declared here (an opaque enum is a complete type, so NoteEvent can hold
 * one); its enumerators, names and parser are in cantus/core/instrument.h, as in TS.
 */
#ifndef CANTUS_CORE_TYPES_H_
#define CANTUS_CORE_TYPES_H_

#include <cstdint>
#include <optional>

namespace cantus {

/** How a note is played, independent of its pitch and length (cantus/core/instrument.h). */
enum class Articulation : std::uint8_t;

/** A key/scale definition anchored on a root pitch class (`KeyScale`). */
struct KeyScale {
  /** Root pitch class, 0..11. */
  int rootPc = 0;
  /** 12-bit mask: bit n set means pitch class `(rootPc + n) % 12` belongs to the scale. */
  int modeMask12 = 0;
};

/** One sounding note on a beat-indexed timeline (`NoteEvent`). */
struct NoteEvent {
  /** MIDI pitch in [0, 127]. */
  int pitch = 0;
  /** Onset in quarter-note beats from the first downbeat; negative inside a pickup. */
  double startBeat = 0;
  /** Duration in quarter-note beats. */
  double durationBeat = 0;
  /** MIDI velocity in [0, 127], when known. */
  std::optional<int> velocity;
  /** How the note is played, when the writer recorded an intent. */
  std::optional<Articulation> articulation;
};

}  // namespace cantus

#endif  // CANTUS_CORE_TYPES_H_
