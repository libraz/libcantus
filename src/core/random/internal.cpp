// The path hash of ts/src/core/random/internal.ts: FNV-1a over a type-tagged byte encoding of
// the path, finished with the MurmurHash3 fmix32 step.

#include "core/random/internal.h"

#include <cmath>
#include <cstring>
#include <limits>
#include <string>
#include <variant>

#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/utf16.h"

namespace cantus {

namespace {

/** Absorb one byte into a running FNV-1a hash. */
std::uint32_t absorb(std::uint32_t hash, std::uint32_t byte) {
  return (hash ^ (byte & 0xffU)) * FNV_PRIME;
}

/** Absorb a 32-bit word, least significant byte first. */
std::uint32_t absorb_uint32(std::uint32_t hash, std::uint32_t value) {
  std::uint32_t next = hash;
  for (std::uint32_t shift = 0; shift < 32; shift += 8) {
    next = absorb(next, (value >> shift) & 0xffU);
  }
  return next;
}

/** MurmurHash3 32-bit finalizer. */
std::uint32_t fmix32(std::uint32_t value) {
  std::uint32_t mixed = value;
  mixed ^= mixed >> 16;
  mixed *= 0x85ebca6bU;
  mixed ^= mixed >> 13;
  mixed *= 0xc2b2ae35U;
  mixed ^= mixed >> 16;
  return mixed;
}

/** Absorb one path segment, tagged and length-prefixed. */
std::uint32_t absorb_segment(std::uint32_t hash, const SeedSegment& segment, std::size_t index) {
  if (const auto* text = std::get_if<std::string>(&segment)) {
    std::uint32_t next = absorb(hash, SEED_TAG_STRING);
    next = absorb_uint32(next, static_cast<std::uint32_t>(js::utf16_length(*text)));
    js::for_each_utf16_unit(*text, [&](char16_t unit) {
      next = absorb(next, unit & 0xffU);
      next = absorb(next, (unit >> 8) & 0xffU);
    });
    return next;
  }
  double value = std::get<double>(segment);
  assert_finite_number(value, "seed path segment " + index_text(index));
  // Negative zero carries different bytes from zero while comparing equal.
  double normalized = value == 0 ? 0 : value;
  std::uint64_t bits = 0;
  std::memcpy(&bits, &normalized, sizeof bits);
  std::uint32_t next = absorb(hash, SEED_TAG_NUMBER);
  for (unsigned i = 0; i < 8; ++i) {
    next = absorb(next, static_cast<std::uint32_t>((bits >> (8 * i)) & 0xffU));
  }
  return next;
}

}  // namespace

std::uint32_t hash_path(std::uint32_t domain, std::uint32_t root, const SeedPath& path) {
  std::uint32_t hash = absorb(FNV_OFFSET_BASIS, domain);
  hash = absorb_uint32(hash, root);
  for (std::size_t index = 0; index < path.size(); ++index) {
    hash = absorb_segment(hash, path[index], index);
  }
  return fmix32(hash);
}

double scale_unit_draw(double unit, double lo, double hi) {
  double value = lo + unit * (hi - lo);
  if (value < hi || lo == hi) {
    return value;
  }
  return std::nextafter(hi, -std::numeric_limits<double>::infinity());
}

}  // namespace cantus
