#include "cantus/core/errors.h"

namespace cantus {

Error::Error(ErrorCode code, const std::string& message)
    : std::runtime_error(message), code_(code) {}

InvalidInputError::InvalidInputError(const std::string& message)
    : Error(ErrorCode::kInvalidInput, message) {}

NoSolutionError::NoSolutionError(const std::string& message, std::optional<std::size_t> at)
    : Error(ErrorCode::kNoSolution, message), at_(at) {}

BudgetExceededError::BudgetExceededError(const std::string& message)
    : Error(ErrorCode::kBudgetExceeded, message) {}

bool is_libcantus_error(const Error& error) noexcept {
  ErrorCode code = error.code();
  return code == ErrorCode::kInvalidInput || code == ErrorCode::kNoSolution ||
         code == ErrorCode::kBudgetExceeded;
}

}  // namespace cantus
