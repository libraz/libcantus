/**
 * @file json.h
 * @brief JSON value, parser and writer with `JSON.parse` / `JSON.stringify` semantics.
 *
 * Strings are WTF-8: a lone UTF-16 surrogate read from `\udXXX` (or from raw WTF-8 input) is kept
 * as its three-byte generalized UTF-8 form, and a surrogate pair always collapses to one code
 * point. Object members keep JS property order: array-index keys first in ascending order, then
 * every other key in first-insertion order; a duplicate key overwrites the value in place.
 * Wire tags (`$n`, `$u`, ...) are not interpreted here.
 */
#ifndef CANTUS_JSON_JSON_H_
#define CANTUS_JSON_JSON_H_

#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

namespace cantus::json {

/** Deepest array/object nesting the parser accepts. */
inline constexpr std::size_t kMaxDepth = 4096;

/** Malformed or too deeply nested JSON text. */
class ParseError : public std::runtime_error {
 public:
  /**
   * @param message What was wrong.
   * @param offset Byte offset into the input where it was detected.
   */
  ParseError(const std::string& message, std::size_t offset);

  /** Byte offset into the input where the error was detected. */
  std::size_t offset() const noexcept { return offset_; }

 private:
  std::size_t offset_;
};

class Value;
struct Member;

/** Array of values. */
using Array = std::vector<Value>;

/** Ordered object with JS property-order semantics. */
class Object {
 public:
  Object();
  Object(const Object& other);
  Object(Object&& other) noexcept;
  Object& operator=(const Object& other);
  Object& operator=(Object&& other) noexcept;
  ~Object();

  /**
   * The object successive set() calls over `members`, in order, would build, in O(n log n) for
   * any order of keys.
   */
  static Object from_members(std::vector<Member> members);

  /** Insert `key` or overwrite its value, keeping JS property order. */
  void set(std::string key, Value value);
  /** The member's value, or nullptr when absent. */
  const Value* find(std::string_view key) const;
  /** Mutable access to the member's value, or nullptr when absent. */
  Value* find(std::string_view key);
  /** Whether `key` is present. */
  bool contains(std::string_view key) const { return find(key) != nullptr; }
  /** Number of members. */
  std::size_t size() const noexcept;
  /** Whether there are no members. */
  bool empty() const noexcept;

  /** Members in property order. */
  const Member* begin() const noexcept;
  const Member* end() const noexcept;

  friend bool operator==(const Object& a, const Object& b);
  friend bool operator!=(const Object& a, const Object& b) { return !(a == b); }

 private:
  friend class Value;

  std::ptrdiff_t index_of(std::string_view key) const;
  /** Where array-index key `n` belongs: after every smaller index key, before any other key. */
  std::size_t index_position(std::uint32_t n) const;

  std::vector<Member> members_;
  /** Lazily built key-to-position index for large objects; dropped when positions shift. */
  mutable std::unique_ptr<std::unordered_map<std::string, std::size_t>> index_;
};

/** Kind of a JSON value. */
enum class Kind { kNull, kBool, kNumber, kString, kArray, kObject };

/** A JSON value. Numbers are `double`, as in JS. */
class Value {
 public:
  Value();
  Value(std::nullptr_t);      // NOLINT(google-explicit-constructor)
  Value(bool b);              // NOLINT(google-explicit-constructor)
  Value(double n);            // NOLINT(google-explicit-constructor)
  Value(int n);               // NOLINT(google-explicit-constructor)
  Value(const char* s);       // NOLINT(google-explicit-constructor)
  Value(std::string s);       // NOLINT(google-explicit-constructor)
  Value(std::string_view s);  // NOLINT(google-explicit-constructor)
  Value(Array a);             // NOLINT(google-explicit-constructor)
  Value(Object o);            // NOLINT(google-explicit-constructor)
  /** Deep copy; nesting depth costs heap, not native stack. */
  Value(const Value& other);
  Value(Value&& other) noexcept;
  Value& operator=(const Value& other);
  Value& operator=(Value&& other) noexcept;
  ~Value();

  Kind kind() const noexcept { return static_cast<Kind>(data_.index()); }
  bool is_null() const noexcept { return kind() == Kind::kNull; }
  bool is_bool() const noexcept { return kind() == Kind::kBool; }
  bool is_number() const noexcept { return kind() == Kind::kNumber; }
  bool is_string() const noexcept { return kind() == Kind::kString; }
  bool is_array() const noexcept { return kind() == Kind::kArray; }
  bool is_object() const noexcept { return kind() == Kind::kObject; }

  /** @throws std::bad_variant_access when the kind differs. */
  bool as_bool() const { return std::get<bool>(data_); }
  double as_number() const { return std::get<double>(data_); }
  const std::string& as_string() const { return std::get<std::string>(data_); }
  const Array& as_array() const { return std::get<Array>(data_); }
  Array& as_array() { return std::get<Array>(data_); }
  const Object& as_object() const { return std::get<Object>(data_); }
  Object& as_object() { return std::get<Object>(data_); }

  /** Deep equality; numbers compare with `==`. Iterative, like copy and destruction. */
  friend bool operator==(const Value& a, const Value& b);
  friend bool operator!=(const Value& a, const Value& b) { return !(a == b); }

 private:
  /** Move the nested arrays and objects out of this value, leaving it with no container children.
   */
  void detach_children(std::vector<Value>& out);

  std::variant<std::nullptr_t, bool, double, std::string, Array, Object> data_;
};

/** One object member. */
struct Member {
  std::string key;
  Value value;
};

/**
 * Parse JSON text as `JSON.parse` does.
 *
 * Out-of-range numbers become ±Infinity (or ±0 on underflow). Input must be UTF-8, where encoded
 * surrogates (WTF-8) are accepted.
 * @throws ParseError on malformed input or nesting deeper than kMaxDepth.
 */
Value parse(std::string_view text);

/**
 * Serialize as `JSON.stringify` does, without whitespace.
 *
 * Numbers use js::to_string; non-finite numbers are written as `null`. Lone surrogates are
 * escaped as `\udXXX`.
 */
std::string stringify(const Value& value);

/** Append the serialization of `value` to `out`. */
void stringify_to(const Value& value, std::string& out);

}  // namespace cantus::json

#endif  // CANTUS_JSON_JSON_H_
