/**
 * @file utf16.h
 * @brief JS string semantics (UTF-16 code units) over WTF-8 storage.
 *
 * Every string the library holds is WTF-8: UTF-8 where a lone surrogate is encoded as its own
 * three-byte sequence and a surrogate pair is always one four-byte code point. Lengths, offsets
 * and ordering are counted in UTF-16 code units, as `String.prototype.length`, `slice` and `<`.
 */
#ifndef CANTUS_JS_UTF16_H_
#define CANTUS_JS_UTF16_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace cantus::js {

namespace detail {

/** Decode the code point (or lone surrogate) starting at `s[i]` and advance `i` past it. */
inline std::uint32_t decode_wtf8(std::string_view s, std::size_t& i) {
  auto byte = [&](std::size_t k) {
    return static_cast<std::uint32_t>(static_cast<unsigned char>(s[k]));
  };
  std::uint32_t b0 = byte(i);
  if (b0 < 0x80) {
    i += 1;
    return b0;
  }
  if (b0 < 0xE0) {
    std::uint32_t cp = ((b0 & 0x1F) << 6) | (byte(i + 1) & 0x3F);
    i += 2;
    return cp;
  }
  if (b0 < 0xF0) {
    std::uint32_t cp = ((b0 & 0x0F) << 12) | ((byte(i + 1) & 0x3F) << 6) | (byte(i + 2) & 0x3F);
    i += 3;
    return cp;
  }
  std::uint32_t cp = ((b0 & 0x07) << 18) | ((byte(i + 1) & 0x3F) << 12) |
                     ((byte(i + 2) & 0x3F) << 6) | (byte(i + 3) & 0x3F);
  i += 4;
  return cp;
}

}  // namespace detail

/** Call `f(char16_t)` for each UTF-16 code unit of the WTF-8 string `s`. */
template <class F>
void for_each_utf16_unit(std::string_view s, F&& f) {
  std::size_t i = 0;
  while (i < s.size()) {
    std::uint32_t cp = detail::decode_wtf8(s, i);
    if (cp >= 0x10000) {
      cp -= 0x10000;
      f(static_cast<char16_t>(0xD800 + (cp >> 10)));
      f(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
    } else {
      f(static_cast<char16_t>(cp));
    }
  }
}

/** `s.length`. */
std::size_t utf16_length(std::string_view s);

/** The UTF-16 code units of `s`. */
std::u16string to_utf16(std::string_view s);

/** WTF-8 encoding of UTF-16 code units; pairs collapse, lone surrogates stay. */
std::string from_utf16(std::u16string_view units);

/** `s.slice(start, end)`, offsets in code units; may split a pair into lone surrogates. */
std::string utf16_slice(std::string_view s, double start, std::optional<double> end = std::nullopt);

/** Sign of `a < b` / `a > b` as JS compares strings: by UTF-16 code unit. */
int utf16_compare(std::string_view a, std::string_view b);

/** Whether a code unit is white space to `String.prototype.trim` and the regex class `\s`. */
bool is_space(char16_t unit) noexcept;

/** `s.trim()`. */
std::string trim(std::string_view s);

/** Append the WTF-8 encoding of a code point or lone surrogate, merging a completed pair. */
void append_wtf8(std::string& out, std::uint32_t cp);

}  // namespace cantus::js

#endif  // CANTUS_JS_UTF16_H_
