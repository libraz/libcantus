#include "cantus/model/instrument.h"

#include <utility>
#include <variant>

#include "cantus/core/validation.h"
#include "cantus/theory/transposition.h"
#include "core/instrument/profile.h"

namespace cantus {

namespace {

/**
 * A copy of a profile, lists and all. A neck carries `fretless` only when it has none, so a
 * profile that was copied and one written by hand serialize to the same object.
 */
InstrumentProfile copy_profile(const InstrumentProfile& profile) {
  if (const auto* stringed = std::get_if<StringedProfile>(&profile)) {
    StringedProfile copy = *stringed;
    if (!(stringed->fretless && *stringed->fretless)) {
      copy.fretless = std::nullopt;
    }
    return copy;
  }
  return std::get<PercussionProfile>(profile);
}

/** Whether two kits place the same limbs on the same voices. */
bool same_reach(const std::map<int, std::vector<Limb>>& a,
                const std::map<int, std::vector<Limb>>& b) {
  if (a.size() != b.size()) {
    return false;
  }
  for (const auto& [pitch, limbs] : a) {
    auto other = b.find(pitch);
    if (other == b.end() ? !limbs.empty() : limbs != other->second) {
      return false;
    }
  }
  return true;
}

}  // namespace

std::string_view to_string(InstrumentKind kind) {
  switch (kind) {
    case InstrumentKind::kStringed:
      return "stringed";
    case InstrumentKind::kPercussion:
      return "percussion";
  }
  return {};
}

Instrument::Instrument(InstrumentProfile profile) : profile_(std::move(profile)) {}

Instrument Instrument::of(const InstrumentProfileArg& profile) {
  return Instrument(copy_profile(to_instrument_profile(profile)));
}

Instrument Instrument::guitar() { return of(GUITAR_STANDARD); }

Instrument Instrument::guitar_drop_d() { return of(GUITAR_DROP_D); }

Instrument Instrument::bass4() { return of(BASS_4_STRING); }

Instrument Instrument::bass5() { return of(BASS_5_STRING); }

Instrument Instrument::from_data(const InstrumentProfile& data) { return of(data); }

Instrument Instrument::from_json(const InstrumentProfile& data) { return of(data); }

const std::string& Instrument::name() const {
  return std::visit([](const auto& profile) -> const std::string& { return profile.name; },
                    profile_);
}

InstrumentKind Instrument::kind() const noexcept {
  return std::holds_alternative<StringedProfile>(profile_) ? InstrumentKind::kStringed
                                                           : InstrumentKind::kPercussion;
}

int Instrument::polyphony() const {
  return std::visit([](const auto& profile) { return profile.polyphony; }, profile_);
}

std::vector<Articulation> Instrument::articulations() const {
  return std::visit([](const auto& profile) { return profile.articulations; }, profile_);
}

InstrumentProfile Instrument::data() const { return copy_profile(profile_); }

InstrumentRange Instrument::range() const { return range_in(profile_); }

bool Instrument::can_sound(int pitch) const {
  assert_midi_pitch(pitch, "pitch");
  return sounds_in(profile_, pitch);
}

std::vector<StringFingering> Instrument::fingerings(int pitch) const {
  const auto* stringed = std::get_if<StringedProfile>(&profile_);
  if (stringed == nullptr) {
    throw InvalidInputError(name() + " has no strings to finger");
  }
  assert_midi_pitch(pitch, "pitch");
  return fingerings_in(*stringed, pitch);
}

int Instrument::fold_into_range(int pitch) const {
  assert_midi_pitch(pitch, "pitch");
  return fold_in(pitch, profile_);
}

Note Instrument::sounding_pitch(const NoteArg& note,
                                const std::optional<IntervalArg>& transposition) const {
  NoteData written = to_note_data(note);
  return Note(to_sounding_pitch(written, transposition ? *transposition : IntervalArg(name())));
}

PlayabilityReport Instrument::playability(const std::vector<NoteEvent>& notes,
                                          std::optional<double> bpm) const {
  return cantus::playability(notes, profile_, bpm);
}

bool Instrument::equals(const Instrument& other) const {
  InstrumentProfile theirs = other.data();
  if (name() != other.name() || kind() != other.kind() || polyphony() != other.polyphony() ||
      articulations() != other.articulations()) {
    return false;
  }
  if (const auto* a = std::get_if<StringedProfile>(&profile_)) {
    const auto& b = std::get<StringedProfile>(theirs);
    return a->frets == b.frets && a->maxStretch == b.maxStretch &&
           a->fretless.value_or(false) == b.fretless.value_or(false) && a->tuning == b.tuning;
  }
  const auto& a = std::get<PercussionProfile>(profile_);
  const auto& b = std::get<PercussionProfile>(theirs);
  return a.limbs == b.limbs && same_reach(a.reach, b.reach) &&
         a.overdub.value_or(std::vector<int>{}) == b.overdub.value_or(std::vector<int>{});
}

}  // namespace cantus
