// Transposing instruments: ts/src/theory/transposition/index.ts.

#include "cantus/theory/transposition.h"

#include <string>
#include <variant>

#include "cantus/core/errors.h"
#include "js/format.h"

namespace cantus {

namespace {

/** One entry of a table keyed by name, with a name. */
struct NamedName {
  std::string_view name;
  std::string_view value;
};

constexpr NamedName kTransposingInstruments[] =
#include "theory/transposition/transposing_instruments.gen.inc"
    ;

constexpr NamedName kProfileNameAliases[] =
#include "theory/transposition/profile_name_aliases.gen.inc"
    ;

template <std::size_t N>
const NamedName* find(const NamedName (&table)[N], std::string_view name) {
  for (const NamedName& row : table) {
    if (row.name == name) {
      return &row;
    }
  }
  return nullptr;
}

std::vector<TransposingInstrumentEntry> instruments() {
  std::vector<TransposingInstrumentEntry> out;
  for (const NamedName& row : kTransposingInstruments) {
    out.push_back(TransposingInstrumentEntry{row.name, row.value});
  }
  return out;
}

/** The same interval taken the other way (`reversedInterval`). */
SpelledInterval reversed_interval(const SpelledInterval& step) {
  SpelledInterval out;
  out.number = step.number;
  out.quality = step.quality;
  // Negating a zero span would yield -0.
  out.semitones = step.semitones == 0 ? 0 : -step.semitones;
  out.descending = !step.descending;
  return out;
}

}  // namespace

const std::vector<TransposingInstrumentEntry> TRANSPOSING_INSTRUMENTS = instruments();

SpelledInterval instrument_transposition(const IntervalArg& instrument) {
  const std::string* given = std::get_if<std::string>(&instrument.value());
  if (given == nullptr) {
    return to_spelled_interval(instrument);
  }
  // A profile whose tuning is named after the instrument answers from the instrument.
  const NamedName* alias = find(kProfileNameAliases, *given);
  std::string_view name = alias != nullptr ? alias->value : std::string_view(*given);
  if (const NamedName* known = find(kTransposingInstruments, name)) {
    return parse_interval(known->value);
  }
  try {
    return parse_interval(*given);
  } catch (const InvalidInputError&) {
    // A mistyped instrument name is the likely mistake, so the message names that possibility.
    throw InvalidInputError("unknown transposing instrument " + js::quote(*given) +
                            "; pass a name from TRANSPOSING_INSTRUMENTS or an interval such as "
                            "'-M2'");
  }
}

NoteData to_sounding_pitch(const NoteArg& note, const IntervalArg& instrument) {
  NoteData written = to_note_data(note);
  return transpose_by_interval(written, instrument_transposition(instrument));
}

NoteData to_written_pitch(const NoteArg& note, const IntervalArg& instrument) {
  NoteData sounding = to_note_data(note);
  return transpose_by_interval(sounding, reversed_interval(instrument_transposition(instrument)));
}

}  // namespace cantus
