#include "ops/args.h"

#include <cstdint>
#include <string>
#include <utility>

#include "js/format.h"
#include "ops/codec.h"
#include "ops/error_map.h"

namespace cantus::ops {

const json::Value& Args::operator[](std::size_t i) const noexcept {
  return i < values_->size() ? (*values_)[i] : undefined_value();
}

json::Value Args::take(std::size_t i) {
  if (i >= values_->size()) {
    return undefined_value();
  }
  json::Value out;
  std::swap(out, (*values_)[i]);
  return out;
}

bool Args::undefined(std::size_t i) const noexcept { return is_undefined(operator[](i)); }

Callback Args::callback(const json::Value& v) const {
  if (tag_of(v) != Tag::kCallback) {
    throw RequestError("expected a callback");
  }
  if (!context_->has_callbacks()) {
    throw RequestError("callback arguments need a host callback function");
  }
  auto id = static_cast<std::uint32_t>(v.as_object().find("$cb")->as_number());
  return Callback(*context_, id);
}

const json::Object& Args::hybrid(std::size_t i, std::string_view type) const {
  const json::Value& v = operator[](i);
  const json::Value* name = tag_of(v) == Tag::kHybrid ? v.as_object().find("$hy") : nullptr;
  if (name == nullptr || name->as_string() != type) {
    throw RequestError("expected a " + js::quote(type) + " hybrid");
  }
  return v.as_object();
}

}  // namespace cantus::ops
