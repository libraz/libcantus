#include "ops/registry.h"

#include <map>
#include <stdexcept>

#include "ops/register_all.h"

namespace cantus::ops {

namespace {

using OpMap = std::map<std::string, OpEntry, std::less<>>;

/** The map being filled while register_all() runs; null otherwise. */
OpMap* g_building = nullptr;

const OpMap& registry() {
  static const OpMap* const kOps = [] {
    auto* ops = new OpMap();
    g_building = ops;
    try {
      register_all();
    } catch (...) {
      g_building = nullptr;
      throw;
    }
    g_building = nullptr;
    return ops;
  }();
  return *kOps;
}

}  // namespace

void def(std::string name, OpFn fn, unsigned flags) {
  if (g_building == nullptr) {
    throw std::logic_error("ops::def outside registration: " + name);
  }
  auto [it, inserted] = g_building->emplace(std::move(name), OpEntry{std::move(fn), flags});
  if (!inserted) {
    throw std::logic_error("duplicate op: " + it->first);
  }
}

const OpEntry* find_op(std::string_view name) {
  const OpMap& ops = registry();
  auto it = ops.find(name);
  return it == ops.end() ? nullptr : &it->second;
}

std::vector<std::pair<std::string, const OpEntry*>> list_ops() {
  std::vector<std::pair<std::string, const OpEntry*>> out;
  for (const auto& [name, entry] : registry()) {
    out.emplace_back(name, &entry);
  }
  return out;
}

}  // namespace cantus::ops
