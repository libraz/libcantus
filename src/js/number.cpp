#include "js/number.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <vector>

#include "js/decimal.h"
#include "js/math.h"
#include "js/utf16.h"

namespace cantus::js {

namespace {

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
constexpr double kInfinity = std::numeric_limits<double>::infinity();

/** ES StrWhiteSpaceChar: WhiteSpace or LineTerminator. */
bool is_js_space(std::uint32_t cp) { return cp <= 0xFFFF && is_space(static_cast<char16_t>(cp)); }

/** Offset of the first non-space code point at or after `i`. */
std::size_t skip_space(std::string_view s, std::size_t i) {
  while (i < s.size()) {
    std::size_t j = i;
    if (!is_js_space(detail::decode_wtf8(s, j))) {
      break;
    }
    i = j;
  }
  return i;
}

/** Value of `c` as a digit, or 36 when it is none. */
int digit_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'z') return c - 'a' + 10;
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  return 36;
}

/** Length of the run of radix digits at the start of `s`. */
std::size_t digit_run(std::string_view s, int radix) {
  std::size_t n = 0;
  while (n < s.size() && digit_value(s[n]) < radix) {
    ++n;
  }
  return n;
}

/**
 * Correctly rounded value of a run of digits in radix 2^radix_log_2 (V8
 * InternalStringToIntDouble): half-way cases round to even unless a later digit is nonzero.
 */
double power_of_two_digits(std::string_view digits, int radix_log_2) {
  std::size_t i = 0;
  while (i < digits.size() && digits[i] == '0') {
    ++i;
  }
  const std::int64_t radix = std::int64_t{1} << radix_log_2;
  std::int64_t number = 0;
  int exponent = 0;
  for (; i < digits.size(); ++i) {
    number = number * radix + digit_value(digits[i]);
    int overflow = static_cast<int>(number >> 53);
    if (overflow == 0) {
      continue;
    }
    int overflow_bits_count = 1;
    while (overflow > 1) {
      overflow_bits_count++;
      overflow >>= 1;
    }
    int dropped_bits_mask = (1 << overflow_bits_count) - 1;
    int dropped_bits = static_cast<int>(number) & dropped_bits_mask;
    number >>= overflow_bits_count;
    exponent = overflow_bits_count;
    bool zero_tail = true;
    for (++i; i < digits.size(); ++i) {
      zero_tail = zero_tail && digits[i] == '0';
      exponent += radix_log_2;
    }
    int middle_value = 1 << (overflow_bits_count - 1);
    if (dropped_bits > middle_value ||
        (dropped_bits == middle_value && ((number & 1) != 0 || !zero_tail))) {
      number++;
    }
    if ((number & (std::int64_t{1} << 53)) != 0) {
      exponent++;
      number >>= 1;
    }
    break;
  }
  return std::ldexp(static_cast<double>(number), exponent);
}

/** log2 of a power-of-two radix, or 0. */
int radix_log_2(int radix) {
  switch (radix) {
    case 2:
      return 1;
    case 4:
      return 2;
    case 8:
      return 3;
    case 16:
      return 4;
    case 32:
      return 5;
    default:
      return 0;
  }
}

/** Unsigned big integer, little-endian base 2^32, just enough for toFixed. */
class BigUint {
 public:
  explicit BigUint(std::uint64_t v) {
    while (v != 0) {
      limbs_.push_back(static_cast<std::uint32_t>(v));
      v >>= 32;
    }
  }

  void mul_small(std::uint32_t m) {
    std::uint64_t carry = 0;
    for (auto& limb : limbs_) {
      std::uint64_t t = std::uint64_t{limb} * m + carry;
      limb = static_cast<std::uint32_t>(t);
      carry = t >> 32;
    }
    if (carry != 0) {
      limbs_.push_back(static_cast<std::uint32_t>(carry));
    }
  }

  void add_one() {
    for (auto& limb : limbs_) {
      if (++limb != 0) {
        return;
      }
    }
    limbs_.push_back(1);
  }

  void shift_left(unsigned bits) {
    unsigned words = bits / 32;
    unsigned rest = bits % 32;
    if (rest != 0) {
      std::uint32_t carry = 0;
      for (auto& limb : limbs_) {
        std::uint32_t next = limb >> (32 - rest);
        limb = (limb << rest) | carry;
        carry = next;
      }
      if (carry != 0) {
        limbs_.push_back(carry);
      }
    }
    limbs_.insert(limbs_.begin(), words, 0);
  }

  void shift_right(unsigned bits) {
    unsigned words = bits / 32;
    unsigned rest = bits % 32;
    if (words >= limbs_.size()) {
      limbs_.clear();
      return;
    }
    limbs_.erase(limbs_.begin(), limbs_.begin() + words);
    if (rest != 0) {
      for (std::size_t k = 0; k < limbs_.size(); ++k) {
        std::uint32_t hi = k + 1 < limbs_.size() ? limbs_[k + 1] : 0;
        limbs_[k] = (limbs_[k] >> rest) | (hi << (32 - rest));
      }
    }
    trim();
  }

  bool bit(unsigned index) const {
    unsigned word = index / 32;
    return word < limbs_.size() && ((limbs_[word] >> (index % 32)) & 1) != 0;
  }

  std::string to_decimal() const {
    if (limbs_.empty()) {
      return "0";
    }
    std::vector<std::uint32_t> n = limbs_;
    std::string out;
    while (!n.empty()) {
      std::uint64_t rem = 0;
      for (std::size_t k = n.size(); k-- > 0;) {
        std::uint64_t cur = (rem << 32) | n[k];
        n[k] = static_cast<std::uint32_t>(cur / 1000000000u);
        rem = cur % 1000000000u;
      }
      while (!n.empty() && n.back() == 0) {
        n.pop_back();
      }
      for (int d = 0; d < 9; ++d) {
        out.push_back(static_cast<char>('0' + rem % 10));
        rem /= 10;
        if (n.empty() && rem == 0) {
          break;
        }
      }
    }
    while (out.size() > 1 && out.back() == '0') {
      out.pop_back();
    }
    return std::string(out.rbegin(), out.rend());
  }

 private:
  void trim() {
    while (!limbs_.empty() && limbs_.back() == 0) {
      limbs_.pop_back();
    }
  }

  std::vector<std::uint32_t> limbs_;
};

}  // namespace

std::string to_string(double x) {
  if (std::isnan(x)) {
    return "NaN";
  }
  if (x == 0) {
    return "0";
  }
  if (x < 0) {
    return "-" + to_string(-x);
  }
  if (std::isinf(x)) {
    return "Infinity";
  }
  int n = 0;
  std::string s = detail::shortest_digits(x, n);
  int k = static_cast<int>(s.size());
  if (k <= n && n <= 21) {
    return s + std::string(static_cast<std::size_t>(n - k), '0');
  }
  if (0 < n && n <= 21) {
    return s.substr(0, static_cast<std::size_t>(n)) + "." + s.substr(static_cast<std::size_t>(n));
  }
  if (-6 < n && n <= 0) {
    return "0." + std::string(static_cast<std::size_t>(-n), '0') + s;
  }
  int e = n - 1;
  std::string exp = std::string(e < 0 ? "e-" : "e+") + std::to_string(e < 0 ? -e : e);
  if (k == 1) {
    return s + exp;
  }
  return s.substr(0, 1) + "." + s.substr(1) + exp;
}

std::string to_fixed(double x, int digits) {
  if (digits < 0 || digits > 100) {
    throw std::range_error("toFixed() digits argument must be between 0 and 100");
  }
  if (std::isnan(x)) {
    return "NaN";
  }
  if (std::fabs(x) >= 1e21) {
    return to_string(x);
  }
  std::string sign;
  if (x < 0) {
    sign = "-";
    x = -x;
  }
  std::string m = "0";
  if (x != 0) {
    // x = mantissa * 2^e2 exactly; n = round-half-up(x * 10^digits).
    int e2 = 0;
    double frac = std::frexp(x, &e2);
    auto mantissa = static_cast<std::uint64_t>(std::ldexp(frac, 53));
    e2 -= 53;
    BigUint n(mantissa);
    for (int i = 0; i < digits; ++i) {
      n.mul_small(10);
    }
    if (e2 >= 0) {
      n.shift_left(static_cast<unsigned>(e2));
    } else {
      auto shift = static_cast<unsigned>(-e2);
      bool round_up = n.bit(shift - 1);
      n.shift_right(shift);
      if (round_up) {
        n.add_one();
      }
    }
    m = n.to_decimal();
  }
  if (digits != 0) {
    auto f = static_cast<std::size_t>(digits);
    if (m.size() <= f) {
      m = std::string(f + 1 - m.size(), '0') + m;
    }
    std::size_t point = m.size() - f;
    m = m.substr(0, point) + "." + m.substr(point);
  }
  return sign + m;
}

double number(std::string_view s) {
  std::size_t b = skip_space(s, 0);
  std::size_t e = s.size();
  while (e > b) {
    std::size_t k = e - 1;
    while (k > b && (static_cast<unsigned char>(s[k]) & 0xC0) == 0x80) {
      --k;
    }
    std::size_t j = k;
    if (!is_js_space(detail::decode_wtf8(s, j))) {
      break;
    }
    e = k;
  }
  std::string_view t = s.substr(b, e - b);
  if (t.empty()) {
    return 0;
  }
  if (t == "Infinity" || t == "+Infinity") {
    return kInfinity;
  }
  if (t == "-Infinity") {
    return -kInfinity;
  }
  if (t.size() > 2 && t[0] == '0') {
    int radix = 0;
    switch (t[1]) {
      case 'x':
      case 'X':
        radix = 16;
        break;
      case 'o':
      case 'O':
        radix = 8;
        break;
      case 'b':
      case 'B':
        radix = 2;
        break;
      default:
        break;
    }
    if (radix != 0) {
      std::string_view digits = t.substr(2);
      return digit_run(digits, radix) == digits.size()
                 ? power_of_two_digits(digits, radix_log_2(radix))
                 : kNaN;
    }
  }
  std::size_t i = 0;
  if (t[i] == '+' || t[i] == '-') {
    ++i;
  }
  std::size_t int_digits = digit_run(t.substr(i), 10);
  i += int_digits;
  std::size_t frac_digits = 0;
  if (i < t.size() && t[i] == '.') {
    ++i;
    frac_digits = digit_run(t.substr(i), 10);
    i += frac_digits;
  }
  if (int_digits + frac_digits == 0) {
    return kNaN;
  }
  if (i < t.size() && (t[i] == 'e' || t[i] == 'E')) {
    ++i;
    if (i < t.size() && (t[i] == '+' || t[i] == '-')) {
      ++i;
    }
    std::size_t exp_digits = digit_run(t.substr(i), 10);
    if (exp_digits == 0) {
      return kNaN;
    }
    i += exp_digits;
  }
  if (i != t.size()) {
    return kNaN;
  }
  return detail::parse_decimal(t[0] == '+' ? t.substr(1) : t);
}

double parse_int(std::string_view s, double radix_arg) {
  std::size_t i = skip_space(s, 0);
  if (i == s.size()) {
    return kNaN;
  }
  bool negative = false;
  if (s[i] == '+' || s[i] == '-') {
    negative = s[i] == '-';
    ++i;
    if (i == s.size()) {
      return kNaN;
    }
  }
  const double signed_zero = negative ? -0.0 : 0.0;
  std::int32_t radix = to_int32(radix_arg);
  bool strip_prefix = true;
  if (radix != 0) {
    if (radix < 2 || radix > 36) {
      return kNaN;
    }
    strip_prefix = radix == 16;
  } else {
    radix = 10;
  }
  bool leading_zero = false;
  if (strip_prefix && s[i] == '0') {
    ++i;
    if (i == s.size()) {
      return signed_zero;
    }
    if (s[i] == 'x' || s[i] == 'X') {
      radix = 16;
      ++i;
      if (i == s.size()) {
        return kNaN;
      }
    } else {
      leading_zero = true;
    }
  }
  while (s[i] == '0') {
    leading_zero = true;
    ++i;
    if (i == s.size()) {
      return signed_zero;
    }
  }
  if (!leading_zero && digit_value(s[i]) >= radix) {
    return kNaN;
  }
  std::string_view rest = s.substr(i);
  std::string_view digits = rest.substr(0, digit_run(rest, radix));
  double result = 0;
  if (radix == 10) {
    // V8 keeps at most 310 significant digits; anything longer is Infinity regardless.
    constexpr std::size_t kMaxDigits = 310;
    result = digits.empty() ? 0 : detail::parse_decimal(digits.substr(0, kMaxDigits));
  } else if (int log2_radix = radix_log_2(radix); log2_radix != 0) {
    result = power_of_two_digits(digits, log2_radix);
  } else {
    // V8 HandleGenericCase: 32-bit multiply-and-add chunks, rounding in double between them.
    const auto r = static_cast<std::uint32_t>(radix);
    std::size_t k = 0;
    bool done = false;
    do {
      std::uint32_t part = 0;
      std::uint32_t multiplier = 1;
      while (true) {
        if (k == digits.size()) {
          done = true;
          break;
        }
        constexpr std::uint32_t kMaximumMultiplier = 0xFFFFFFFFu / 36;
        std::uint32_t m = multiplier * r;
        if (m > kMaximumMultiplier) {
          break;
        }
        part = part * r + static_cast<std::uint32_t>(digit_value(digits[k]));
        multiplier = m;
        ++k;
        if (k == digits.size()) {
          done = true;
          break;
        }
      }
      result = result * multiplier + part;
    } while (!done);
  }
  return negative ? -result : result;
}

}  // namespace cantus::js
