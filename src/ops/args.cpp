#include "ops/args.h"

#include <cstdint>
#include <string>
#include <utility>

#include "js/format.h"
#include "ops/codec.h"
#include "ops/error_map.h"

namespace cantus::ops {

const json::Value& Args::operator[](std::size_t i) const noexcept {
  if (const Retained* snapshot = retained(i)) {
    return snapshot->wire();
  }
  return i < values_->size() ? (*values_)[i] : undefined_value();
}

json::Value Args::take(std::size_t i) {
  if (i >= values_->size()) {
    return undefined_value();
  }
  if (retained(i) != nullptr) {
    return share_wire(slots_[i].snapshot);
  }
  json::Value out;
  std::swap(out, (*values_)[i]);
  return out;
}

bool Args::undefined(std::size_t i) const noexcept { return is_undefined(operator[](i)); }

Args::Slot& Args::slot(std::size_t i) const {
  if (slots_.size() <= i) {
    slots_.resize(i + 1);
  }
  return slots_[i];
}

void Args::hold(std::size_t i, std::shared_ptr<const Retained> snapshot) {
  slot(i).snapshot = std::move(snapshot);
}

const Retained* Args::retained(std::size_t i) const noexcept {
  return i < slots_.size() ? slots_[i].snapshot.get() : nullptr;
}

const Decoded* Args::decoded(std::size_t i) const noexcept {
  if (i >= slots_.size()) {
    return nullptr;
  }
  const Slot& s = slots_[i];
  return s.decoded ? s.decoded.get() : s.snapshot ? s.snapshot->decoded().get() : nullptr;
}

void Args::keep(std::size_t i, std::shared_ptr<const Decoded> decoded) const {
  slot(i).decoded = std::move(decoded);
}

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
