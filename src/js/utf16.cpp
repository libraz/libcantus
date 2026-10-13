#include "js/utf16.h"

#include <cmath>

namespace cantus::js {

namespace {

/** ES ToIntegerOrInfinity followed by the relative-index clamp `slice` applies. */
std::size_t relative_index(double v, std::size_t length) {
  double len = static_cast<double>(length);
  double n = std::isnan(v) ? 0 : std::trunc(v);
  if (n < 0) {
    n = std::fmax(len + n, 0.0);
  } else {
    n = std::fmin(n, len);
  }
  return static_cast<std::size_t>(n);
}

}  // namespace

void append_wtf8(std::string& out, std::uint32_t cp) {
  if (cp >= 0xDC00 && cp <= 0xDFFF && out.size() >= 3) {
    auto b0 = static_cast<unsigned char>(out[out.size() - 3]);
    auto b1 = static_cast<unsigned char>(out[out.size() - 2]);
    if (b0 == 0xED && b1 >= 0xA0 && b1 <= 0xAF) {
      std::uint32_t high =
          0xD000 | ((b1 & 0x3Fu) << 6) | (static_cast<unsigned char>(out[out.size() - 1]) & 0x3Fu);
      out.resize(out.size() - 3);
      cp = 0x10000 + ((high - 0xD800) << 10) + (cp - 0xDC00);
    }
  }
  if (cp < 0x80) {
    out.push_back(static_cast<char>(cp));
  } else if (cp < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  }
}

std::size_t utf16_length(std::string_view s) {
  std::size_t n = 0;
  for (char c : s) {
    auto b = static_cast<unsigned char>(c);
    if ((b & 0xC0) != 0x80) {
      n += b >= 0xF0 ? 2 : 1;
    }
  }
  return n;
}

std::u16string to_utf16(std::string_view s) {
  std::u16string out;
  out.reserve(s.size());
  for_each_utf16_unit(s, [&](char16_t u) { out.push_back(u); });
  return out;
}

std::string from_utf16(std::u16string_view units) {
  std::string out;
  out.reserve(units.size());
  for (char16_t u : units) {
    append_wtf8(out, u);
  }
  return out;
}

std::string utf16_slice(std::string_view s, double start, std::optional<double> end) {
  std::size_t length = utf16_length(s);
  std::size_t from = relative_index(start, length);
  std::size_t to = end ? relative_index(*end, length) : length;
  std::string out;
  if (from >= to) {
    return out;
  }
  std::size_t index = 0;
  for_each_utf16_unit(s, [&](char16_t u) {
    if (index >= from && index < to) {
      append_wtf8(out, u);
    }
    ++index;
  });
  return out;
}

int utf16_compare(std::string_view a, std::string_view b) {
  std::u16string ua = to_utf16(a);
  std::u16string ub = to_utf16(b);
  int c = ua.compare(ub);
  return c < 0 ? -1 : (c > 0 ? 1 : 0);
}

}  // namespace cantus::js
