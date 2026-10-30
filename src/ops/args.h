/**
 * @file args.h
 * @brief Positional arguments of one op call, in wire form.
 *
 * An argument that came as a `$ref` reads as its snapshot's wire, held for the call. Each argument
 * may keep the decode of the class value it holds, so a reader decodes it at most once a call.
 */
#ifndef CANTUS_SRC_OPS_ARGS_H_
#define CANTUS_SRC_OPS_ARGS_H_

#include <cstddef>
#include <memory>
#include <string_view>
#include <vector>

#include "json/json.h"
#include "ops/callbacks.h"
#include "ops/handles.h"

namespace cantus::ops {

/** The arguments array of a call, plus the call's callback context. */
class Args {
 public:
  Args(json::Array& values, const CallContext& context) : values_(&values), context_(&context) {}

  /** Number of arguments the host passed. */
  std::size_t size() const noexcept { return values_->size(); }

  /** Argument `i` (a held snapshot's wire); the `$u` tag when the host passed fewer arguments. */
  const json::Value& operator[](std::size_t i) const noexcept;

  /** Whether argument `i` is absent or `$u`. */
  bool undefined(std::size_t i) const noexcept;

  /**
   * Move argument `i` out (leaving null), avoiding a deep copy; `$u` when absent, a copy of the
   * wire for a held snapshot.
   */
  json::Value take(std::size_t i);

  /** All arguments as the host sent them, `$ref` values unresolved. */
  const json::Array& values() const noexcept { return *values_; }

  /** Read argument `i` as `snapshot` for the rest of the call. */
  void hold(std::size_t i, std::shared_ptr<const Retained> snapshot);

  /** The snapshot argument `i` came by, or nullptr. */
  const Retained* retained(std::size_t i) const noexcept;

  /** The decode kept for argument `i` (this call's or its snapshot's), or nullptr. */
  const Decoded* decoded(std::size_t i) const noexcept;

  /** Keep `decoded` as the decode of argument `i` for the rest of the call. */
  void keep(std::size_t i, std::shared_ptr<const Decoded> decoded) const;

  /** The call's callback context. */
  const CallContext& context() const noexcept { return *context_; }

  /** Argument `i` as a callback. @throws RequestError (BAD_REQUEST) when it is not `$cb`. */
  Callback callback(std::size_t i) const { return callback(operator[](i)); }

  /** A `$cb` value found anywhere in the arguments (an option field, say). */
  Callback callback(const json::Value& v) const;

  /**
   * The object behind handle argument `i` (`self` of a `Type#method` op). T derives from Handle
   * and names its type with `static constexpr const char* kTypeName`.
   * @throws ReleasedHandleError or RequestError; see resolve_handle().
   */
  template <class T>
  std::shared_ptr<T> handle(std::size_t i) const {
    return std::static_pointer_cast<T>(resolve_handle(operator[](i), T::kTypeName));
  }

  /**
   * The payload of hybrid argument `i` (`{"$hy": type, ...payload}`), including the `$hy` key.
   * @throws RequestError (BAD_REQUEST) when it is not a hybrid of `type`.
   */
  const json::Object& hybrid(std::size_t i, std::string_view type) const;

 private:
  struct Slot {
    std::shared_ptr<const Retained> snapshot;
    std::shared_ptr<const Decoded> decoded;
  };

  Slot& slot(std::size_t i) const;

  json::Array* values_;
  const CallContext* context_;
  /** Per argument, filled on demand; a reader caches its decode here. */
  mutable std::vector<Slot> slots_;
};

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_ARGS_H_
