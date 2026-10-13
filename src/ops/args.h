/**
 * @file args.h
 * @brief Positional arguments of one op call, in wire form.
 */
#ifndef CANTUS_SRC_OPS_ARGS_H_
#define CANTUS_SRC_OPS_ARGS_H_

#include <cstddef>
#include <memory>
#include <string_view>

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

  /** Argument `i`; the `$u` tag when the host passed fewer arguments. */
  const json::Value& operator[](std::size_t i) const noexcept;

  /** Whether argument `i` is absent or `$u`. */
  bool undefined(std::size_t i) const noexcept;

  /** Move argument `i` out (leaving null), avoiding a deep copy; `$u` when absent. */
  json::Value take(std::size_t i);

  /** All arguments. */
  const json::Array& values() const noexcept { return *values_; }

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
  json::Array* values_;
  const CallContext* context_;
};

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_ARGS_H_
