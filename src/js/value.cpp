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

double to_math_number(const json::Value& v) {
  if (type_of(v) == "bigint") {
    throw TypeError("Cannot convert a BigInt value to a number");
  }
  return to_number(v);
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

json::Value add(const json::Value& lhs, const json::Value& rhs) {
  if (is_text(lhs) || is_text(rhs)) {
    return json::Value(template_string(lhs) + template_string(rhs));
  }
  for (const json::Value* operand : {&lhs, &rhs}) {
    if (type_of(*operand) == "bigint") {
      throw TypeError("Cannot mix BigInt and other types, use explicit conversions");
    }
  }
  return json::Value(to_number(lhs) + to_number(rhs));
}

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

namespace {

/** The decimal text of a `$big` tag, or nullptr for any other value. */
const std::string* big_text(const json::Value& v) {
  if (!v.is_object()) return nullptr;
  const json::Value* big = v.as_object().find("$big");
  return big != nullptr && big->is_string() ? &big->as_string() : nullptr;
}

/** Whether `v` is a number to JS: a JSON number or a `$n` tag. */
bool number_value(const json::Value& v, double& out) {
  if (v.is_number()) {
    out = v.as_number();
    return true;
  }
  if (v.is_object() && v.as_object().contains("$n")) {
    out = tag_number(v.as_object());
    return true;
  }
  return false;
}

bool equals(const json::Value& a, const json::Value& b, bool nan_equal) {
  if (&a == &b) {
    double self = 0;
    return !number_value(a, self) || nan_equal || !std::isnan(self);
  }
  double x = 0;
  double y = 0;
  bool a_number = number_value(a, x);
  bool b_number = number_value(b, y);
  if (a_number || b_number) {
    return a_number && b_number && (x == y || (nan_equal && std::isnan(x) && std::isnan(y)));
  }
  if (a.kind() != b.kind()) return false;
  switch (a.kind()) {
    case json::Kind::kNull:
      return true;
    case json::Kind::kBool:
      return a.as_bool() == b.as_bool();
    case json::Kind::kString:
      return a.as_string() == b.as_string();
    case json::Kind::kNumber:
    case json::Kind::kArray:
      return false;
    case json::Kind::kObject:
      break;
  }
  if (type_of(a) == "undefined" && type_of(b) == "undefined") return true;
  const std::string* big_a = big_text(a);
  const std::string* big_b = big_text(b);
  return big_a != nullptr && big_b != nullptr && *big_a == *big_b;
}

}  // namespace

bool strict_equals(const json::Value& a, const json::Value& b) { return equals(a, b, false); }

bool same_value_zero(const json::Value& a, const json::Value& b) { return equals(a, b, true); }

bool less_than(const json::Value& lhs, const json::Value& rhs) { return greater_than(rhs, lhs); }

bool less_equal(const json::Value& lhs, const json::Value& rhs) {
  if (is_text(lhs) && is_text(rhs)) {
    std::string a = lhs.kind() == json::Kind::kString ? lhs.as_string() : template_string(lhs);
    std::string b = rhs.kind() == json::Kind::kString ? rhs.as_string() : template_string(rhs);
    return utf16_compare(a, b) <= 0;
  }
  return to_number(lhs) <= to_number(rhs);
}

double subtract(const json::Value& v, double n) {
  if (type_of(v) == "bigint") {
    throw TypeError("Cannot mix BigInt and other types, use explicit conversions");
  }
  return to_number(v) - n;
}

double multiply(const json::Value& v, double factor) {
  if (type_of(v) == "bigint") {
    throw TypeError("Cannot mix BigInt and other types, use explicit conversions");
  }
  return to_number(v) * factor;
}

bool inherits_object_member(std::string_view name) {
  static constexpr std::string_view kNames[] = {
      "__defineGetter__", "__defineSetter__", "__lookupGetter__",
      "__lookupSetter__", "__proto__",        "constructor",
      "hasOwnProperty",   "isPrototypeOf",    "propertyIsEnumerable",
      "toLocaleString",   "toString",         "valueOf"};
  for (std::string_view known : kNames) {
    if (known == name) return true;
  }
  return false;
}

}  // namespace cantus::js
