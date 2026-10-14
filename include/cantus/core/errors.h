/**
 * @file errors.h
 * @brief The library's error taxonomy (ts/src/core/errors).
 *
 * The typed API raises only InvalidInputError, NoSolutionError and BudgetExceededError. The other
 * codes belong to the op boundary and share the enum so that one table numbers every failure; the
 * values equal the CantusStatus of the C ABI.
 */
#ifndef CANTUS_CORE_ERRORS_H_
#define CANTUS_CORE_ERRORS_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <variant>

namespace cantus {

/** What kind of failure an error reports. */
enum class ErrorCode : std::int32_t {
  kInvalidInput = 1,
  kNoSolution = 2,
  kBudgetExceeded = 3,
  kHostTypeError = 4,
  kUnknownOp = 10,
  kBadRequest = 11,
  kCallbackFailed = 12,
  kReleasedHandle = 13,
  kInternal = 99,
};

/** Base of every coded error. */
class Error : public std::runtime_error {
 public:
  Error(ErrorCode code, const std::string& message);

  /** The failure kind. */
  ErrorCode code() const noexcept { return code_; }

 private:
  ErrorCode code_;
};

/** A rejected argument: malformed, out of range, or naming something unknown. */
class InvalidInputError : public Error {
 public:
  explicit InvalidInputError(const std::string& message);
};

/** A valid request with no answer. */
class NoSolutionError : public Error {
 public:
  /**
   * @param message What could not be satisfied.
   * @param at Where in a sequence the failure occurred (a chord index or a beat, say), when known.
   */
  explicit NoSolutionError(const std::string& message, std::optional<double> at = std::nullopt);

  /** Where in a sequence the failure occurred, when the operation was working through one. */
  std::optional<double> at() const noexcept { return at_; }

 private:
  std::optional<double> at_;
};

/** Work that would exceed the synchronous generation budget. */
class BudgetExceededError : public Error {
 public:
  explicit BudgetExceededError(const std::string& message);
};

/** Whether `error` is one of the three errors the typed API raises (`isLibcantusError`). */
bool is_libcantus_error(const Error& error) noexcept;

/**
 * The outcome of a parse that reports failure instead of throwing it (`ParseResult<T>`).
 *
 * @tparam T The value a successful parse produces.
 */
template <class T>
class ParseResult {
 public:
  /** A successful parse. */
  static ParseResult success(T value) { return ParseResult(std::move(value)); }
  /** A failed parse. */
  static ParseResult failure(InvalidInputError e) { return ParseResult(std::move(e)); }
  static ParseResult failure(NoSolutionError e) { return ParseResult(std::move(e)); }
  static ParseResult failure(BudgetExceededError e) { return ParseResult(std::move(e)); }

  /** Whether the parse succeeded. */
  bool ok() const noexcept { return state_.index() == 0; }

  /** The parsed value. @throws std::bad_variant_access when the parse failed. */
  const T& value() const& { return std::get<0>(state_); }
  T&& value() && { return std::get<0>(std::move(state_)); }

  /** The error of a failed parse. @throws std::bad_variant_access when it succeeded. */
  const Error& error() const {
    return std::visit(
        [](const auto& v) -> const Error& {
          if constexpr (std::is_base_of_v<Error, std::decay_t<decltype(v)>>) {
            return v;
          } else {
            throw std::bad_variant_access();
          }
        },
        state_);
  }

  /** The value, or the stored error rethrown as its own class (`unwrapParse`). */
  T unwrap() && {
    switch (state_.index()) {
      case 1:
        throw std::get<1>(state_);
      case 2:
        throw std::get<2>(state_);
      case 3:
        throw std::get<3>(state_);
      default:
        return std::get<0>(std::move(state_));
    }
  }

 private:
  template <class V>
  explicit ParseResult(V&& v) : state_(std::forward<V>(v)) {}

  std::variant<T, InvalidInputError, NoSolutionError, BudgetExceededError> state_;
};

}  // namespace cantus

#endif  // CANTUS_CORE_ERRORS_H_
