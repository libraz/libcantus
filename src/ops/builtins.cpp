// Builtin ops: fixed-behaviour probes of the boundary itself (tags, errors, handles, callbacks,
// reentrancy). They are not part of the TS API and are exercised by tests/corpus/fixtures.

#include <cmath>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>

#include "cantus/cantus_c.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/version.h"
#include "js/format.h"
#include "ops/codec.h"
#include "ops/error_map.h"
#include "ops/handles.h"
#include "ops/register_all.h"
#include "ops/registry.h"

namespace cantus::ops {

namespace {

constexpr double kMaxSafeInteger = 9007199254740991.0;

/** `$counter`: a mutable handle with an identity-tagged getter. */
class Counter : public Handle {
 public:
  static constexpr const char* kTypeName = "$counter";

  explicit Counter(double start) : count_(start) {}

  double next() {
    count_ += 1;
    identity_.invalidate();
    return count_;
  }

  json::Value value() {
    json::Object data;
    data.set("count", count_);
    return with_identity(identity_, data);
  }

 private:
  double count_;
  Identity identity_;
};

const std::string& string_field(const json::Object& o, const char* key) {
  const json::Value* v = o.find(key);
  if (v == nullptr || !v->is_string()) {
    throw RequestError(std::string("$throw needs a string \"") + key + "\"");
  }
  return v->as_string();
}

[[noreturn]] void throw_requested(const json::Value& spec) {
  if (!spec.is_object()) {
    throw RequestError("$throw needs {code, message, at?}");
  }
  const json::Object& o = spec.as_object();
  const std::string& name = string_field(o, "code");
  const std::string& message = string_field(o, "message");
  std::optional<ErrorCode> code = parse_error_code(name);
  if (!code) {
    throw RequestError("$throw: unknown error code " + js::quote(name));
  }
  const json::Value* at = o.find("at");
  if (at != nullptr && *code != ErrorCode::kNoSolution) {
    throw RequestError("$throw: only NO_SOLUTION carries \"at\"");
  }
  switch (*code) {
    case ErrorCode::kInvalidInput:
      throw InvalidInputError(message);
    case ErrorCode::kNoSolution: {
      if (at == nullptr) {
        throw NoSolutionError(message);
      }
      if (!at->is_number() || !(at->as_number() >= 0) || at->as_number() > kMaxSafeInteger ||
          std::floor(at->as_number()) != at->as_number()) {
        throw RequestError("$throw: \"at\" must be a non-negative integer");
      }
      throw NoSolutionError(message, at->as_number());
    }
    case ErrorCode::kBudgetExceeded:
      throw BudgetExceededError(message);
    case ErrorCode::kHostTypeError:
      throw HostTypeError(message);
    case ErrorCode::kUnknownOp:
    case ErrorCode::kBadRequest:
      throw RequestError(*code, message);
    case ErrorCode::kCallbackFailed:
      throw HostCallbackError(message);
    case ErrorCode::kReleasedHandle:
      throw ReleasedHandleError(message);
    case ErrorCode::kInternal:
      // Any exception outside the coded taxonomy is reported as INTERNAL.
      throw std::runtime_error(message);
  }
  throw RequestError("$throw: unknown error code " + js::quote(name));
}

}  // namespace

void register_builtins() {
  def("$echo", [](Args& a) -> json::Value { return a.take(0); });

  def("$throw", [](Args& a) -> json::Value { throw_requested(a[0]); });

  def(
      "$counter",
      [](Args& a) -> json::Value {
        double start = 0;
        if (!a.undefined(0)) {
          std::optional<double> n = number_of(a[0]);
          if (!n) {
            throw RequestError("$counter: start must be a number");
          }
          start = *n;
        }
        return new_handle(std::make_shared<Counter>(start));
      },
      kHandles);

  def_method<Counter>("$counter#next",
                      [](Counter& self, Args&) -> json::Value { return self.next(); });

  def_method<Counter>("$counter#value",
                      [](Counter& self, Args&) -> json::Value { return self.value(); });

  def(
      "$call",
      [](Args& a) -> json::Value {
        Callback cb = a.callback(0);
        json::Array rest;
        for (std::size_t i = 1; i < a.size(); ++i) {
          rest.push_back(a.take(i));
        }
        return cb(rest);
      },
      kCallbacks);

  def("$live", [](Args&) -> json::Value { return static_cast<double>(live_handles()); });

  def("$version", [](Args&) -> json::Value {
    json::Object o;
    o.set("version", version());
    o.set("algorithmVersion", static_cast<double>(ALGORITHM_VERSION));
    o.set("abiVersion", static_cast<double>(CANTUS_ABI_VERSION));
    return json::Value(std::move(o));
  });
}

}  // namespace cantus::ops
