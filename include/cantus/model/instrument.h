/**
 * @file instrument.h
 * @brief Public C++ API of ts/src/model/instrument.ts: an immutable instrument.
 */
#ifndef CANTUS_MODEL_INSTRUMENT_H_
#define CANTUS_MODEL_INSTRUMENT_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/model/note.h"

namespace cantus {

/** The family an instrument belongs to (`InstrumentProfile['kind']`). */
enum class InstrumentKind : std::uint8_t { kStringed, kPercussion };

/** The TS name of a family ("stringed" or "percussion"). */
std::string_view to_string(InstrumentKind kind);

/**
 * An immutable instrument: what it physically is (an open-string tuning and a fret count, or the
 * voices each limb reaches), with the range, positions and playability checks of the instrument
 * module bound to it (`Instrument`).
 */
class Instrument {
 public:
  /**
   * Wrap an instrument profile, a built-in one or a caller's own (`Instrument.of`).
   * @throws InvalidInputError if the profile describes no instrument.
   */
  static Instrument of(const InstrumentProfileArg& profile);

  /** Six-string guitar in standard tuning (`Instrument.guitar`). */
  static Instrument guitar();

  /** Six-string guitar in drop D (`Instrument.guitarDropD`). */
  static Instrument guitar_drop_d();

  /** Electric bass in standard tuning (`Instrument.bass4`). */
  static Instrument bass4();

  /** Five-string bass with the low B (`Instrument.bass5`). */
  static Instrument bass5();

  /** Rebuild an instrument from its `data()` (`Instrument.fromData`). */
  static Instrument from_data(const InstrumentProfile& data);

  /** Rebuild an instrument from its `data()` (`Instrument.fromJSON`). */
  static Instrument from_json(const InstrumentProfile& data);

  /** The instrument's name. */
  const std::string& name() const;

  /** Which family the instrument belongs to. */
  InstrumentKind kind() const noexcept;

  /** Greatest number of notes that can sound at once. */
  int polyphony() const;

  /** The techniques the instrument can produce. */
  std::vector<Articulation> articulations() const;

  /** A copy of the underlying profile. */
  InstrumentProfile data() const;

  /** The lowest and highest pitch the instrument sounds. */
  InstrumentRange range() const;

  /**
   * Whether the instrument has this pitch at all (`canSound`).
   * @throws InvalidInputError if the pitch is not a MIDI pitch.
   */
  bool can_sound(int pitch) const;

  /**
   * Every neck position that sounds a pitch, lowest string first (`fingerings`).
   * @throws InvalidInputError if the instrument is a kit or the pitch is not a MIDI pitch.
   */
  std::vector<StringFingering> fingerings(int pitch) const;

  /**
   * Move a pitch by whole octaves until the instrument sounds it (`foldIntoRange`).
   * @throws InvalidInputError if the pitch is not a MIDI pitch.
   */
  int fold_into_range(int pitch) const;

  /**
   * The pitch this instrument sounds for a note written in its part (`soundingPitch`).
   * @param transposition The written-to-sounding transposition; the instrument's own name when
   *   absent.
   */
  Note sounding_pitch(const NoteArg& note,
                      const std::optional<IntervalArg>& transposition = std::nullopt) const;

  /** Judge whether a passage can be played, and how hard it is (`playability`). */
  PlayabilityReport playability(const std::vector<NoteEvent>& notes,
                                std::optional<double> bpm = std::nullopt) const;

  /** Whether another instrument is described identically. */
  bool equals(const Instrument& other) const;

  /** The instrument's name. */
  std::string to_string() const { return name(); }

 private:
  explicit Instrument(InstrumentProfile profile);

  InstrumentProfile profile_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_INSTRUMENT_H_
