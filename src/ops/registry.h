/**
 * @file registry.h
 * @brief The op registry: op name to adapter.
 *
 * Adapters are registered from the register_<group>() functions (see register_all.h), which run
 * once, on first use; afterwards the registry is read-only and safe to share between threads.
 *
 * @code
 * def("detectChord", [](Args& a) -> json::Value { ... });
 * def_method<RngHandle>("Rng#next", [](RngHandle& self, Args& a) -> json::Value { ... });
 * @endcode
 */
#ifndef CANTUS_SRC_OPS_REGISTRY_H_
#define CANTUS_SRC_OPS_REGISTRY_H_

#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "json/json.h"
#include "ops/args.h"

namespace cantus::ops {

/** An op adapter: wire arguments in, wire result out. */
using OpFn = std::function<json::Value(Args&)>;

/** What an op needs from its caller. */
enum OpFlags : unsigned {
  kNoFlags = 0,
  /** Takes `$cb` arguments; ops::call() and the CLI refuse it. */
  kCallbacks = 1U << 0,
  /** Creates or reads handles, which do not outlive the process; the CLI refuses it. */
  kHandles = 1U << 1,
};

/** One registered op. */
struct OpEntry {
  OpFn fn;
  unsigned flags = kNoFlags;
};

/**
 * Register op `name`. Only valid inside a register_<group>() function.
 * @throws std::logic_error on a duplicate name or a call after registration finished.
 */
void def(std::string name, OpFn fn, unsigned flags = kNoFlags);

/**
 * Register a handle method `Type#method`: argument 0 is resolved to `T&` before `fn` runs.
 * T derives from Handle and names its type with `static constexpr const char* kTypeName`.
 */
template <class T, class F>
void def_method(std::string name, F fn, unsigned flags = kNoFlags) {
  def(
      std::move(name),
      [fn = std::move(fn)](Args& a) -> json::Value {
        std::shared_ptr<T> self = a.handle<T>(0);
        return fn(*self, a);
      },
      flags | kHandles);
}

/**
 * Decode the model-class values (`$class`) found anywhere in a call's arguments through their
 * `Class.fromData`, innermost first, so an instance that fails its own checks is refused before an
 * op reads it. Defined with the class codecs (ops/codec_m1.cpp and the groups after it).
 */
void decode_class_arguments(const json::Array& args);

/**
 * Register a method of a value class `Type#member` (or a factory `Type.member`): its instance
 * arrives as a `$class` value, not a handle, so the op carries no kHandles flag and the CLI runs
 * it. Use def_method for a handle type, def for a free function.
 */
inline void def_class_method(std::string name, OpFn fn, unsigned flags = kNoFlags) {
  def(
      std::move(name),
      [fn = std::move(fn)](Args& a) -> json::Value {
        decode_class_arguments(a.values());
        return fn(a);
      },
      flags);
}

/** The op called `name`, or nullptr. */
const OpEntry* find_op(std::string_view name);

/** Every op, sorted by name. */
std::vector<std::pair<std::string, const OpEntry*>> list_ops();

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_REGISTRY_H_
