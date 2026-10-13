#include "js/value.h"

#include <cmath>
#include <limits>

#include "js/format.h"
#include "js/number.h"
#include "js/utf16.h"

namespace cantus::js {

namespace {

/** The number a `$n` tag stands for. */
double tag_number(const json::Object& o) {
  const json::Value* n = o.find("$n");
  if (n != nullptr && n->is_string()) {
    const std::string& s = n->as_string();
    if (s == "Infinity") return std::numeric_limits<double>::infinity();
    if (s == "-Infinity") return -std::numeric_limits<double>::infinity();
    if (s == "-0") return -0.0;
  }
  return std::numeric_limits<double>::quiet_NaN();
}

bool is_truthy_number(double n) { return n != 0 && !std::isnan(n); }

}  // namespace

std::string type_of(const json::Value& v) {
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

bool truthy(const json::Value& v) {
  switch (v.kind()) {
    case json::Kind::kNull:
      return false;
    case json::Kind::kBool:
      return v.as_bool();
    case json::Kind::kNumber:
      return is_truthy_number(v.as_number());
    case json::Kind::kString:
      return !v.as_string().empty();
    case json::Kind::kArray:
      return true;
    case json::Kind::kObject:
      break;
  }
  const json::Object& o = v.as_object();
  if (o.contains("$n")) return is_truthy_number(tag_number(o));
  if (o.contains("$u")) return false;
  if (o.contains("$big")) return o.find("$big")->as_string() != "0";
  return true;
}

double to_number(const json::Value& v) {
  switch (v.kind()) {
    case json::Kind::kNull:
      return 0;
    case json::Kind::kBool:
      return v.as_bool() ? 1 : 0;
    case json::Kind::kNumber:
      return v.as_number();
    case json::Kind::kString:
      return number(v.as_string());
    case json::Kind::kArray:
      return number(template_string(v));
    case json::Kind::kObject:
      break;
  }
  const json::Object& o = v.as_object();
  if (o.contains("$n")) return tag_number(o);
  if (o.contains("$big")) return number(o.find("$big")->as_string());
  if (o.contains("$sym")) throw TypeError("Cannot convert a Symbol value to a number");
  if (o.contains("$tojson")) return number(o.find("$repr")->as_string());
  return std::nan("");
}

namespace {

bool is_text(const json::Value& v) {
  if (v.kind() == json::Kind::kString || v.kind() == json::Kind::kArray) return true;
  if (v.kind() != json::Kind::kObject) return false;
  const json::Object& o = v.as_object();
  for (const char* tag : {"$n", "$u", "$big", "$sym", "$tojson"}) {
    if (o.contains(tag)) return false;
  }
  return true;
}

}  // namespace

bool greater_than(const json::Value& lhs, const json::Value& rhs) {
  if (is_text(lhs) && is_text(rhs)) {
    std::string a = lhs.kind() == json::Kind::kString ? lhs.as_string() : template_string(lhs);
    std::string b = rhs.kind() == json::Kind::kString ? rhs.as_string() : template_string(rhs);
    return utf16_compare(a, b) > 0;
  }
  return to_number(lhs) > to_number(rhs);
}

json::Value add_number(double lhs, const json::Value& rhs) {
  switch (rhs.kind()) {
    case json::Kind::kNull:
      return json::Value(lhs);
    case json::Kind::kBool:
      return json::Value(lhs + (rhs.as_bool() ? 1 : 0));
    case json::Kind::kNumber:
      return json::Value(lhs + rhs.as_number());
    case json::Kind::kString:
      return json::Value(to_string(lhs) + rhs.as_string());
    case json::Kind::kArray:
      return json::Value(to_string(lhs) + template_string(rhs));
    case json::Kind::kObject:
      break;
  }
  const json::Object& o = rhs.as_object();
  if (o.contains("$n")) return json::Value(lhs + tag_number(o));
  if (o.contains("$u")) return json::Value(std::nan(""));
  if (o.contains("$big"))
    throw TypeError("Cannot mix BigInt and other types, use explicit conversions");
  if (o.contains("$sym")) throw TypeError("Cannot convert a Symbol value to a number");
  return json::Value(to_string(lhs) + template_string(rhs));
}

}  // namespace cantus::js
