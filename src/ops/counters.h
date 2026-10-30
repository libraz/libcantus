/**
 * @file counters.h
 * @brief Work counters for tests: class decodes and arrangement analyses run by the op layer.
 *
 * Relaxed atomics, process-wide, never reset; a test reads the difference across the calls it
 * makes. Nothing outside tests reads them.
 */
#ifndef CANTUS_SRC_OPS_COUNTERS_H_
#define CANTUS_SRC_OPS_COUNTERS_H_

#include <atomic>
#include <cstdint>

namespace cantus::ops::counters {

/** `Class.fromData` runs over a `$class` value. */
inline std::atomic<std::uint64_t> class_decodes{0};
/** Arrangement analyses made from nothing. */
inline std::atomic<std::uint64_t> full_analyses{0};
/** Arrangement analyses made from a previous session's evidence. */
inline std::atomic<std::uint64_t> incremental_analyses{0};

inline void bump(std::atomic<std::uint64_t>& counter) noexcept {
  counter.fetch_add(1, std::memory_order_relaxed);
}

}  // namespace cantus::ops::counters

#endif  // CANTUS_SRC_OPS_COUNTERS_H_
