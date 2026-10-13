/**
 * @file callbacks.h
 * @brief Host callbacks behind `{"$cb": id}` arguments.
 *
 * Each cantus_call carries its own CallContext, so a callback that re-enters cantus_call gets a
 * fresh context and the outer one is untouched: the frames form a stack on the native call stack.
 */
#ifndef CANTUS_SRC_OPS_CALLBACKS_H_
#define CANTUS_SRC_OPS_CALLBACKS_H_

#include <cstdint>

#include "cantus/cantus_c.h"
#include "json/json.h"

namespace cantus::ops {

/** The host function of one call; empty for calls made through ops::call(). */
class CallContext {
 public:
  CallContext() = default;
  CallContext(CantusCallbackFn fn, void* ctx) : fn_(fn), ctx_(ctx) {}

  /** Whether `$cb` arguments can be called. */
  bool has_callbacks() const noexcept { return fn_ != nullptr; }

  /**
   * Call callback `id` with wire arguments `args` and return its wire result.
   * @throws HostCallbackError when the host reports failure.
   * @throws RequestError (BAD_REQUEST) when the result is not valid wire JSON.
   */
  json::Value invoke(std::uint32_t id, const json::Array& args) const;

 private:
  CantusCallbackFn fn_ = nullptr;
  void* ctx_ = nullptr;
};

/** A `$cb` argument. Valid only while the op that received it runs. */
class Callback {
 public:
  Callback(const CallContext& context, std::uint32_t id) : context_(&context), id_(id) {}

  /** Call the host function with wire arguments; see CallContext::invoke. */
  json::Value operator()(const json::Array& args) const { return context_->invoke(id_, args); }

  /** The callback id. */
  std::uint32_t id() const noexcept { return id_; }

 private:
  const CallContext* context_;
  std::uint32_t id_;
};

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CALLBACKS_H_
