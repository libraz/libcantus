#include "ops/handles.h"

#include <atomic>
#include <mutex>
#include <unordered_map>
#include <utility>

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
  Entry entry;
  bool issued = false;
  if (!table().find(id, entry, issued)) {
    if (issued) {
      throw ReleasedHandleError(tag_type + " handle " + js::to_string(static_cast<double>(id)) +
                                " has been released");
    }
    throw RequestError("unknown handle " + js::to_string(static_cast<double>(id)));
  }
  if (entry.type != type || tag_type != type) {
    throw RequestError("handle " + js::to_string(static_cast<double>(id)) + " is a " +
                       js::quote(entry.type) + ", not a " + js::quote(type));
  }
  return entry.object;
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
