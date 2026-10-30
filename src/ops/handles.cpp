#include "ops/handles.h"

#include <atomic>
#include <mutex>
#include <unordered_map>
#include <utility>
#include <vector>

#include "js/format.h"
#include "js/number.h"
#include "ops/codec.h"
#include "ops/error_map.h"

namespace cantus::ops {

namespace {

struct Entry {
  std::shared_ptr<Handle> object;
  std::string type;
};

class HandleTable {
 public:
  std::uint64_t insert(std::shared_ptr<Handle> object, std::string type) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::uint64_t id = ++last_id_;
    entries_.emplace(id, Entry{std::move(object), std::move(type)});
    return id;
  }

  /** The entry for `id`; `issued` tells a released id from one never handed out. */
  bool find(std::uint64_t id, Entry& out, bool& issued) {
    std::lock_guard<std::mutex> lock(mutex_);
    issued = id >= 1 && id <= last_id_;
    auto it = entries_.find(id);
    if (it == entries_.end()) {
      return false;
    }
    out = it->second;
    return true;
  }

  void erase(std::uint64_t id) noexcept {
    std::shared_ptr<Handle> doomed;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      auto it = entries_.find(id);
      if (it == entries_.end()) {
        return;
      }
      doomed = std::move(it->second.object);
      entries_.erase(it);
    }
    // The object is destroyed here, outside the lock.
  }

  std::size_t size() noexcept {
    std::lock_guard<std::mutex> lock(mutex_);
    return entries_.size();
  }

 private:
  std::mutex mutex_;
  std::uint64_t last_id_ = 0;
  std::unordered_map<std::uint64_t, Entry> entries_;
};

HandleTable& table() {
  static HandleTable* const kTable = new HandleTable();
  return *kTable;
}

std::atomic<std::uint64_t> g_last_token{0};

/** The live entry of `id`; `label` names the handle in the released message. */
Entry find_entry(std::uint64_t id, const std::string& label) {
  Entry entry;
  bool issued = false;
  if (!table().find(id, entry, issued)) {
    if (issued) {
      throw ReleasedHandleError(label + " handle " + js::to_string(static_cast<double>(id)) +
                                " has been released");
    }
    throw RequestError("unknown handle " + js::to_string(static_cast<double>(id)));
  }
  return entry;
}

/** The tag key of a `$class` or `$hy` value. */
const char* data_tag_key(const json::Object& o) { return o.contains("$class") ? "$class" : "$hy"; }

}  // namespace

json::Value new_handle(std::shared_ptr<Handle> object, std::string type) {
  std::string type_name = type;
  std::uint64_t id = table().insert(std::move(object), std::move(type));
  json::Object out;
  out.set("$h", static_cast<double>(id));
  out.set("$type", std::move(type_name));
  return json::Value(std::move(out));
}

std::shared_ptr<Handle> resolve_handle(const json::Value& tag, std::string_view type) {
  if (tag_of(tag) != Tag::kHandle) {
    throw RequestError("expected a " + js::quote(type) + " handle");
  }
  const json::Object& o = tag.as_object();
  auto id = static_cast<std::uint64_t>(o.find("$h")->as_number());
  const std::string& tag_type = o.find("$type")->as_string();
  Entry entry = find_entry(id, tag_type);
  if (entry.type != type || tag_type != type) {
    throw RequestError("handle " + js::to_string(static_cast<double>(id)) + " is a " +
                       js::quote(entry.type) + ", not a " + js::quote(type));
  }
  return entry.object;
}

Retained::Retained(json::Value wire, std::shared_ptr<const Decoded> decoded)
    : wire_(std::move(wire)), decoded_(std::move(decoded)) {}

json::Value retain(json::Value wire, std::shared_ptr<const Decoded> decoded) {
  const json::Object& tagged = std::as_const(wire).as_object();
  const char* key = data_tag_key(tagged);
  json::Object out;
  out.set(key, *tagged.find(key));
  json::build_indices(wire);
  std::uint64_t id = table().insert(std::make_shared<Retained>(std::move(wire), std::move(decoded)),
                                    Retained::kTypeName);
  out.set("$ref", static_cast<double>(id));
  return json::Value(std::move(out));
}

bool is_ref(const json::Value& v) noexcept {
  return v.is_object() && v.as_object().contains("$ref") &&
         (v.as_object().contains("$class") || v.as_object().contains("$hy"));
}

std::shared_ptr<const Retained> resolve_ref(const json::Value& ref) {
  const json::Object& o = ref.as_object();
  const char* key = data_tag_key(o);
  const std::string& name = o.find(key)->as_string();
  auto id = static_cast<std::uint64_t>(o.find("$ref")->as_number());
  Entry entry = find_entry(id, name);
  const json::Value* held = nullptr;
  if (entry.type == Retained::kTypeName) {
    held = static_cast<const Retained&>(*entry.object).wire().as_object().find(key);
  }
  if (held == nullptr || held->as_string() != name) {
    throw RequestError("expected a " + js::quote(name) +
                       (o.contains("$class") ? " instance" : " hybrid"));
  }
  return std::static_pointer_cast<const Retained>(entry.object);
}

void expand_refs(json::Value& v) {
  std::vector<json::Value*> pending{&v};
  while (!pending.empty()) {
    json::Value* next = pending.back();
    pending.pop_back();
    if (is_ref(*next)) {
      // A snapshot holds no `$ref`, so what stands in for it needs no further walk.
      *next = share_wire(resolve_ref(*next));
    } else if (next->is_array()) {
      for (json::Value& item : next->as_array()) {
        pending.push_back(&item);
      }
    } else if (next->is_object()) {
      json::Object& o = next->as_object();
      for (const json::Member& m : o) {
        pending.push_back(o.find(m.key));
      }
    }
  }
}

json::Value share_wire(const std::shared_ptr<const Retained>& snapshot) {
  const json::Value& wire = snapshot->wire();
  return json::Value::share(std::shared_ptr<const json::Value>(snapshot, &wire));
}

void release_handle(std::uint64_t id) noexcept { table().erase(id); }

std::size_t live_handles() noexcept { return table().size(); }

std::uint64_t Identity::token() {
  if (token_ == 0) {
    token_ = g_last_token.fetch_add(1, std::memory_order_relaxed) + 1;
  }
  return token_;
}

json::Value with_identity(Identity& identity, const json::Object& data) {
  json::Object out;
  out.set("$id", static_cast<double>(identity.token()));
  for (const json::Member& m : data) {
    out.set(m.key, m.value);
  }
  return json::Value(std::move(out));
}

}  // namespace cantus::ops
