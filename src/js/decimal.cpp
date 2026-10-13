#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1  // strtod_l on glibc and musl
#endif

#include "js/decimal.h"

#include <clocale>
#include <cstdio>
#include <cstdlib>
#include <string>

#if CANTUS_JS_HAVE_FROM_CHARS_DOUBLE || CANTUS_JS_HAVE_TO_CHARS_DOUBLE
#include <charconv>
#endif

#if defined(__APPLE__)
#include <xlocale.h>
#define CANTUS_JS_HAVE_STRTOD_L 1
#elif defined(__GLIBC__) || defined(__EMSCRIPTEN__) || defined(__linux__)
#include <locale.h>
#define CANTUS_JS_HAVE_STRTOD_L 1
#else
#define CANTUS_JS_HAVE_STRTOD_L 0
#endif

namespace cantus::js::detail {

namespace {

/** `strtod` in the "C" locale on a NUL-terminated copy. */
double strtod_c(std::string_view literal) {
  std::string buf(literal);
#if CANTUS_JS_HAVE_STRTOD_L
  static const locale_t c_locale = newlocale(LC_ALL_MASK, "C", static_cast<locale_t>(nullptr));
  return strtod_l(buf.c_str(), nullptr, c_locale);
#else
  // Without strtod_l, spell the radix point the way the current locale expects it.
  const char* point = std::localeconv()->decimal_point;
  std::string::size_type dot = buf.find('.');
  if (dot != std::string::npos && point != nullptr && std::string_view(point) != ".") {
    buf.replace(dot, 1, point);
  }
  return std::strtod(buf.c_str(), nullptr);
#endif
}

/** Split a "d.ddde±x" scientific rendering into digits (trailing zeros dropped) and n. */
std::string split_scientific(const char* begin, const char* end, int& exponent) {
  std::string digits;
  const char* p = begin;
  for (; p != end && *p != 'e' && *p != 'E'; ++p) {
    if (*p >= '0' && *p <= '9') {
      digits.push_back(*p);
    }
  }
  int e = 0;
  if (p != end) {
    e = std::atoi(std::string(p + 1, end).c_str());
  }
  while (digits.size() > 1 && digits.back() == '0') {
    digits.pop_back();
  }
  exponent = e + 1;
  return digits;
}

}  // namespace

double parse_decimal(std::string_view literal) {
#if CANTUS_JS_HAVE_FROM_CHARS_DOUBLE
  double value = 0;
  const char* end = literal.data() + literal.size();
  auto result = std::from_chars(literal.data(), end, value);
  if (result.ec == std::errc() && result.ptr == end) {
    return value;
  }
#endif
  // Range errors (and any other rejection) go through strtod, which rounds subnormals and
  // returns ±HUGE_VAL / ±0 the way JSON.parse expects.
  return strtod_c(literal);
}

std::string shortest_digits(double x, int& exponent) {
  char buf[64];
#if CANTUS_JS_HAVE_TO_CHARS_DOUBLE
  auto result = std::to_chars(buf, buf + sizeof(buf), x, std::chars_format::scientific);
  return split_scientific(buf, result.ptr, exponent);
#else
  // The first precision that round-trips is the shortest, and printf rounds it to nearest.
  for (int precision = 0; precision < 17; ++precision) {
    int n = std::snprintf(buf, sizeof(buf), "%.*e", precision, x);
    if (strtod_c(std::string_view(buf, static_cast<std::size_t>(n))) == x) {
      return split_scientific(buf, buf + n, exponent);
    }
  }
  int n = std::snprintf(buf, sizeof(buf), "%.16e", x);
  return split_scientific(buf, buf + n, exponent);
#endif
}

}  // namespace cantus::js::detail
