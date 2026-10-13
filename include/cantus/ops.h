/**
 * @file ops.h
 * @brief In-process access to the JSON op layer (target cantus::ops), for hosts that link it.
 *
 * Same ops, wire format and error JSON as cantus_call(), without callbacks: an op that takes
 * `$cb` arguments, or any `$cb` in `args_json`, is refused with CANTUS_BAD_REQUEST.
 */
#ifndef CANTUS_OPS_H_
#define CANTUS_OPS_H_

#include <string>
#include <string_view>

#include "cantus/cantus_c.h"

namespace cantus::ops {

/** Outcome of call(). */
struct Result {
  /** CANTUS_OK, or the error's status. */
  CantusStatus status;
  /** Wire JSON of the result, or `{"code","name","message","at"?}`. */
  std::string json;

  /** Whether the call succeeded. */
  bool ok() const noexcept { return status == CANTUS_OK; }
};

/**
 * Run op `op` with the wire JSON array `args_json` (empty means `[]`). Never throws.
 */
Result call(std::string_view op, std::string_view args_json) noexcept;

}  // namespace cantus::ops

#endif  // CANTUS_OPS_H_
