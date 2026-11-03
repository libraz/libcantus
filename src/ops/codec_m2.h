/**
 * @file codec_m2.h
 * @brief Wire codec of the types of model/{key, chord, progression, timeline, score}: the
 *        `$class` form of each class, the readers of the data a factory takes, and the readers of
 *        a class argument.
 *
 * The wire forms are the TS backend's: a Key is `{"$class": "Key", scale, tonic, variant}`, a
 * Chord its toJSON() data plus the carried key under `key`, a Progression `{chords, key}` of its
 * getters, a Timeline and a Score their toJSON() data. Data is written in the key order the TS
 * class writes it, which for a chord is copyChord's: the spelling hints the caller supplied first,
 * the ones the carried key derives after them.
 */
#ifndef CANTUS_SRC_OPS_CODEC_M2_H_
#define CANTUS_SRC_OPS_CODEC_M2_H_

#include <initializer_list>
#include <memory>
#include <string_view>
#include <utility>

#include "cantus/core/tempo.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/model/progression.h"
#include "cantus/model/score.h"
#include "cantus/model/timeline.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/codec_a1b.h"
#include "ops/codec_m1.h"
#include "ops/codec_t1.h"

namespace cantus {

/** `{"$class": "Key", scale, tonic, variant}` */
json::Value to_json(const Key& key);
/** `{"$class": "Chord", ...toJSON(), key?}` */
json::Value to_json(const ChordValue& chord);
/** `{"$class": "Progression", chords, key?}` */
json::Value to_json(const Progression& progression);
/** `{"$class": "Timeline", segments, totalBeats, keys?, segmentConfidence?}` */
json::Value to_json(const Timeline& timeline);
/** `{"$class": "Score", notes, meters, tempo, key?}` */
json::Value to_json(const Score& score);

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(TempoEvent, startBeat, bpm)

//--------------------------------------------------------------------------------------------
// Plain data, in the key order the TS classes write it

/** Chord data in copyChord's key order (`Chord#toJSON`). */
json::Value copied_chord_json(const Chord& chord);
/** A chord's `data`: copyChord's fields, then the spellings the carried key derives. */
json::Value chord_view_json(const ChordValue& chord);
/** A key region in copyKeyRegion's key order. */
json::Value key_region_json(const KeyRegion& region);
/** A timeline's `data`. */
json::Value timeline_data_json(const TimelineData& data);
/** A score's `data`. */
json::Value score_data_json(const ScoreData& data);
/** The plain wire record of named values; an undefined one is left out. */
json::Value wire_record(std::initializer_list<std::pair<const char*, const json::Value*>> fields);
/** A record with the named fields left out. */
json::Value without(const json::Value& record, std::initializer_list<std::string_view> names);
/** `spanEnd(...runs)` over settled wire spans: where the last ends, never before beat 0. */
double settled_span_end(std::initializer_list<const json::Value*> runs);
/** `{...value}` into `out`: the own enumerable fields of a plain record, array or string. */
void spread_into(json::Object& out, const json::Value& value);

//--------------------------------------------------------------------------------------------
// A value read through its public surface, as TS code reads whatever it was handed

/**
 * `value[name]`: a model-class getter's value (through the getter's op), any other member of a
 * class as a function value, a `toJSON` carrier's two methods, a plain value's own field.
 */
json::Value member_of(const json::Value& value, std::string_view name);
/** `name in value` for an object: an own field, or a member of the class it is an instance of. */
bool has_member(const json::Value& value, std::string_view name);
/** `value.toJSON()` of a class instance or a `toJSON` carrier. */
json::Value class_to_json(const json::Value& value);
/**
 * `value[name](...args)`: a method of a class instance through the method's op, or a function a
 * plain record carries, called on `host`.
 */
json::Value call_member(const json::Value& value, std::string_view name, json::Array args,
                        const CallContext& host = CallContext());
/** The named members of a value as a plain record: a class instance read through its getters. */
json::Value surface_record(const json::Value& value, std::initializer_list<std::string_view> names);
/** `[...value]`: an array, a string's code units, or what a Progression or a Timeline yields. */
json::Array spread_iterable(const json::Value& value, std::string_view name);
/** A model-class value's own `toString()`, which js::template_string() writes it with. */
std::string class_text(const json::Value& value);

//--------------------------------------------------------------------------------------------
// The data a factory takes, over a wire value

/** `new Key(scale, tonic, variant)`, the tonic already read as a note. */
Key read_key_parts(const json::Value& scale, const Note& tonic, const json::Value& variant);
/** `Key.fromJSON`. */
Key read_key_data(const json::Value& data);
/** `toKey`: a key name, a key/scale, key data, or anything whose toJSON is one of those. */
Key read_key_value(const json::Value& value);
/** `toKey` behind `assertKeyArgument`, or nothing for undefined. */
std::optional<Key> read_key_argument(const json::Value& value, std::string_view name);

/** copyChord's reading of plain chord data, validated in the TS order. */
Chord read_chord_data(const json::Value& data);
/** `new Chord(data, key)`. */
ChordValue read_chord_value(const json::Value& data, const json::Value& key);

/** `new Progression(chords, key)`. */
Progression read_progression_value(const json::Value& chords, const json::Value& key);
/** `Progression.fromJSON`. */
Progression read_progression_data(const json::Value& data);

/** copyKeyRegion over a wire region. */
KeyRegion read_key_region(const json::Value& region);
/** `new Timeline(data)`. */
Timeline read_timeline_data(const json::Value& data);

/** `new Score(data)`. */
Score read_score_data(const json::Value& data);

//--------------------------------------------------------------------------------------------
// A class instance in argument `i`, or anywhere in a wire value

/** Whether a wire value is a `$class` instance named `name`. */
bool is_class_value(const json::Value& value, std::string_view name);

Key read_key_instance(const Args& a, std::size_t i);
ChordValue read_chord_instance(const Args& a, std::size_t i);
Progression read_progression_instance(const Args& a, std::size_t i);
/** The Timeline of argument `i`, decoded at most once a call (never for a snapshot). */
const Timeline& timeline_instance(const Args& a, std::size_t i);
/** The Score of argument `i`, decoded at most once a call (never for a snapshot). */
const Score& score_instance(const Args& a, std::size_t i);

/** A `$class` Key value. */
Key read_key_class(const json::Value& value);
/** A `$class` Chord value. */
ChordValue read_chord_class(const json::Value& value);
/** A `$class` Progression value. */
Progression read_progression_class(const json::Value& value);

/**
 * Validate a `$class` value of a class of this group, setting `kept` to its decode; false when the
 * name is not one.
 */
bool decode_m2_class(const json::Value& value, std::string_view name,
                     std::shared_ptr<const Decoded>& kept);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_M2_H_
