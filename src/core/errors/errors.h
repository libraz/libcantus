/**
 * @file errors.h
 * @brief Internal helpers of ts/src/core/errors shared by the non-throwing parsers.
 */
#ifndef CANTUS_SRC_CORE_ERRORS_ERRORS_H_
#define CANTUS_SRC_CORE_ERRORS_ERRORS_H_

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

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_ERRORS_ERRORS_H_
