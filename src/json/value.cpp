#include <cstdint>

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

void Object::set(std::string key, Value value) {
  std::ptrdiff_t existing = index_of(key);
  if (existing >= 0) {
    members_[static_cast<std::size_t>(existing)].value = std::move(value);
    return;
  }
  std::size_t pos = members_.size();
  std::uint32_t n = 0;
  if (array_index(key, n)) {
    // Index keys form a sorted prefix; insert before the first larger index or first string key.
    pos = 0;
    std::uint32_t m = 0;
    while (pos < members_.size() && array_index(members_[pos].key, m) && m < n) {
      ++pos;
    }
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
Value::Value(const Value& other) = default;
Value::Value(Value&& other) noexcept = default;
Value& Value::operator=(const Value& other) = default;
Value& Value::operator=(Value&& other) noexcept = default;
Value::~Value() = default;

bool operator==(const Value& a, const Value& b) { return a.data_ == b.data_; }

}  // namespace cantus::json
