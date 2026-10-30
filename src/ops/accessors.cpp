#include "ops/accessors.h"

#include <string>

#include "ops/codec.h"

namespace cantus::ops {

const json::Value* field(const json::Value& opts, std::string_view key) noexcept {
  if (!opts.is_object()) {
    return nullptr;
  }
  const json::Value* v = nullptr;
  if (!key.empty() && key[0] == '$') {
    try {
      v = opts.as_object().find(escape_key(key));
    } catch (...) {
      return nullptr;
    }
  } else {
    v = opts.as_object().find(key);
  }
  return v == nullptr || is_undefined(*v) ? nullptr : v;
}

const json::Value* opt_null_default(const json::Value& opts, std::string_view key) noexcept {
  const json::Value* v = field(opts, key);
  return v == nullptr || v->is_null() ? nullptr : v;
}

json::Value opt_or(const json::Value& opts, std::string_view key, const json::Value& fallback) {
  const json::Value* v = opt_null_default(opts, key);
  return v != nullptr ? *v : fallback;
}

Presence opt_nullable(const json::Value& opts, std::string_view key) noexcept {
  const json::Value* v = field(opts, key);
  if (v == nullptr) {
    return Presence::kAbsent;
  }
  return v->is_null() ? Presence::kNull : Presence::kValue;
}

}  // namespace cantus::ops
