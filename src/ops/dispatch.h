/**
 * @file dispatch.h
 * @brief One op call from wire text to wire text: the body of cantus_call() and ops::call().
 */
#ifndef CANTUS_SRC_OPS_DISPATCH_H_
#define CANTUS_SRC_OPS_DISPATCH_H_

#include <string_view>

#include "cantus/ops.h"
#include "ops/callbacks.h"

namespace cantus::ops {

/**
 * Parse and validate `args_json`, run `op`, and serialize its result or error. Never throws.
 *
 * @param context Host callback function of this call; empty refuses `$cb` arguments and ops
 *        flagged kCallbacks.
 */
Result dispatch(std::string_view op, std::string_view args_json,
                const CallContext& context) noexcept;

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_DISPATCH_H_
