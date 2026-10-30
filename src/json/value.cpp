#include <algorithm>
#include <cstdint>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#include "json/json.h"

namespace cantus::json {

namespace {

/** Object size from which lookups go through a hash index instead of a scan. */
constexpr std::size_t kIndexThreshold = 16;

/** The key's value when it is a JS array index (canonical uint32 below 2^32 - 1). */
bool array_index(std::string_view key, std::uint32_t& out) {
  if (key.empty() || key.size() > 10 || (key.size() > 1 && key[0] == '0')) {
    return false;
  }
  std::uint64_t n = 0;
  for (char c : key) {
    if (c < '0' || c > '9') {
      return false;
    }
    n = n * 10 + static_cast<std::uint64_t>(c - '0');
  }
  if (n >= 0xFFFFFFFFull) {
    return false;
  }
  out = static_cast<std::uint32_t>(n);
  return true;
}

}  // namespace

ParseError::ParseError(const std::string& message, std::size_t offset)
    : std::runtime_error(message), offset_(offset) {}

Object::Object() = default;
Object::Object(const Object& other) : members_(other.members_) {}
Object::Object(Object&& other) noexcept = default;
Object& Object::operator=(const Object& other) {
  if (this != &other) {
    members_ = other.members_;
    index_.reset();
  }
  return *this;
}
Object& Object::operator=(Object&& other) noexcept = default;
Object::~Object() = default;

std::size_t Object::size() const noexcept { return members_.size(); }
bool Object::empty() const noexcept { return members_.empty(); }
const Member* Object::begin() const noexcept { return members_.data(); }
const Member* Object::end() const noexcept { return members_.data() + members_.size(); }

std::ptrdiff_t Object::index_of(std::string_view key) const {
  if (members_.size() < kIndexThreshold) {
    for (std::size_t i = 0; i < members_.size(); ++i) {
      if (members_[i].key == key) {
        return static_cast<std::ptrdiff_t>(i);
      }
    }
    return -1;
  }
  if (!index_) {
    index_ = std::make_unique<std::unordered_map<std::string, std::size_t>>();
    index_->reserve(members_.size());
    for (std::size_t i = 0; i < members_.size(); ++i) {
      index_->emplace(members_[i].key, i);
    }
  }
  auto it = index_->find(std::string(key));
  return it == index_->end() ? -1 : static_cast<std::ptrdiff_t>(it->second);
}

const Value* Object::find(std::string_view key) const {
  std::ptrdiff_t i = index_of(key);
  return i < 0 ? nullptr : &members_[static_cast<std::size_t>(i)].value;
}

Value* Object::find(std::string_view key) {
  std::ptrdiff_t i = index_of(key);
  return i < 0 ? nullptr : &members_[static_cast<std::size_t>(i)].value;
}

std::size_t Object::index_position(std::uint32_t n) const {
  // Index keys form a sorted prefix: binary-search its end, then the first larger index in it.
  std::uint32_t m = 0;
  auto prefix_end = std::partition_point(members_.begin(), members_.end(),
                                         [&m](const Member& x) { return array_index(x.key, m); });
  auto at = std::partition_point(members_.begin(), prefix_end, [&m, n](const Member& x) {
    array_index(x.key, m);
    return m < n;
  });
  return static_cast<std::size_t>(at - members_.begin());
}

Object Object::from_members(std::vector<Member> members) {
  Object out;
  if (members.size() < kIndexThreshold) {
    for (Member& m : members) {
      out.set(std::move(m.key), std::move(m.value));
    }
    return out;
  }
  // A repeated key keeps its first place and its last value.
  std::unordered_map<std::string_view, std::size_t> first;
  first.reserve(members.size());
  std::vector<std::size_t> kept;
  kept.reserve(members.size());
  for (std::size_t i = 0; i < members.size(); ++i) {
    auto [it, inserted] = first.emplace(members[i].key, i);
    if (inserted) {
      kept.push_back(i);
    } else {
      members[it->second].value = std::move(members[i].value);
    }
  }
  // Array-index keys first in ascending order, then the rest in first-insertion order.
  std::vector<std::pair<std::uint32_t, std::size_t>> indices;
  std::vector<std::size_t> names;
  for (std::size_t i : kept) {
    std::uint32_t n = 0;
    if (array_index(members[i].key, n)) {
      indices.emplace_back(n, i);
    } else {
      names.push_back(i);
    }
  }
  std::sort(indices.begin(), indices.end());
  out.members_.reserve(kept.size());
  for (const auto& entry : indices) {
    out.members_.push_back(std::move(members[entry.second]));
  }
  for (std::size_t i : names) {
    out.members_.push_back(std::move(members[i]));
  }
  return out;
}

void Object::set(std::string key, Value value) {
  std::ptrdiff_t existing = index_of(key);
  if (existing >= 0) {
    members_[static_cast<std::size_t>(existing)].value = std::move(value);
    return;
  }
  std::size_t pos = members_.size();
  std::uint32_t n = 0;
  if (array_index(key, n)) {
    pos = index_position(n);
  }
  if (pos == members_.size()) {
    if (index_) {
      index_->emplace(key, pos);
    }
    members_.push_back(Member{std::move(key), std::move(value)});
  } else {
    index_.reset();
    members_.insert(members_.begin() + static_cast<std::ptrdiff_t>(pos),
                    Member{std::move(key), std::move(value)});
  }
}

bool operator==(const Object& a, const Object& b) {
  if (a.members_.size() != b.members_.size()) {
    return false;
  }
  for (std::size_t i = 0; i < a.members_.size(); ++i) {
    if (a.members_[i].key != b.members_[i].key || a.members_[i].value != b.members_[i].value) {
      return false;
    }
  }
  return true;
}

Value::Value() : data_(nullptr) {}
Value::Value(std::nullptr_t) : data_(nullptr) {}
Value::Value(bool b) : data_(b) {}
Value::Value(double n) : data_(n) {}
Value::Value(int n) : data_(static_cast<double>(n)) {}
Value::Value(const char* s) : data_(std::string(s)) {}
Value::Value(std::string s) : data_(std::move(s)) {}
Value::Value(std::string_view s) : data_(std::string(s)) {}
Value::Value(Array a) : data_(std::move(a)) {}
Value::Value(Object o) : data_(std::move(o)) {}
Value::Value(const Value& other) : data_(nullptr) {
  if (!other.is_array() && !other.is_object()) {
    data_ = other.data_;
    return;
  }
  // Containers are built level by level from an explicit work list; element addresses stay
  // valid because every child vector is sized once, before its own children are queued.
  std::vector<std::pair<const Value*, Value*>> work;
  work.emplace_back(&other, this);
  while (!work.empty()) {
    auto [src, dst] = work.back();
    work.pop_back();
    if (src->is_array()) {
      const Array& from = src->as_array();
      dst->data_ = Array(from.size());
      Array& to = dst->as_array();
      for (std::size_t i = 0; i < from.size(); ++i) {
        if (from[i].is_array() || from[i].is_object()) {
          work.emplace_back(&from[i], &to[i]);
        } else {
          to[i].data_ = from[i].data_;
        }
      }
    } else {
      const Object& from = src->as_object();
      Object shell;
      shell.members_.reserve(from.size());
      for (const Member& m : from) {
        shell.members_.push_back(Member{m.key, Value()});
      }
      dst->data_ = std::move(shell);
      Object& to = dst->as_object();
      std::size_t i = 0;
      for (const Member& m : from) {
        Value& slot = to.members_[i++].value;
        if (m.value.is_array() || m.value.is_object()) {
          work.emplace_back(&m.value, &slot);
        } else {
          slot.data_ = m.value.data_;
        }
      }
    }
  }
}
Value::Value(Value&& other) noexcept = default;
Value& Value::operator=(const Value& other) {
  if (this != &other) {
    *this = Value(other);
  }
  return *this;
}
Value& Value::operator=(Value&& other) noexcept = default;

void Value::detach_children(std::vector<Value>& out) {
  if (is_array()) {
    Array& items = as_array();
    for (Value& item : items) {
      if (item.is_array() || item.is_object()) {
        out.push_back(std::move(item));
      }
    }
    items.clear();
  } else if (is_object()) {
    Object& obj = as_object();
    for (Member& m : obj.members_) {
      if (m.value.is_array() || m.value.is_object()) {
        out.push_back(std::move(m.value));
      }
    }
    obj.members_.clear();
    obj.index_.reset();
  }
}

Value::~Value() {
  if (!is_array() && !is_object()) {
    return;
  }
  // Tear nested containers down from an explicit list so depth never reaches the native stack.
  std::vector<Value> pending;
  detach_children(pending);
  while (!pending.empty()) {
    Value next = std::move(pending.back());
    pending.pop_back();
    next.detach_children(pending);
  }
}

bool operator==(const Value& a, const Value& b) {
  std::vector<std::pair<const Value*, const Value*>> work;
  work.emplace_back(&a, &b);
  while (!work.empty()) {
    auto [x, y] = work.back();
    work.pop_back();
    if (x->kind() != y->kind()) {
      return false;
    }
    switch (x->kind()) {
      case Kind::kNull:
        break;
      case Kind::kBool:
        if (x->as_bool() != y->as_bool()) {
          return false;
        }
        break;
      case Kind::kNumber:
        if (!(x->as_number() == y->as_number())) {
          return false;
        }
        break;
      case Kind::kString:
        if (x->as_string() != y->as_string()) {
          return false;
        }
        break;
      case Kind::kArray: {
        const Array& l = x->as_array();
        const Array& r = y->as_array();
        if (l.size() != r.size()) {
          return false;
        }
        for (std::size_t i = 0; i < l.size(); ++i) {
          work.emplace_back(&l[i], &r[i]);
        }
        break;
      }
      case Kind::kObject: {
        const Object& l = x->as_object();
        const Object& r = y->as_object();
        if (l.size() != r.size()) {
          return false;
        }
        for (const Member *p = l.begin(), *q = r.begin(); p != l.end(); ++p, ++q) {
          if (p->key != q->key) {
            return false;
          }
          work.emplace_back(&p->value, &q->value);
        }
        break;
      }
    }
  }
  return true;
}

}  // namespace cantus::json
