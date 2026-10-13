/**
 * @file handles.h
 * @brief The process-wide handle table behind `{"$h": id, "$type": T}`.
 *
 * The table is guarded by a mutex; a looked-up handle is held by shared_ptr, so releasing it
 * while a method runs only takes effect once the method returns. Ids are never reused.
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
