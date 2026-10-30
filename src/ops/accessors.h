/**
 * @file accessors.h
 * @brief The ways TS reads an option field that may be null.
 *
 * | TS                    | accessor            | absent  | null            |
 * |-----------------------|---------------------|---------|-----------------|
 * | `opts.x ?? d`         | opt_null_default    | nullopt | nullopt         |
 * | `opts.x ?? d` (value) | opt_or              | d       | d               |
 * | `opts.x === undefined`| opt_strict          | nullopt | read(null)      |
 * | `assertNullable(...)` | opt_nullable        | nullopt | Nullable(empty) |
 *
 * Each takes the options value as received (anything but an object has no fields) and the user
 * key. The overloads with `read` pass the present value to it, typically a loose validator from
 * ops/validate.h, so the rejection message is the TS one.
 */
#ifndef CANTUS_SRC_OPS_ACCESSORS_H_
#define CANTUS_SRC_OPS_ACCESSORS_H_

#include <optional>
#include <string_view>
#include <type_traits>

#include "cantus/core/nullable.h"
#include "json/json.h"

namespace cantus::ops {

/** Field `key` of `opts`, or nullptr when `opts` is not an object, the key is absent or `$u`. */
const json::Value* field(const json::Value& opts, std::string_view key) noexcept;

/** `opts.key ?? default`: nullptr when absent or null. */
const json::Value* opt_null_default(const json::Value& opts, std::string_view key) noexcept;

/** `opts.key ?? fallback`, as the value TS then checks. */
json::Value opt_or(const json::Value& opts, std::string_view key, const json::Value& fallback);

/** `opts.key === undefined`: nullptr only when absent; null is returned for `read` to reject. */
inline const json::Value* opt_strict(const json::Value& opts, std::string_view key) noexcept {
  return field(opts, key);
}

/** Presence of a nullable field. */
enum class Presence { kAbsent, kNull, kValue };

/** Presence of field `key`, for `assertNullable`. */
Presence opt_nullable(const json::Value& opts, std::string_view key) noexcept;

/** `read(opts.key)`, or nullopt when absent or null. */
template <class F>
auto opt_null_default(const json::Value& opts, std::string_view key, F&& read)
    -> std::optional<std::decay_t<std::invoke_result_t<F, const json::Value&>>> {
  const json::Value* v = opt_null_default(opts, key);
  if (v == nullptr) {
    return std::nullopt;
  }
  return read(*v);
}

/** `read(opts.key)`, or nullopt when absent; a null value reaches `read`. */
template <class F>
auto opt_strict(const json::Value& opts, std::string_view key, F&& read)
    -> std::optional<std::decay_t<std::invoke_result_t<F, const json::Value&>>> {
  const json::Value* v = opt_strict(opts, key);
  if (v == nullptr) {
    return std::nullopt;
  }
  return read(*v);
}

/** nullopt when absent, an empty Nullable when null, else `read(opts.key)`. */
template <class F>
auto opt_nullable(const json::Value& opts, std::string_view key, F&& read)
    -> std::optional<Nullable<std::decay_t<std::invoke_result_t<F, const json::Value&>>>> {
  using T = std::decay_t<std::invoke_result_t<F, const json::Value&>>;
  switch (opt_nullable(opts, key)) {
    case Presence::kAbsent:
      return std::nullopt;
    case Presence::kNull:
      return Nullable<T>();
    case Presence::kValue:
      break;
  }
  return Nullable<T>(read(*field(opts, key)));
}

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_ACCESSORS_H_
