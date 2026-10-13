#include "ops/error_map.h"

#include <cstdint>
#include <exception>
#include <new>

#include "js/format.h"
#include "json/json.h"
#include "ops/codec.h"

namespace cantus::ops {

std::optional<ErrorInfo> error_info(ErrorCode code) noexcept {
  // The single code table of the boundary; no default, so a new ErrorCode fails to compile here.
  switch (code) {
    case ErrorCode::kInvalidInput:
      return ErrorInfo{CANTUS_INVALID_INPUT, "INVALID_INPUT", "InvalidInputError"};
    case ErrorCode::kNoSolution:
      return ErrorInfo{CANTUS_NO_SOLUTION, "NO_SOLUTION", "NoSolutionError"};
    case ErrorCode::kBudgetExceeded:
      return ErrorInfo{CANTUS_BUDGET_EXCEEDED, "BUDGET_EXCEEDED", "BudgetExceededError"};
    case ErrorCode::kHostTypeError:
      return ErrorInfo{CANTUS_HOST_TYPE_ERROR, "HOST_TYPE_ERROR", "TypeError"};
    case ErrorCode::kUnknownOp:
      return ErrorInfo{CANTUS_UNKNOWN_OP, "UNKNOWN_OP", "Error"};
    case ErrorCode::kBadRequest:
      return ErrorInfo{CANTUS_BAD_REQUEST, "BAD_REQUEST", "Error"};
    case ErrorCode::kCallbackFailed:
      return ErrorInfo{CANTUS_CALLBACK_FAILED, "CALLBACK_FAILED", "Error"};
    case ErrorCode::kReleasedHandle:
      return ErrorInfo{CANTUS_RELEASED_HANDLE, "RELEASED_HANDLE", "Error"};
    case ErrorCode::kInternal:
      return ErrorInfo{CANTUS_INTERNAL, "INTERNAL", "Error"};
  }
  return std::nullopt;
}

std::optional<ErrorCode> parse_error_code(std::string_view name) noexcept {
  for (std::int32_t n = 1; n <= CANTUS_INTERNAL; ++n) {
    auto code = static_cast<ErrorCode>(n);
    std::optional<ErrorInfo> info = error_info(code);
    if (info && name == info->code) {
      return code;
    }
  }
  return std::nullopt;
}

namespace {

constexpr char kOutOfMemoryReply[] =
    R"({"code":"INTERNAL","name":"Error","message":"out of memory"})";

ErrorReply reply(ErrorCode code, const std::string& message, std::optional<std::size_t> at) {
  // Every ErrorCode value is in the table.
  ErrorInfo info = *error_info(code);
  json::Object o;
  o.set("code", info.code);
  o.set("name", info.name);
  o.set("message", message);
  if (at) {
    o.set("at", static_cast<double>(*at));
  }
  return ErrorReply{info.status, ops::stringify(json::Value(std::move(o)))};
}

}  // namespace

ErrorReply map_current_exception() noexcept {
  try {
    try {
      throw;
    } catch (const NoSolutionError& e) {
      return reply(e.code(), e.what(), e.at());
    } catch (const Error& e) {
      return reply(e.code(), e.what(), std::nullopt);
    } catch (const js::TypeError& e) {
      return reply(ErrorCode::kHostTypeError, e.what(), std::nullopt);
    } catch (const json::ParseError& e) {
      return reply(ErrorCode::kBadRequest, e.what(), std::nullopt);
    } catch (const std::bad_alloc&) {
      return ErrorReply{CANTUS_INTERNAL, kOutOfMemoryReply};
    } catch (const std::exception& e) {
      return reply(ErrorCode::kInternal, e.what(), std::nullopt);
    } catch (...) {
      return reply(ErrorCode::kInternal, "unknown exception", std::nullopt);
    }
  } catch (...) {
    // Building the reply itself failed; only allocation can do that.
    try {
      return ErrorReply{CANTUS_INTERNAL, kOutOfMemoryReply};
    } catch (...) {
      return ErrorReply{CANTUS_INTERNAL, std::string()};
    }
  }
}

}  // namespace cantus::ops
