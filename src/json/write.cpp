#include <cmath>

#include "js/format.h"
#include "js/number.h"
#include "json/json.h"

namespace cantus::json {

void stringify_to(const Value& value, std::string& out) {
  switch (value.kind()) {
    case Kind::kNull:
      out += "null";
      return;
    case Kind::kBool:
      out += value.as_bool() ? "true" : "false";
      return;
    case Kind::kNumber: {
      double n = value.as_number();
      out += std::isfinite(n) ? js::to_string(n) : "null";
      return;
    }
    case Kind::kString:
      js::quote_to(value.as_string(), out);
      return;
    case Kind::kArray: {
      out.push_back('[');
      bool first = true;
      for (const Value& item : value.as_array()) {
        if (!first) {
          out.push_back(',');
        }
        first = false;
        stringify_to(item, out);
      }
      out.push_back(']');
      return;
    }
    case Kind::kObject: {
      out.push_back('{');
      bool first = true;
      for (const Member& member : value.as_object()) {
        if (!first) {
          out.push_back(',');
        }
        first = false;
        js::quote_to(member.key, out);
        out.push_back(':');
        stringify_to(member.value, out);
      }
      out.push_back('}');
      return;
    }
  }
}

std::string stringify(const Value& value) {
  std::string out;
  stringify_to(value, out);
  return out;
}

}  // namespace cantus::json
