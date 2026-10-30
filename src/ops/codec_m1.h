/**
 * @file codec_m1.h
 * @brief Wire codec of the types of model/{shared, note, interval, duration, meter, tempo,
 *        tuning, instrument, voicing}: the `$class` form of each class, the readers of a class
 *        argument and of the data a factory takes, and the shared-helper twins over wire values.
 *
 * A model class crosses the boundary as `{"$class": "Note", ...toJSON()}` (a Voicing carries its
 * pitch array under `pitches`). A class argument is decoded the way the TS backend decodes it,
 * through `Class.fromData` over the fields beside the tag, so an instance that fails its own
 * checks is refused with the factory's message.
 */
#ifndef CANTUS_SRC_OPS_CODEC_M1_H_
#define CANTUS_SRC_OPS_CODEC_M1_H_

#include <memory>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/validation.h"
#include "cantus/model/duration.h"
#include "cantus/model/instrument.h"
#include "cantus/model/interval.h"
#include "cantus/model/meter.h"
#include "cantus/model/note.h"
#include "cantus/model/tempo.h"
#include "cantus/model/tuning.h"
#include "cantus/model/voicing.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"
#include "ops/counters.h"

namespace cantus {

/** `{"$class": "Note", letter, alter, octave?}` */
json::Value to_json(const Note& note);
/** `{"$class": "Interval", number, quality, semitones, descending}` */
json::Value to_json(const Interval& interval);
/** `{"$class": "Duration", base, dots, tuplet?}` */
json::Value to_json(const Duration& duration);
/** `{"$class": "Meter", numerator, denominator, grouping?}` */
json::Value to_json(const Meter& meter);
/** `{"$class": "Tempo", bpm}` */
json::Value to_json(const Tempo& tempo);
/** `{"$class": "Tuning", refStep, refFreq, divisions}` */
json::Value to_json(const Tuning& tuning);
/** `{"$class": "Instrument", ...profile}` */
json::Value to_json(const Instrument& instrument);
/** `{"$class": "Voicing", pitches}` */
json::Value to_json(const Voicing& voicing);

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(TempoData, bpm)

/** An instrument profile in the key order `Instrument#toJSON` writes it. */
json::Value instrument_data_json(const InstrumentProfile& profile);

/**
 * Give a result the sign of the zeros its source wrote at the same place: a `-0` that a class
 * copies from its input (a note's alteration, a duration's dot count, a pitch) is `-0` in the
 * copy, which a C++ integer cannot hold.
 */
void restore_signed_zero(json::Value& result, const json::Value& source);

//--------------------------------------------------------------------------------------------
// shared.ts over wire values

/** `assertDataObject`: the value as a data record. */
const json::Value& assert_data_object(const json::Value& value, std::string_view name);

/** `assertDataArray`: the value as a data array. */
const json::Array& assert_data_array(const json::Value& value, std::string_view name);

/** `assertKeyArgument`: refuse anything but a key where a method takes the key first. */
void assert_key_argument(const json::Value& value, std::string_view name);

/** `assertDataObjects`: the value as an array of data records, every element checked. */
const json::Array& assert_data_objects(const json::Value& value, std::string_view name);

/** `assertNoteEventArray`: an array of note events, its count capped before any is read. */
std::vector<NoteEvent> assert_note_event_array(const json::Value& notes, std::string_view name,
                                               const NoteEventAssertOptions& options = {});

/**
 * `copyPlain`: a deep copy of plain data, every number held finite; a function, a symbol or a
 * bigint is refused, and a class instance copies to the empty record its own fields make.
 */
json::Value copy_plain(const json::Value& value, std::string_view name);

/** `samePlain`: two plain values hold the same data, numbers and strings compared by `===`. */
bool same_plain(const json::Value& value, const json::Value& other);

//--------------------------------------------------------------------------------------------
// The data a factory takes (`new Note(data)`, `Note.fromData`, ...), over a wire value

/** `copyNote`. */
Note read_note_data(const json::Value& data);
/** `Interval.fromData`. */
Interval read_interval_data(const json::Value& data);
/** `copyDuration`, then the Duration. */
Duration read_duration_data(const json::Value& data);
/** `copyTimeSignature`, then the Meter. */
Meter read_meter_data(const json::Value& data);
/** `Tempo.fromData`: the marking of a data record. */
Tempo read_tempo_data(const json::Value& data);
/** `new Tempo(bpm)`: a marking. */
Tempo read_tempo_bpm(const json::Value& bpm);
/** `Tuning.of`. */
Tuning read_tuning_data(const json::Value& table);
/** `Instrument.of`. */
Instrument read_instrument_data(const json::Value& profile);
/** `new Voicing(pitches)`. */
Voicing read_voicing_data(const json::Value& pitches);

//--------------------------------------------------------------------------------------------
// A class instance in argument `i`

/**
 * Decode every `$class` value in `v` through its `Class.fromData`, innermost first, as dispatch
 * does a call's arguments; the decode of `v` itself, or null when `v` is no model-class value.
 * @throws RequestError (BAD_REQUEST) "unknown class ..." for a name that is no model class.
 */
std::shared_ptr<const Decoded> decode_class_value(const json::Value& v);

/** The `$class` instance of argument `i`. @throws RequestError if it is not a `name`. */
const json::Value& class_instance(const Args& a, std::size_t i, std::string_view name);

/**
 * The decode `D` kept for class argument `i`; else `make()` (a `std::shared_ptr<const D>`),
 * counted as one class decode and kept for the rest of the call.
 */
template <class D, class Make>
const D& kept_instance(const Args& a, std::size_t i, Make make) {
  if (const auto* kept = dynamic_cast<const D*>(a.decoded(i))) {
    return *kept;
  }
  counters::bump(counters::class_decodes);
  std::shared_ptr<const D> made = make();
  const D& out = *made;
  a.keep(i, std::move(made));
  return out;
}

/**
 * The decode of a class whose readers hand out a value. Argument `i`'s slot only ever holds the
 * decode of argument `i`'s own class, which the reader checks by name before it looks.
 */
template <class T>
struct DecodedValue final : Decoded {
  explicit DecodedValue(T v) : value(std::move(v)) {}
  T value;
};

/** `value` as a kept decode. */
template <class T>
std::shared_ptr<const Decoded> decoded_value(T value) {
  return std::make_shared<const DecodedValue<T>>(std::move(value));
}

/**
 * The `$class` instance `name` of argument `i` as `read` decodes it: the decode dispatch or the
 * snapshot kept, else `read(value)` counted and kept.
 */
template <class T, class Read>
const T& kept_value(const Args& a, std::size_t i, std::string_view name, Read read) {
  const json::Value& value = class_instance(a, i, name);
  return kept_instance<DecodedValue<T>>(
             a, i, [&value, &read] { return std::make_shared<const DecodedValue<T>>(read(value)); })
      .value;
}

Note read_note_instance(const Args& a, std::size_t i);
Interval read_interval_instance(const Args& a, std::size_t i);
Duration read_duration_instance(const Args& a, std::size_t i);
Meter read_meter_instance(const Args& a, std::size_t i);
Tempo read_tempo_instance(const Args& a, std::size_t i);
Tuning read_tuning_instance(const Args& a, std::size_t i);
Instrument read_instrument_instance(const Args& a, std::size_t i);
Voicing read_voicing_instance(const Args& a, std::size_t i);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_M1_H_
