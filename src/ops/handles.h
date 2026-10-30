/**
 * @file handles.h
 * @brief The process-wide handle table behind `{"$h": id, "$type": T}` and retained values.
 *
 * The table is guarded by a mutex; a looked-up handle is held by shared_ptr, so releasing it
 * while a method runs only takes effect once the method returns. Ids are never reused.
 *
 * A retained value (`$retain`) is an immutable snapshot in the same table, named on the wire by
 * `{"$class"|"$hy": T, "$ref": id}`. It is built completely before it is shared, so unlike other
 * handles it may be read from several threads at once.
 */
#ifndef CANTUS_SRC_OPS_HANDLES_H_
#define CANTUS_SRC_OPS_HANDLES_H_

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

#include "json/json.h"

namespace cantus::ops {

/** Base of every object held behind a handle. */
class Handle {
 public:
  virtual ~Handle() = default;
};

/** Register `object` as a handle of `type` and return its `$h` tag. */
json::Value new_handle(std::shared_ptr<Handle> object, std::string type);

/** new_handle() for a type that names itself with `static constexpr const char* kTypeName`. */
template <class T>
json::Value new_handle(std::shared_ptr<T> object) {
  return new_handle(std::shared_ptr<Handle>(std::move(object)), T::kTypeName);
}

/**
 * The object behind a `$h` tag of `type`.
 * @throws ReleasedHandleError when it was released.
 * @throws RequestError (BAD_REQUEST) when `tag` is not a handle of `type` this process issued.
 */
std::shared_ptr<Handle> resolve_handle(const json::Value& tag, std::string_view type);

/** A class value decoded by its factory, kept for the readers of a call or of a snapshot. */
class Decoded {
 public:
  virtual ~Decoded() = default;
};

/** An immutable snapshot of a `$class` or `$hy` value: its wire and its decode. */
class Retained : public Handle {
 public:
  static constexpr const char* kTypeName = "$retained";

  /** `wire` is the full value, no `$ref` in it; `decoded` may be null. */
  Retained(json::Value wire, std::shared_ptr<const Decoded> decoded);

  /** The value as retained. */
  const json::Value& wire() const noexcept { return wire_; }
  /** The decode of the value, or null for a class that keeps none. */
  const std::shared_ptr<const Decoded>& decoded() const noexcept { return decoded_; }

 private:
  json::Value wire_;
  std::shared_ptr<const Decoded> decoded_;
};

/**
 * Register a snapshot, its key indices built here, and return `{"$class"|"$hy": T, "$ref": id}`.
 * @pre `wire` is a validated `$class` or `$hy` value holding no `$ref`.
 */
json::Value retain(json::Value wire, std::shared_ptr<const Decoded> decoded);

/** Whether `v` is a `$ref` value (validate() has checked its form). */
bool is_ref(const json::Value& v) noexcept;

/**
 * The snapshot a `$ref` value names.
 * @throws RequestError "unknown handle n" for an id never issued; ReleasedHandleError
 *         "T handle n has been released"; RequestError `expected a "T" instance` (or
 *         `hybrid`) when the snapshot is not a value of the tag's class.
 */
std::shared_ptr<const Retained> resolve_ref(const json::Value& ref);

/**
 * The snapshot's wire as a value that shares it (json::Value::share) and keeps the snapshot alive,
 * so a value naming one snapshot many times costs one snapshot, not one copy per name.
 */
json::Value share_wire(const std::shared_ptr<const Retained>& snapshot);

/** Replace every `$ref` value inside `v`, `v` itself included, by share_wire() of its snapshot. */
void expand_refs(json::Value& v);

/** Drop handle `id`; unknown and released ids are ignored. */
void release_handle(std::uint64_t id) noexcept;

/** Number of live handles. */
std::size_t live_handles() noexcept;

/**
 * Identity token of a getter result (`$id`): the same token while the object it describes is
 * unchanged, a new one after invalidate(). Tokens are unique across the process.
 */
class Identity {
 public:
  /** The current token, allocating one if needed. */
  std::uint64_t token();
  /** The next token() returns a fresh value. */
  void invalidate() noexcept { token_ = 0; }

 private:
  std::uint64_t token_ = 0;
};

/** `{"$id": identity.token(), ...data}`. */
json::Value with_identity(Identity& identity, const json::Object& data);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_HANDLES_H_
