/**
 * @file sort.h
 * @brief `Array.prototype.sort` with a comparator, for the sorts TS runs before it has checked
 *        what it sorts.
 */
#ifndef CANTUS_JS_SORT_H_
#define CANTUS_JS_SORT_H_

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <utility>
#include <vector>

namespace cantus::js {

/**
 * Sort `items` as `items.sort(compare)` does, where `compare(a, b)` returns a number and NaN
 * reads as 0. A list below 64 items goes through V8's own run detection and binary insertion, so
 * a comparator that is no ordering (one that returns NaN for some pairs) leaves the list in the
 * order V8 leaves it in. A longer list is sorted stably, which is that order only for a
 * comparator that is an ordering.
 */
template <class T, class Compare>
void array_sort(std::vector<T>& items, Compare compare) {
  const std::size_t length = items.size();
  auto order = [&compare](const T& x, const T& y) {
    double v = compare(x, y);
    return std::isnan(v) ? 0.0 : v;
  };
  if (length < 2) {
    return;
  }
  if (length >= 64) {
    std::stable_sort(items.begin(), items.end(),
                     [&order](const T& x, const T& y) { return order(x, y) < 0; });
    return;
  }
  // The whole list is one run: its leading ascending or strictly descending stretch, then the rest
  // by binary insertion.
  std::size_t run = 2;
  bool descending = order(items[1], items[0]) < 0;
  for (std::size_t at = 2; at < length; ++at) {
    double v = order(items[at], items[at - 1]);
    if (descending ? v >= 0 : v < 0) {
      break;
    }
    ++run;
  }
  if (descending) {
    std::reverse(items.begin(), items.begin() + static_cast<std::ptrdiff_t>(run));
  }
  for (std::size_t start = run; start < length; ++start) {
    std::size_t left = 0;
    std::size_t right = start;
    T pivot = items[start];
    while (left < right) {
      std::size_t mid = left + ((right - left) >> 1);
      if (order(pivot, items[mid]) < 0) {
        right = mid;
      } else {
        left = mid + 1;
      }
    }
    for (std::size_t p = start; p > left; --p) {
      items[p] = std::move(items[p - 1]);
    }
    items[left] = std::move(pivot);
  }
}

}  // namespace cantus::js

#endif  // CANTUS_JS_SORT_H_
