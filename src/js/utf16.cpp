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

bool is_space(char16_t c) noexcept {
  return (c >= 0x09 && c <= 0x0D) || c == 0x20 || c == 0xA0 || c == 0x1680 ||
         (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F ||
         c == 0x3000 || c == 0xFEFF;
}

std::string trim(std::string_view s) {
  std::u16string units = to_utf16(s);
  std::size_t begin = 0;
  std::size_t end = units.size();
  while (begin < end && is_space(units[begin])) {
    ++begin;
  }
  while (end > begin && is_space(units[end - 1])) {
    --end;
  }
  return from_utf16(std::u16string_view(units).substr(begin, end - begin));
}

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

namespace {

/**
 * How many bytes from `s[i]` begin a well-formed sequence: the whole sequence when it is complete,
 * else the maximal ill-formed subpart (at least one byte).
 */
std::size_t utf8_prefix(std::string_view s, std::size_t i, bool surrogates,
                        bool& complete) noexcept {
  auto byte = [&](std::size_t k) { return static_cast<unsigned char>(s[k]); };
  unsigned char b0 = byte(i);
  complete = false;
  if (b0 < 0x80) {
    complete = true;
    return 1;
  }
  std::size_t len = 0;
  unsigned char lo = 0x80;
  unsigned char hi = 0xBF;
  if (b0 >= 0xC2 && b0 <= 0xDF) {
    len = 2;
  } else if (b0 >= 0xE0 && b0 <= 0xEF) {
    len = 3;
    if (b0 == 0xE0) lo = 0xA0;
    if (b0 == 0xED && !surrogates) hi = 0x9F;
  } else if (b0 >= 0xF0 && b0 <= 0xF4) {
    len = 4;
    if (b0 == 0xF0) lo = 0x90;
    if (b0 == 0xF4) hi = 0x8F;
  } else {
    return 1;
  }
  std::size_t k = 1;
  for (; k < len && i + k < s.size(); ++k) {
    unsigned char b = byte(i + k);
    bool ok = k == 1 ? b >= lo && b <= hi : (b & 0xC0) == 0x80;
    if (!ok) return k;
  }
  complete = k == len;
  return k;
}

}  // namespace

std::size_t utf8_sequence_length(std::string_view s, std::size_t i, bool surrogates) noexcept {
  bool complete = false;
  std::size_t n = utf8_prefix(s, i, surrogates, complete);
  return complete ? n : 0;
}

bool is_valid_wtf8(std::string_view s) noexcept {
  for (std::size_t i = 0; i < s.size();) {
    std::size_t n = utf8_sequence_length(s, i, true);
    if (n == 0) return false;
    i += n;
  }
  return true;
}

std::string replace_ill_formed_utf8(std::string_view s) {
  std::string out;
  out.reserve(s.size());
  for (std::size_t i = 0; i < s.size();) {
    bool complete = false;
    std::size_t n = utf8_prefix(s, i, false, complete);
    if (complete) {
      out.append(s.substr(i, n));
    } else {
      out += "\xEF\xBF\xBD";
    }
    i += n;
  }
  return out;
}

}  // namespace cantus::js
