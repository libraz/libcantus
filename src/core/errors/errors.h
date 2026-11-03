/**
 * @file errors.h
 * @brief Internal helpers of ts/src/core/errors shared by the non-throwing parsers.
 */
#ifndef CANTUS_SRC_CORE_ERRORS_ERRORS_H_
#define CANTUS_SRC_CORE_ERRORS_ERRORS_H_

#include <stdexcept>
#include <utility>

#include "cantus/core/errors.h"

namespace cantus {

/**
 * Report the exception being handled as a failed parse, or rethrow what is not ours
 * (`parseFailure`). Call only from inside a catch block.
 */
template <class T>
ParseResult<T> parse_failure() {
  try {
    throw;
  } catch (const InvalidInputError& e) {
    return ParseResult<T>::failure(e);
  } catch (const NoSolutionError& e) {
    return ParseResult<T>::failure(e);
  } catch (const BudgetExceededError& e) {
    return ParseResult<T>::failure(e);
  }
}

/** A failed parse of another type, as the failure of this one (`parsed.ok ? ... : parsed`). */
template <class To, class From>
ParseResult<To> parse_failure_of(ParseResult<From>&& parsed) {
  try {
    std::move(parsed).unwrap();
  } catch (...) {
    return parse_failure<To>();
  }
  throw std::logic_error("parse_failure_of: the parse succeeded");
}

/**
 * A parse of another type with its value wrapped, or its failure
 * (`parsed.ok ? { ok: true, value: wrap(parsed.value) } : parsed`).
 */
template <class To, class From, class Wrap>
ParseResult<To> map_parse(ParseResult<From>&& parsed, Wrap wrap) {
  if (!parsed.ok()) {
    return parse_failure_of<To>(std::move(parsed));
  }
  return ParseResult<To>::success(wrap(parsed.value()));
}

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_ERRORS_ERRORS_H_
