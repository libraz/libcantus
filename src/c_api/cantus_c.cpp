#include "cantus/cantus_c.h"

#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>

#include "cantus/core/limits.h"
#include "cantus/version.h"
#include "json/json.h"
#include "ops/callbacks.h"
#include "ops/codec.h"
#include "ops/dispatch.h"
#include "ops/handles.h"
#include "ops/registry.h"

namespace {

/** Copy `s` into a malloc'd, NUL-terminated buffer; false when out of memory. */
bool emit(const std::string& s, char** out_json, size_t* out_len) noexcept {
  auto* p = static_cast<char*>(std::malloc(s.size() + 1));
  if (p == nullptr) {
    return false;
  }
  std::memcpy(p, s.data(), s.size());
  p[s.size()] = '\0';
  *out_json = p;
  *out_len = s.size();
  return true;
}

CantusStatus finish(const cantus::ops::Result& result, char** out_json, size_t* out_len) noexcept {
  return emit(result.json, out_json, out_len) ? result.status : CANTUS_INTERNAL;
}

}  // namespace

extern "C" {

CantusStatus cantus_call(const char* op, size_t op_len, const char* args_json, size_t args_len,
                         CantusCallbackFn cb, void* cb_ctx, char** out_json,
                         size_t* out_len) noexcept {
  if (out_json != nullptr) {
    *out_json = nullptr;
  }
  if (out_len != nullptr) {
    *out_len = 0;
  }
  if (out_json == nullptr || out_len == nullptr) {
    return CANTUS_BAD_REQUEST;
  }
  try {
    if ((op == nullptr && op_len != 0) || (args_json == nullptr && args_len != 0)) {
      return finish(cantus::ops::Result{CANTUS_BAD_REQUEST,
                                        R"({"code":"BAD_REQUEST","name":"Error",)"
                                        R"("message":"null pointer with a nonzero length"})"},
                    out_json, out_len);
    }
    std::string_view op_name(op == nullptr ? "" : op, op_len);
    std::string_view args(args_json == nullptr ? "" : args_json, args_len);
    return finish(cantus::ops::dispatch(op_name, args, cantus::ops::CallContext(cb, cb_ctx)),
                  out_json, out_len);
  } catch (...) {
    return CANTUS_INTERNAL;
  }
}

void cantus_free(char* p) noexcept { std::free(p); }

void cantus_release(uint64_t handle) noexcept { cantus::ops::release_handle(handle); }

const char* cantus_version(void) noexcept { return CANTUS_VERSION_STRING; }

uint32_t cantus_algorithm_version(void) noexcept { return cantus::ALGORITHM_VERSION; }

uint32_t cantus_abi_version(void) noexcept { return CANTUS_ABI_VERSION; }

CantusStatus cantus_list_ops(char** out_json, size_t* out_len) noexcept {
  if (out_json != nullptr) {
    *out_json = nullptr;
  }
  if (out_len != nullptr) {
    *out_len = 0;
  }
  if (out_json == nullptr || out_len == nullptr) {
    return CANTUS_BAD_REQUEST;
  }
  try {
    cantus::json::Array ops;
    for (const auto& [name, entry] : cantus::ops::list_ops()) {
      cantus::json::Object o;
      o.set("name", name);
      o.set("callbacks", (entry->flags & cantus::ops::kCallbacks) != 0);
      o.set("handles", (entry->flags & cantus::ops::kHandles) != 0);
      ops.push_back(cantus::json::Value(std::move(o)));
    }
    return emit(cantus::ops::stringify(cantus::json::Value(std::move(ops))), out_json, out_len)
               ? CANTUS_OK
               : CANTUS_INTERNAL;
  } catch (...) {
    return CANTUS_INTERNAL;
  }
}

}  // extern "C"
