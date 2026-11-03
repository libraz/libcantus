/**
 * @file codec.h
 * @brief Wire format of the op boundary: value tags, `$$` key escaping, and the output codec.
 *
 * Inside the ops layer a value stays in wire form: tags are kept as tagged objects, and a user key
 * beginning with `$` stays escaped as `$$...`, so js::template_string and describe_rejected
 * read the same json::Value the host sent. validate() rejects an unknown or malformed tag before
 * any op runs, and stringify() writes the non-JSON numbers (NaN, ±Infinity, -0) as `$n` tags.
 *
 * Output structs declare their fields once, at namespace cantus::ops scope:
 * @code
 * CANTUS_JSON_FIELDS(NoteEvent, pitch, startBeat, duration)
 * @endcode
 * after which to_json(NoteEvent) writes an object with those keys in that order; a std::optional
 * field is omitted when empty and a Nullable field is written as null.
 */
#ifndef CANTUS_SRC_OPS_CODEC_H_
#define CANTUS_SRC_OPS_CODEC_H_

#include <cstdint>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/nullable.h"
#include "json/json.h"

namespace cantus::ops {

/** Kind of a wire value. */
enum class Tag {
  kNone,       ///< Not a tag: a JSON scalar, an array, or a plain object.
  kNumber,     ///< `{"$n": "-0" | "NaN" | "Infinity" | "-Infinity"}`
  kUndefined,  ///< `{"$u": 1}`
  kBigInt,     ///< `{"$big": "<decimal>"}`
  kSymbol,     ///< `{"$sym": "<description>"}`
  kToJson,     ///< `{"$tojson": <value>, "$repr": "<String(x)>"}`
  kClass,      ///< `{"$class": "Chord", ...data}`, or `{"$class": T, "$ref": id}` retained
  kHybrid,     ///< `{"$hy": "ChordTimeline", ...payload}`, or `{"$hy": T, "$ref": id}` retained
  kHandle,     ///< `{"$h": <id>, "$type": "Rng"}`
  kCallback,   ///< `{"$cb": <id>}`
  kIdentity,   ///< `{"$id": <n>, ...data}`
};

/** The tag of `v`, assuming validate() accepted it. */
Tag tag_of(const json::Value& v) noexcept;

/** What validate() found. */
struct ValidateStats {
  /** Number of `$cb` tags. */
  std::size_t callbacks = 0;
  /** Number of `$ref` values. */
  std::size_t refs = 0;
};

/**
 * Check that every tag in `v` is known and well formed, and that `$u` appears only as an array
 * element (or as the whole value when `allow_top_level_undefined`).
 * @throws RequestError (BAD_REQUEST) otherwise.
 */
ValidateStats validate(const json::Value& v, bool allow_top_level_undefined = false);

/** Which `$ref` values decode_host_value() replaces. */
enum class RefScope : std::uint8_t {
  kAll,        ///< Every one, `v` itself included.
  kArguments,  ///< `v` is a call's argument array: all but an argument that is itself a `$ref`.
  kNone,       ///< None: a builtin takes its arguments as sent.
};

/**
 * validate() a value the host supplied, then replace each `$ref` in `scope` by a copy of the value
 * it names, so no op reads a retained marker.
 * @throws RequestError as validate() does, or for a `$ref` that names no live value.
 */
ValidateStats decode_host_value(json::Value& v, bool allow_top_level_undefined = false,
                                RefScope scope = RefScope::kAll);

/** Serialize a wire value; NaN, ±Infinity and -0 are written as `$n` tags. */
std::string stringify(const json::Value& v);

/** Append the serialization of `v` to `out`. */
void stringify_to(const json::Value& v, std::string& out);

/** The `{"$u": 1}` value. */
const json::Value& undefined_value();

/** Whether `v` is the undefined tag. */
bool is_undefined(const json::Value& v) noexcept;

/** The number `v` stands for (a JSON number or a `$n` tag), or nullopt. */
std::optional<double> number_of(const json::Value& v) noexcept;

/** An enum as TS emits it: each value mapped to its name, then each name to its value. */
json::Value enum_object(std::initializer_list<std::pair<double, const char*>> entries);

/** Wire key of a user key: a leading `$` gains one more `$`. */
std::string escape_key(std::string_view key);

/** User key of a wire key: inverse of escape_key. */
std::string unescape_key(std::string_view wire_key);

class FieldWriter;

json::Value to_json(const json::Value& v);
json::Value to_json(bool b);
json::Value to_json(double d);
json::Value to_json(const std::string& s);
json::Value to_json(std::string_view s);
json::Value to_json(const char* s);
template <class T, std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool>, int> = 0>
json::Value to_json(T n);
template <class T>
json::Value to_json(const std::optional<T>& v);
template <class T>
json::Value to_json(const Nullable<T>& v);
template <class T>
json::Value to_json(const std::vector<T>& v);
template <class... Ts>
json::Value to_json(const std::variant<Ts...>& v);
template <class T>
auto to_json(const T& v) -> decltype(write_fields(v, std::declval<FieldWriter&>()), json::Value());

/** Builds the object of a CANTUS_JSON_FIELDS struct. */
class FieldWriter {
 public:
  /** Write `name: value`. */
  template <class T>
  void field(const char* name, const T& value) {
    object_.set(name, to_json(value));
  }

  /** Write `name: *value`, or nothing when empty (`x?: T`). */
  template <class T>
  void field(const char* name, const std::optional<T>& value) {
    if (value) {
      object_.set(name, to_json(*value));
    }
  }

  /** The finished object. */
  json::Object take() { return std::move(object_); }

 private:
  json::Object object_;
};

template <class T, std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool>, int>>
json::Value to_json(T n) {
  return json::Value(static_cast<double>(n));
}

/** An empty optional at the top level or in an array is undefined. */
template <class T>
json::Value to_json(const std::optional<T>& v) {
  return v ? to_json(*v) : undefined_value();
}

template <class T>
json::Value to_json(const Nullable<T>& v) {
  return v ? to_json(*v) : json::Value(nullptr);
}

template <class T>
json::Value to_json(const std::vector<T>& v) {
  json::Array a;
  a.reserve(v.size());
  for (const T& e : v) {
    a.push_back(to_json(e));
  }
  return json::Value(std::move(a));
}

template <class... Ts>
json::Value to_json(const std::variant<Ts...>& v) {
  return std::visit([](const auto& alt) { return to_json(alt); }, v);
}

template <class T>
auto to_json(const T& v) -> decltype(write_fields(v, std::declval<FieldWriter&>()), json::Value()) {
  FieldWriter w;
  write_fields(v, w);
  return json::Value(w.take());
}

}  // namespace cantus::ops

// Field iteration for CANTUS_JSON_FIELDS, up to 64 fields.
// clang-format off
#define CANTUS_JF_COUNT_(  _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43, _44, _45, _46, _47, _48, _49, _50, _51, _52, _53, _54, _55, _56, _57, _58, _59, _60, _61, _62, _63, _64, n, ...) n
#define CANTUS_JF_COUNT(...) CANTUS_JF_COUNT_(__VA_ARGS__, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0)
#define CANTUS_JF_CAT_(a, b) a##b
#define CANTUS_JF_CAT(a, b) CANTUS_JF_CAT_(a, b)
#define CANTUS_JF_1(f) w.field(#f, v.f);
#define CANTUS_JF_2(f, ...) w.field(#f, v.f); CANTUS_JF_1(__VA_ARGS__)
#define CANTUS_JF_3(f, ...) w.field(#f, v.f); CANTUS_JF_2(__VA_ARGS__)
#define CANTUS_JF_4(f, ...) w.field(#f, v.f); CANTUS_JF_3(__VA_ARGS__)
#define CANTUS_JF_5(f, ...) w.field(#f, v.f); CANTUS_JF_4(__VA_ARGS__)
#define CANTUS_JF_6(f, ...) w.field(#f, v.f); CANTUS_JF_5(__VA_ARGS__)
#define CANTUS_JF_7(f, ...) w.field(#f, v.f); CANTUS_JF_6(__VA_ARGS__)
#define CANTUS_JF_8(f, ...) w.field(#f, v.f); CANTUS_JF_7(__VA_ARGS__)
#define CANTUS_JF_9(f, ...) w.field(#f, v.f); CANTUS_JF_8(__VA_ARGS__)
#define CANTUS_JF_10(f, ...) w.field(#f, v.f); CANTUS_JF_9(__VA_ARGS__)
#define CANTUS_JF_11(f, ...) w.field(#f, v.f); CANTUS_JF_10(__VA_ARGS__)
#define CANTUS_JF_12(f, ...) w.field(#f, v.f); CANTUS_JF_11(__VA_ARGS__)
#define CANTUS_JF_13(f, ...) w.field(#f, v.f); CANTUS_JF_12(__VA_ARGS__)
#define CANTUS_JF_14(f, ...) w.field(#f, v.f); CANTUS_JF_13(__VA_ARGS__)
#define CANTUS_JF_15(f, ...) w.field(#f, v.f); CANTUS_JF_14(__VA_ARGS__)
#define CANTUS_JF_16(f, ...) w.field(#f, v.f); CANTUS_JF_15(__VA_ARGS__)
#define CANTUS_JF_17(f, ...) w.field(#f, v.f); CANTUS_JF_16(__VA_ARGS__)
#define CANTUS_JF_18(f, ...) w.field(#f, v.f); CANTUS_JF_17(__VA_ARGS__)
#define CANTUS_JF_19(f, ...) w.field(#f, v.f); CANTUS_JF_18(__VA_ARGS__)
#define CANTUS_JF_20(f, ...) w.field(#f, v.f); CANTUS_JF_19(__VA_ARGS__)
#define CANTUS_JF_21(f, ...) w.field(#f, v.f); CANTUS_JF_20(__VA_ARGS__)
#define CANTUS_JF_22(f, ...) w.field(#f, v.f); CANTUS_JF_21(__VA_ARGS__)
#define CANTUS_JF_23(f, ...) w.field(#f, v.f); CANTUS_JF_22(__VA_ARGS__)
#define CANTUS_JF_24(f, ...) w.field(#f, v.f); CANTUS_JF_23(__VA_ARGS__)
#define CANTUS_JF_25(f, ...) w.field(#f, v.f); CANTUS_JF_24(__VA_ARGS__)
#define CANTUS_JF_26(f, ...) w.field(#f, v.f); CANTUS_JF_25(__VA_ARGS__)
#define CANTUS_JF_27(f, ...) w.field(#f, v.f); CANTUS_JF_26(__VA_ARGS__)
#define CANTUS_JF_28(f, ...) w.field(#f, v.f); CANTUS_JF_27(__VA_ARGS__)
#define CANTUS_JF_29(f, ...) w.field(#f, v.f); CANTUS_JF_28(__VA_ARGS__)
#define CANTUS_JF_30(f, ...) w.field(#f, v.f); CANTUS_JF_29(__VA_ARGS__)
#define CANTUS_JF_31(f, ...) w.field(#f, v.f); CANTUS_JF_30(__VA_ARGS__)
#define CANTUS_JF_32(f, ...) w.field(#f, v.f); CANTUS_JF_31(__VA_ARGS__)
#define CANTUS_JF_33(f, ...) w.field(#f, v.f); CANTUS_JF_32(__VA_ARGS__)
#define CANTUS_JF_34(f, ...) w.field(#f, v.f); CANTUS_JF_33(__VA_ARGS__)
#define CANTUS_JF_35(f, ...) w.field(#f, v.f); CANTUS_JF_34(__VA_ARGS__)
#define CANTUS_JF_36(f, ...) w.field(#f, v.f); CANTUS_JF_35(__VA_ARGS__)
#define CANTUS_JF_37(f, ...) w.field(#f, v.f); CANTUS_JF_36(__VA_ARGS__)
#define CANTUS_JF_38(f, ...) w.field(#f, v.f); CANTUS_JF_37(__VA_ARGS__)
#define CANTUS_JF_39(f, ...) w.field(#f, v.f); CANTUS_JF_38(__VA_ARGS__)
#define CANTUS_JF_40(f, ...) w.field(#f, v.f); CANTUS_JF_39(__VA_ARGS__)
#define CANTUS_JF_41(f, ...) w.field(#f, v.f); CANTUS_JF_40(__VA_ARGS__)
#define CANTUS_JF_42(f, ...) w.field(#f, v.f); CANTUS_JF_41(__VA_ARGS__)
#define CANTUS_JF_43(f, ...) w.field(#f, v.f); CANTUS_JF_42(__VA_ARGS__)
#define CANTUS_JF_44(f, ...) w.field(#f, v.f); CANTUS_JF_43(__VA_ARGS__)
#define CANTUS_JF_45(f, ...) w.field(#f, v.f); CANTUS_JF_44(__VA_ARGS__)
#define CANTUS_JF_46(f, ...) w.field(#f, v.f); CANTUS_JF_45(__VA_ARGS__)
#define CANTUS_JF_47(f, ...) w.field(#f, v.f); CANTUS_JF_46(__VA_ARGS__)
#define CANTUS_JF_48(f, ...) w.field(#f, v.f); CANTUS_JF_47(__VA_ARGS__)
#define CANTUS_JF_49(f, ...) w.field(#f, v.f); CANTUS_JF_48(__VA_ARGS__)
#define CANTUS_JF_50(f, ...) w.field(#f, v.f); CANTUS_JF_49(__VA_ARGS__)
#define CANTUS_JF_51(f, ...) w.field(#f, v.f); CANTUS_JF_50(__VA_ARGS__)
#define CANTUS_JF_52(f, ...) w.field(#f, v.f); CANTUS_JF_51(__VA_ARGS__)
#define CANTUS_JF_53(f, ...) w.field(#f, v.f); CANTUS_JF_52(__VA_ARGS__)
#define CANTUS_JF_54(f, ...) w.field(#f, v.f); CANTUS_JF_53(__VA_ARGS__)
#define CANTUS_JF_55(f, ...) w.field(#f, v.f); CANTUS_JF_54(__VA_ARGS__)
#define CANTUS_JF_56(f, ...) w.field(#f, v.f); CANTUS_JF_55(__VA_ARGS__)
#define CANTUS_JF_57(f, ...) w.field(#f, v.f); CANTUS_JF_56(__VA_ARGS__)
#define CANTUS_JF_58(f, ...) w.field(#f, v.f); CANTUS_JF_57(__VA_ARGS__)
#define CANTUS_JF_59(f, ...) w.field(#f, v.f); CANTUS_JF_58(__VA_ARGS__)
#define CANTUS_JF_60(f, ...) w.field(#f, v.f); CANTUS_JF_59(__VA_ARGS__)
#define CANTUS_JF_61(f, ...) w.field(#f, v.f); CANTUS_JF_60(__VA_ARGS__)
#define CANTUS_JF_62(f, ...) w.field(#f, v.f); CANTUS_JF_61(__VA_ARGS__)
#define CANTUS_JF_63(f, ...) w.field(#f, v.f); CANTUS_JF_62(__VA_ARGS__)
#define CANTUS_JF_64(f, ...) w.field(#f, v.f); CANTUS_JF_63(__VA_ARGS__)
// clang-format on

/**
 * Declare the output fields of `Type`, in order. Use at namespace cantus::ops scope; each field
 * name is both the C++ member and the JSON key.
 */
#define CANTUS_JSON_FIELDS(Type, ...)                                                       \
  inline void write_fields([[maybe_unused]] const Type& v, ::cantus::ops::FieldWriter& w) { \
    CANTUS_JF_CAT(CANTUS_JF_, CANTUS_JF_COUNT(__VA_ARGS__))(__VA_ARGS__)                    \
  }

#endif  // CANTUS_SRC_OPS_CODEC_H_
