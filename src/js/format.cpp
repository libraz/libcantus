#include "js/format.h"

#include <cstdint>

#include "js/number.h"
#include "js/utf16.h"

namespace cantus::js {

namespace {

/** Longest echo of a rejected string, in UTF-16 code units (MAX_ECHOED_LENGTH in TS). */
constexpr std::size_t kMaxEchoedLength = 64;

constexpr char kHex[] = "0123456789abcdef";

void append_u_escape(std::string& out, std::uint32_t unit) {
  out += "\\u";
  out.push_back(kHex[(unit >> 12) & 0xF]);
  out.push_back(kHex[(unit >> 8) & 0xF]);
  out.push_back(kHex[(unit >> 4) & 0xF]);
  out.push_back(kHex[unit & 0xF]);
}

/** The string member `key` of a tag object, or nullptr. */
const std::string* tag_string(const json::Object& o, std::string_view key) {
  const json::Value* v = o.find(key);
  return v != nullptr && v->is_string() ? &v->as_string() : nullptr;
}

void append_template(const json::Value& v, std::string& out);

void append_object_template(const json::Object& o, std::string& out) {
  if (const std::string* n = tag_string(o, "$n")) {
    out += *n == "-0" ? "0" : *n;
  } else if (o.contains("$u")) {
    out += "undefined";
  } else if (const std::string* big = tag_string(o, "$big")) {
    out += *big;
  } else if (o.contains("$sym")) {
    throw TypeError("Cannot convert a Symbol value to a string");
  } else if (const std::string* repr = tag_string(o, "$repr")) {
    out += *repr;
  } else if (o.contains("$cb")) {
    throw std::invalid_argument("a callback has no portable string form");
  } else {
    out += "[object Object]";
  }
}

void append_template(const json::Value& v, std::string& out) {
  switch (v.kind()) {
    case json::Kind::kNull:
      out += "null";
      return;
    case json::Kind::kBool:
      out += v.as_bool() ? "true" : "false";
      return;
    case json::Kind::kNumber:
      out += to_string(v.as_number());
      return;
    case json::Kind::kString:
      out += v.as_string();
      return;
    case json::Kind::kArray: {
      bool first = true;
      for (const json::Value& e : v.as_array()) {
        if (!first) {
          out.push_back(',');
        }
        first = false;
        // Array.prototype.join writes null and undefined elements as empty.
        if (e.is_null() || (e.is_object() && e.as_object().contains("$u"))) {
          continue;
        }
        append_template(e, out);
      }
      return;
    }
    case json::Kind::kObject:
      append_object_template(v.as_object(), out);
      return;
  }
}

/** `typeof` of the JS value `v` stands for. */
const char* type_of(const json::Value& v) {
  switch (v.kind()) {
    case json::Kind::kNull:
    case json::Kind::kArray:
      return "object";
    case json::Kind::kBool:
      return "boolean";
    case json::Kind::kNumber:
      return "number";
    case json::Kind::kString:
      return "string";
    case json::Kind::kObject:
      break;
  }
  const json::Object& o = v.as_object();
  if (o.contains("$n")) return "number";
  if (o.contains("$u")) return "undefined";
  if (o.contains("$big")) return "bigint";
  if (o.contains("$sym")) return "symbol";
  if (o.contains("$cb")) return "function";
  return "object";
}

}  // namespace

void quote_to(std::string_view s, std::string& out) {
  out.push_back('"');
  std::size_t i = 0;
  while (i < s.size()) {
    std::size_t start = i;
    std::uint32_t cp = detail::decode_wtf8(s, i);
    switch (cp) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (cp < 0x20 || (cp >= 0xD800 && cp <= 0xDFFF)) {
          append_u_escape(out, cp);
        } else {
          out.append(s.data() + start, i - start);
        }
    }
  }
  out.push_back('"');
}

std::string quote(std::string_view s) {
  std::string out;
  out.reserve(s.size() + 2);
  quote_to(s, out);
  return out;
}

std::string template_string(const json::Value& v) {
  std::string out;
  append_template(v, out);
  return out;
}

std::string describe_rejected(const json::Value& v) {
  if (v.is_null()) {
    return "null";
  }
  if (!v.is_string()) {
    return type_of(v);
  }
  const std::string& s = v.as_string();
  std::size_t length = utf16_length(s);
  if (length <= kMaxEchoedLength) {
    return quote(s);
  }
  return quote(utf16_slice(s, 0, static_cast<double>(kMaxEchoedLength))) + " (truncated from " +
         std::to_string(length) + " characters)";
}

}  // namespace cantus::js
