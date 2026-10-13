/**
 * @file error_map.h
 * @brief Errors raised only at the op boundary, and the one mapping from error code to status.
 */
#ifndef CANTUS_SRC_OPS_ERROR_MAP_H_
#define CANTUS_SRC_OPS_ERROR_MAP_H_

#include <optional>
#include <string>
#include <string_view>

#include "cantus/cantus_c.h"
#include "cantus/core/errors.h"

namespace cantus::ops {

/** The TypeError JS raises for a value it cannot convert (a Symbol in a template, say). */
class HostTypeError : public Error {
 public:
  explicit HostTypeError(const std::string& message) : Error(ErrorCode::kHostTypeError, message) {}
};

/** A request the boundary cannot run: an unknown op (kUnknownOp) or a malformed one. */
class RequestError : public Error {
 public:
  explicit RequestError(const std::string& message) : Error(ErrorCode::kBadRequest, message) {}
  RequestError(ErrorCode code, const std::string& message) : Error(code, message) {}
};

/** A host callback reported failure; the host keeps the original exception. */
class HostCallbackError : public Error {
 public:
  explicit HostCallbackError(const std::string& message)
      : Error(ErrorCode::kCallbackFailed, message) {}
};

/** A handle was used after cantus_release(). */
class ReleasedHandleError : public Error {
 public:
  explicit ReleasedHandleError(const std::string& message)
      : Error(ErrorCode::kReleasedHandle, message) {}
};

/** How an error code appears on the wire. */
struct ErrorInfo {
  /** C ABI status. */
  CantusStatus status;
  /** The `code` field, e.g. "INVALID_INPUT". */
  const char* code;
  /** The `name` field: the JS class the facade raises, e.g. "InvalidInputError". */
  const char* name;
};

/** The wire form of `code`, or nullopt for a value outside ErrorCode. */
std::optional<ErrorInfo> error_info(ErrorCode code) noexcept;

/** The ErrorCode whose `code` field is `name`, or nullopt. */
std::optional<ErrorCode> parse_error_code(std::string_view name) noexcept;

/** A failed call as the C ABI returns it. */
struct ErrorReply {
  CantusStatus status;
  /** `{"code","name","message","at"?}`. */
  std::string json;
};

/** Map the exception being handled to its reply. Call only from inside a catch block. */
ErrorReply map_current_exception() noexcept;

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_ERROR_MAP_H_
