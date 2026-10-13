/**
 * @file nullable.h
 * @brief `T | null` of the TS API, kept distinct from `x?: T` (std::optional).
 */
#ifndef CANTUS_CORE_NULLABLE_H_
#define CANTUS_CORE_NULLABLE_H_

#include <optional>
#include <type_traits>
#include <utility>

namespace cantus {

/**
 * A value that may be null. Behaves as std::optional, but is its own type so that an empty one
 * is written as JSON null where an empty std::optional is omitted.
 */
template <class T>
class Nullable : public std::optional<T> {
 public:
  using std::optional<T>::optional;

  /** Assign a value (or std::nullopt). */
  template <class U, std::enable_if_t<!std::is_same_v<std::decay_t<U>, Nullable> &&
                                          std::is_assignable_v<std::optional<T>&, U&&>,
                                      int> = 0>
  Nullable& operator=(U&& value) {
    std::optional<T>::operator=(std::forward<U>(value));
    return *this;
  }
};

}  // namespace cantus

#endif  // CANTUS_CORE_NULLABLE_H_
