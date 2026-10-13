/**
 * @file codec_c1.h
 * @brief Wire codec of the types of core (layer root), core/validation, core/instrument,
 *        core/meter: CANTUS_JSON_FIELDS for output, and readers of the `*Like` inputs.
 *
 * The enum and ParseResult writers live in namespace cantus beside their types, where the codec
 * templates of ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_C1_H_
#define CANTUS_SRC_OPS_CODEC_C1_H_

#include <string>
#include <string_view>

#include "cantus/core/errors.h"
#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/error_map.h"

namespace cantus {

inline json::Value to_json(Articulation a) { return json::Value(to_string(a)); }
inline json::Value to_json(Limb l) { return json::Value(to_string(l)); }
inline json::Value to_json(PlayabilityIssueType t) { return json::Value(to_string(t)); }

/** An error as a ParseResult carries it: `{"$class": name, "message", "at"?}`. */
json::Value error_to_json(const Error& error);

/** `{"ok": true, "value"}` or `{"ok": false, "error"}`. */
template <class T>
json::Value to_json(const ParseResult<T>& result) {
  using ops::to_json;
  json::Object o;
  o.set("ok", result.ok());
  if (result.ok()) {
    o.set("value", to_json(result.value()));
  } else {
    o.set("error", error_to_json(result.error()));
  }
  return json::Value(std::move(o));
}

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(KeyScale, rootPc, modeMask12)
CANTUS_JSON_FIELDS(NoteEvent, pitch, startBeat, durationBeat, velocity, articulation)
CANTUS_JSON_FIELDS(TimeSignature, numerator, denominator, grouping)
CANTUS_JSON_FIELDS(MeterChange, startBeat, ts)
CANTUS_JSON_FIELDS(BarPosition, bar, beat)
CANTUS_JSON_FIELDS(StringedProfile, kind, name, tuning, frets, maxStretch, articulations, polyphony,
                   fretless)
CANTUS_JSON_FIELDS(StringFingering, string, fret)
CANTUS_JSON_FIELDS(InstrumentRange, low, high)
CANTUS_JSON_FIELDS(PlayabilityIssue, type, layer, notes, startBeat, impossible, message)
CANTUS_JSON_FIELDS(NotePlacement, note, fingering, limb)
CANTUS_JSON_FIELDS(PlayabilityReport, difficulty, issues, placements)

/** A kit: `reach` is written as an object keyed by MIDI note. */
void write_fields(const PercussionProfile& v, FieldWriter& w);

/**
 * The value a `*Like` argument resolves through its `toJSON` (`'toJSON' in value ? value.toJSON()
 * : value`): the payload of a `$tojson` tag, else the value itself. A `$class` instance carries its
 * data beside the tag, so its fields read in place.
 */
const json::Value& like_target(const json::Value& value);

/** like_target() as a result value: a `$class` instance loses its tag. */
json::Value like_data(json::Value value);

/** `readMeterData(value, name)` over a wire MeterLike. */
MeterData read_meter_like(const json::Value& value, std::string_view name = "meter");

/** `toInstrumentProfile(value, name)` over a wire InstrumentProfileLike. */
InstrumentProfile read_instrument_profile(const json::Value& value,
                                          std::string_view name = "instrument");

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_C1_H_
