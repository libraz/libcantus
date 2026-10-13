#include <cstdint>
#include <string>

#include "js/decimal.h"
#include "js/utf16.h"
#include "json/json.h"

namespace cantus::json {

namespace {

class Parser {
 public:
  explicit Parser(std::string_view text) : text_(text) {}

  Value parse_document() {
    skip_space();
    Value v = parse_value(0);
    skip_space();
    if (pos_ != text_.size()) {
      fail("unexpected trailing content");
    }
    return v;
  }

 private:
  [[noreturn]] void fail(const std::string& what) const {
    throw ParseError("JSON parse error: " + what + " at offset " + std::to_string(pos_), pos_);
  }

  bool at_end() const { return pos_ >= text_.size(); }
  char peek() const { return text_[pos_]; }

  void skip_space() {
    while (!at_end() && (peek() == ' ' || peek() == '\t' || peek() == '\n' || peek() == '\r')) {
      ++pos_;
    }
  }

  void expect_literal(std::string_view word) {
    if (text_.substr(pos_, word.size()) != word) {
      fail("unexpected token");
    }
    pos_ += word.size();
  }

  Value parse_value(std::size_t depth) {
    if (at_end()) {
      fail("unexpected end of input");
    }
    switch (peek()) {
      case '{':
        return parse_object(depth + 1);
      case '[':
        return parse_array(depth + 1);
      case '"':
        return Value(parse_string());
      case 't':
        expect_literal("true");
        return Value(true);
      case 'f':
        expect_literal("false");
        return Value(false);
      case 'n':
        expect_literal("null");
        return Value(nullptr);
      default:
        if (peek() == '-' || (peek() >= '0' && peek() <= '9')) {
          return Value(parse_number());
        }
        fail("unexpected token");
    }
  }

  void check_depth(std::size_t depth) const {
    if (depth > kMaxDepth) {
      fail("nesting deeper than " + std::to_string(kMaxDepth));
    }
  }

  Value parse_array(std::size_t depth) {
    check_depth(depth);
    ++pos_;
    Array items;
    skip_space();
    if (!at_end() && peek() == ']') {
      ++pos_;
      return Value(std::move(items));
    }
    while (true) {
      skip_space();
      items.push_back(parse_value(depth));
      skip_space();
      if (at_end()) {
        fail("unterminated array");
      }
      if (peek() == ',') {
        ++pos_;
      } else if (peek() == ']') {
        ++pos_;
        return Value(std::move(items));
      } else {
        fail("expected ',' or ']'");
      }
    }
  }

  Value parse_object(std::size_t depth) {
    check_depth(depth);
    ++pos_;
    Object members;
    skip_space();
    if (!at_end() && peek() == '}') {
      ++pos_;
      return Value(std::move(members));
    }
    while (true) {
      skip_space();
      if (at_end() || peek() != '"') {
        fail("expected a string key");
      }
      std::string key = parse_string();
      skip_space();
      if (at_end() || peek() != ':') {
        fail("expected ':'");
      }
      ++pos_;
      skip_space();
      members.set(std::move(key), parse_value(depth));
      skip_space();
      if (at_end()) {
        fail("unterminated object");
      }
      if (peek() == ',') {
        ++pos_;
      } else if (peek() == '}') {
        ++pos_;
        return Value(std::move(members));
      } else {
        fail("expected ',' or '}'");
      }
    }
  }

  std::size_t digits() {
    std::size_t start = pos_;
    while (!at_end() && peek() >= '0' && peek() <= '9') {
      ++pos_;
    }
    return pos_ - start;
  }

  double parse_number() {
    std::size_t start = pos_;
    if (peek() == '-') {
      ++pos_;
    }
    if (at_end()) {
      fail("invalid number");
    }
    if (peek() == '0') {
      ++pos_;
    } else if (digits() == 0) {
      fail("invalid number");
    }
    if (!at_end() && peek() == '.') {
      ++pos_;
      if (digits() == 0) {
        fail("invalid number");
      }
    }
    if (!at_end() && (peek() == 'e' || peek() == 'E')) {
      ++pos_;
      if (!at_end() && (peek() == '+' || peek() == '-')) {
        ++pos_;
      }
      if (digits() == 0) {
        fail("invalid number");
      }
    }
    return js::detail::parse_decimal(text_.substr(start, pos_ - start));
  }

  int hex_digit(char c) const {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  }

  std::uint32_t parse_u_escape() {
    if (text_.size() - pos_ < 4) {
      fail("invalid \\u escape");
    }
    std::uint32_t unit = 0;
    for (int k = 0; k < 4; ++k) {
      int d = hex_digit(text_[pos_ + static_cast<std::size_t>(k)]);
      if (d < 0) {
        fail("invalid \\u escape");
      }
      unit = unit * 16 + static_cast<std::uint32_t>(d);
    }
    pos_ += 4;
    return unit;
  }

  std::uint8_t byte_at(std::size_t k) const { return static_cast<std::uint8_t>(text_[k]); }

  bool continuation(std::size_t k) const { return k < text_.size() && (byte_at(k) & 0xC0) == 0x80; }

  /** Validate one non-ASCII UTF-8 (or WTF-8 surrogate) sequence and return its code point. */
  std::uint32_t parse_multibyte() {
    std::uint8_t b0 = byte_at(pos_);
    std::size_t len = 0;
    std::uint8_t lo = 0x80;
    std::uint8_t hi = 0xBF;
    if (b0 >= 0xC2 && b0 <= 0xDF) {
      len = 2;
    } else if (b0 >= 0xE0 && b0 <= 0xEF) {
      len = 3;
      if (b0 == 0xE0) lo = 0xA0;
    } else if (b0 >= 0xF0 && b0 <= 0xF4) {
      len = 4;
      if (b0 == 0xF0) lo = 0x90;
      if (b0 == 0xF4) hi = 0x8F;
    } else {
      fail("invalid UTF-8");
    }
    if (!continuation(pos_ + 1) || byte_at(pos_ + 1) < lo || byte_at(pos_ + 1) > hi) {
      fail("invalid UTF-8");
    }
    for (std::size_t k = 2; k < len; ++k) {
      if (!continuation(pos_ + k)) {
        fail("invalid UTF-8");
      }
    }
    std::size_t i = pos_;
    std::uint32_t cp = js::detail::decode_wtf8(text_, i);
    pos_ = i;
    return cp;
  }

  std::string parse_string() {
    ++pos_;
    std::string out;
    while (true) {
      if (at_end()) {
        fail("unterminated string");
      }
      auto c = static_cast<unsigned char>(peek());
      if (c == '"') {
        ++pos_;
        return out;
      }
      if (c < 0x20) {
        fail("control character in string");
      }
      if (c == '\\') {
        ++pos_;
        if (at_end()) {
          fail("unterminated string");
        }
        char e = peek();
        ++pos_;
        switch (e) {
          case '"':
            out.push_back('"');
            break;
          case '\\':
            out.push_back('\\');
            break;
          case '/':
            out.push_back('/');
            break;
          case 'b':
            out.push_back('\b');
            break;
          case 'f':
            out.push_back('\f');
            break;
          case 'n':
            out.push_back('\n');
            break;
          case 'r':
            out.push_back('\r');
            break;
          case 't':
            out.push_back('\t');
            break;
          case 'u':
            js::append_wtf8(out, parse_u_escape());
            break;
          default:
            --pos_;
            fail("invalid escape");
        }
      } else if (c < 0x80) {
        out.push_back(static_cast<char>(c));
        ++pos_;
      } else {
        js::append_wtf8(out, parse_multibyte());
      }
    }
  }

  std::string_view text_;
  std::size_t pos_ = 0;
};

}  // namespace

Value parse(std::string_view text) { return Parser(text).parse_document(); }

}  // namespace cantus::json
