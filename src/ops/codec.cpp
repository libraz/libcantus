#include "ops/codec.h"

#include <cmath>
#include <limits>
#include <vector>

#include "js/format.h"
#include "ops/error_map.h"

namespace cantus::ops {

namespace {

/** 2^53 - 1: the largest id a JS number holds exactly. */
constexpr double kMaxSafeInteger = 9007199254740991.0;

[[noreturn]] void reject(const std::string& message) { throw RequestError(message); }

bool is_tag_key(std::string_view key) {
  return key.size() >= 1 && key[0] == '$' && !(key.size() >= 2 && key[1] == '$');
}

bool is_integer_in(const json::Value& v, double lo, double hi) {
  if (!v.is_number()) {
    return false;
  }
  double x = v.as_number();
  return x >= lo && x <= hi && std::floor(x) == x;
}

bool is_decimal_integer(const std::string& s) {
  std::size_t i = s.size() > 0 && s[0] == '-' ? 1 : 0;
  if (i == s.size()) {
    return false;
  }
  if (s[i] == '0') {
    return i + 1 == s.size();
  }
  for (; i < s.size(); ++i) {
    if (s[i] < '0' || s[i] > '9') {
      return false;
    }
  }
  return true;
}

/** Number of tag keys of `o`, with `primary` set to the first one. */
std::size_t tag_keys(const json::Object& o, std::string_view& primary) {
  std::size_t n = 0;
  for (const json::Member& m : o) {
    if (is_tag_key(m.key)) {
      if (n == 0) {
        primary = m.key;
      }
      ++n;
    }
  }
  return n;
}

std::string quoted(std::string_view s) { return js::quote(s); }

void expect_only(const json::Object& o, std::size_t keys, std::string_view tag) {
  if (o.size() != keys) {
    reject("malformed " + quoted(tag) + " tag");
  }
}

/** A value still to validate, and whether `$u` may stand there. */
struct Pending {
  const json::Value* value;
  bool undefined_allowed;
};

/** Queue the user-data members of `o` so they are validated in member order. */
void push_members(const json::Object& o, std::vector<Pending>& pending) {
  for (const json::Member* m = o.end(); m != o.begin();) {
    --m;
    if (!is_tag_key(m->key)) {
      pending.push_back(Pending{&m->value, false});
    }
  }
}

/** A tag that carries user data beside it: `$class`, `$hy`, and `$id` on a getter result. */
void validate_data_tag(const json::Object& o, std::string_view tag, std::vector<Pending>& pending) {
  for (const json::Member& m : o) {
    if (!is_tag_key(m.key)) {
      continue;
    }
    if (m.key == "$class" || m.key == "$hy") {
      if (!m.value.is_string()) {
        reject("malformed " + quoted(m.key) + " tag");
      }
    } else if (m.key == "$id") {
      if (!is_integer_in(m.value, 0, kMaxSafeInteger)) {
        reject("malformed \"$id\" tag");
      }
    } else {
      reject("malformed " + quoted(tag) + " tag");
    }
  }
  if (o.contains("$class") && o.contains("$hy")) {
    reject("malformed \"$class\" tag");
  }
  push_members(o, pending);
}

/** Check the tags of `o` itself and queue the values nested in it. */
void validate_object(const json::Object& o, bool undefined_allowed, ValidateStats& stats,
                     std::vector<Pending>& pending) {
  std::string_view tag;
  std::size_t n = tag_keys(o, tag);
  if (n == 0) {
    push_members(o, pending);
    return;
  }
  if (const json::Value* x = o.find("$n")) {
    expect_only(o, 1, "$n");
    const std::string* s = x->is_string() ? &x->as_string() : nullptr;
    if (s == nullptr || (*s != "-0" && *s != "NaN" && *s != "Infinity" && *s != "-Infinity")) {
      reject("malformed \"$n\" tag");
    }
    return;
  }
  if (const json::Value* x = o.find("$u")) {
    expect_only(o, 1, "$u");
    if (!x->is_number() || x->as_number() != 1) {
      reject("malformed \"$u\" tag");
    }
    if (!undefined_allowed) {
      reject("\"$u\" is only valid as an array element");
    }
    return;
  }
  if (const json::Value* x = o.find("$big")) {
    expect_only(o, 1, "$big");
    if (!x->is_string() || !is_decimal_integer(x->as_string())) {
      reject("malformed \"$big\" tag");
    }
    return;
  }
  if (const json::Value* x = o.find("$sym")) {
    expect_only(o, 1, "$sym");
    if (!x->is_string()) {
      reject("malformed \"$sym\" tag");
    }
    return;
  }
  if (o.contains("$tojson") || o.contains("$repr")) {
    const json::Value* payload = o.find("$tojson");
    const json::Value* repr = o.find("$repr");
    if (payload == nullptr || repr == nullptr || o.size() != 2 || !repr->is_string()) {
      reject("malformed \"$tojson\" tag");
    }
    pending.push_back(Pending{payload, true});
    return;
  }
  if (o.contains("$class") || o.contains("$hy")) {
    validate_data_tag(o, o.contains("$class") ? "$class" : "$hy", pending);
    return;
  }
  if (const json::Value* x = o.find("$h")) {
    const json::Value* type = o.find("$type");
    if (o.size() != 2 || type == nullptr || !type->is_string() ||
        !is_integer_in(*x, 1, kMaxSafeInteger)) {
      reject("malformed \"$h\" tag");
    }
    return;
  }
  if (const json::Value* x = o.find("$cb")) {
    expect_only(o, 1, "$cb");
    if (!is_integer_in(*x, 0, std::numeric_limits<std::uint32_t>::max())) {
      reject("malformed \"$cb\" tag");
    }
    ++stats.callbacks;
    return;
  }
  if (o.contains("$id")) {
    validate_data_tag(o, "$id", pending);
    return;
  }
  reject("unknown wire tag " + quoted(tag));
}

/** Append a number as the wire writes it: NaN, ±Infinity and -0 as `$n` tags. */
void write_number(const json::Value& v, std::string& out) {
  double x = v.as_number();
  if (std::isnan(x)) {
    out += R"({"$n":"NaN"})";
  } else if (std::isinf(x)) {
    out += x > 0 ? R"({"$n":"Infinity"})" : R"({"$n":"-Infinity"})";
  } else if (x == 0 && std::signbit(x)) {
    out += R"({"$n":"-0"})";
  } else {
    json::stringify_to(v, out);
  }
}

}  // namespace

Tag tag_of(const json::Value& v) noexcept {
  if (!v.is_object()) {
    return Tag::kNone;
  }
  const json::Object& o = v.as_object();
  if (o.contains("$n")) return Tag::kNumber;
  if (o.contains("$u")) return Tag::kUndefined;
  if (o.contains("$big")) return Tag::kBigInt;
  if (o.contains("$sym")) return Tag::kSymbol;
  if (o.contains("$tojson")) return Tag::kToJson;
  if (o.contains("$class")) return Tag::kClass;
  if (o.contains("$hy")) return Tag::kHybrid;
  if (o.contains("$h")) return Tag::kHandle;
  if (o.contains("$cb")) return Tag::kCallback;
  if (o.contains("$id")) return Tag::kIdentity;
  return Tag::kNone;
}

ValidateStats validate(const json::Value& v, bool allow_top_level_undefined) {
  // Depth-first in document order from an explicit stack, so nesting costs heap, not native stack.
  ValidateStats stats;
  std::vector<Pending> pending{Pending{&v, allow_top_level_undefined}};
  while (!pending.empty()) {
    Pending next = pending.back();
    pending.pop_back();
    if (next.value->is_array()) {
      const json::Array& items = next.value->as_array();
      for (auto it = items.rbegin(); it != items.rend(); ++it) {
        pending.push_back(Pending{&*it, true});
      }
    } else if (next.value->is_object()) {
      validate_object(next.value->as_object(), next.undefined_allowed, stats, pending);
    }
  }
  return stats;
}

void stringify_to(const json::Value& v, std::string& out) {
  // One frame per open container, as json::stringify_to keeps them.
  struct Frame {
    const json::Value* container;
    std::size_t next;
  };
  std::vector<Frame> stack;
  const json::Value* current = &v;
  while (true) {
    switch (current->kind()) {
      case json::Kind::kNumber:
        write_number(*current, out);
        break;
      case json::Kind::kArray:
        out.push_back('[');
        stack.push_back(Frame{current, 0});
        break;
      case json::Kind::kObject:
        out.push_back('{');
        stack.push_back(Frame{current, 0});
        break;
      case json::Kind::kNull:
      case json::Kind::kBool:
      case json::Kind::kString:
        json::stringify_to(*current, out);
        break;
    }
    // Advance to the next value to write, closing containers that are exhausted.
    while (true) {
      if (stack.empty()) {
        return;
      }
      Frame& frame = stack.back();
      const bool is_array = frame.container->is_array();
      const std::size_t size =
          is_array ? frame.container->as_array().size() : frame.container->as_object().size();
      if (frame.next == size) {
        out.push_back(is_array ? ']' : '}');
        stack.pop_back();
        continue;
      }
      if (frame.next > 0) {
        out.push_back(',');
      }
      if (is_array) {
        current = &frame.container->as_array()[frame.next];
      } else {
        const json::Member& member = frame.container->as_object().begin()[frame.next];
        js::quote_to(member.key, out);
        out.push_back(':');
        current = &member.value;
      }
      ++frame.next;
      break;
    }
  }
}

std::string stringify(const json::Value& v) {
  std::string out;
  ops::stringify_to(v, out);
  return out;
}

const json::Value& undefined_value() {
  static const json::Value* const kUndefined = [] {
    json::Object o;
    o.set("$u", 1);
    return new json::Value(std::move(o));
  }();
  return *kUndefined;
}

bool is_undefined(const json::Value& v) noexcept {
  return v.is_object() && v.as_object().size() == 1 && v.as_object().contains("$u");
}

std::optional<double> number_of(const json::Value& v) noexcept {
  if (v.is_number()) {
    return v.as_number();
  }
  if (!v.is_object()) {
    return std::nullopt;
  }
  const json::Value* n = v.as_object().find("$n");
  if (n == nullptr || !n->is_string()) {
    return std::nullopt;
  }
  const std::string& s = n->as_string();
  if (s == "NaN") return std::numeric_limits<double>::quiet_NaN();
  if (s == "Infinity") return std::numeric_limits<double>::infinity();
  if (s == "-Infinity") return -std::numeric_limits<double>::infinity();
  if (s == "-0") return -0.0;
  return std::nullopt;
}

std::string escape_key(std::string_view key) {
  if (!key.empty() && key[0] == '$') {
    std::string out = "$";
    out += key;
    return out;
  }
  return std::string(key);
}

std::string unescape_key(std::string_view wire_key) {
  if (wire_key.size() >= 2 && wire_key[0] == '$' && wire_key[1] == '$') {
    return std::string(wire_key.substr(1));
  }
  return std::string(wire_key);
}

json::Value to_json(const json::Value& v) { return v; }
json::Value to_json(bool b) { return json::Value(b); }
json::Value to_json(double d) { return json::Value(d); }
json::Value to_json(const std::string& s) { return json::Value(s); }
json::Value to_json(std::string_view s) { return json::Value(s); }
json::Value to_json(const char* s) { return json::Value(s); }

}  // namespace cantus::ops
