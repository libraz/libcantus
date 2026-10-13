/**
 * @file addon.cpp
 * @brief Node-API addon: the C ABI (cantus_c.h) as `call`, `release`, `version` and `listOps`.
 *
 * Every call runs synchronously on the JS thread. A `$cb` argument reaches the host function
 * passed to `call` through a C trampoline, which calls back into JS on the same thread, so a
 * callback may re-enter `call`. Strings go in as WTF-8 (a lone surrogate keeps its code unit) and
 * come back as UTF-8: the core escapes lone surrogates as `\udXXX` in everything it writes.
 */
#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "cantus/cantus_c.h"

namespace {

/** Frees a buffer the C ABI returned. */
struct CantusFree {
  void operator()(char* p) const noexcept { cantus_free(p); }
};
using CantusBuffer = std::unique_ptr<char, CantusFree>;

/** Appends code point @p cp (a lone surrogate included) to @p out as WTF-8. */
void AppendWtf8(std::string& out, uint32_t cp) {
  if (cp < 0x80) {
    out.push_back(static_cast<char>(cp));
  } else if (cp < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  }
}

/** The WTF-8 bytes of a JS string; length-delimited, so an embedded NUL survives. */
std::string ToWtf8(const Napi::String& value) {
  napi_env env = value.Env();
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok) {
    throw Napi::Error::New(env);
  }
  std::vector<char16_t> units(length + 1);
  if (napi_get_value_string_utf16(env, value, units.data(), units.size(), &length) != napi_ok) {
    throw Napi::Error::New(env);
  }
  std::string out;
  out.reserve(length);
  for (size_t i = 0; i < length; ++i) {
    uint32_t unit = units[i];
    if (unit >= 0xD800 && unit <= 0xDBFF && i + 1 < length && units[i + 1] >= 0xDC00 &&
        units[i + 1] <= 0xDFFF) {
      unit = 0x10000 + ((unit - 0xD800) << 10) + (units[i + 1] - 0xDC00);
      ++i;
    }
    AppendWtf8(out, unit);
  }
  return out;
}

Napi::String StringArgument(const Napi::CallbackInfo& info, size_t index, const char* name) {
  if (!info[index].IsString()) {
    throw Napi::TypeError::New(info.Env(), std::string(name) + " must be a string");
  }
  return info[index].As<Napi::String>();
}

/** One `call` and its host function, as the trampoline sees them. */
struct CallFrame {
  Napi::Env env;
  Napi::Function host;
  /** Callback results; the core reads them until cantus_call returns. A deque never moves them. */
  std::deque<std::string> replies;
  /** What the host function threw, rethrown once cantus_call returns. */
  std::optional<Napi::Error> error;
};

/**
 * CantusCallbackFn over the host function `(id, argsJson) => string | undefined`.
 *
 * A string is the callback's wire result; anything else, or a throw, reports failure, which the
 * core turns into CANTUS_CALLBACK_FAILED.
 */
int32_t Trampoline(void* ctx, uint32_t callback_id, const char* args_json, size_t args_len,
                   char** out_json, size_t* out_len) {
  auto* frame = static_cast<CallFrame*>(ctx);
  *out_json = nullptr;
  *out_len = 0;
  try {
    Napi::HandleScope scope(frame->env);
    Napi::Value result = frame->host.Call({Napi::Number::New(frame->env, callback_id),
                                           Napi::String::New(frame->env, args_json, args_len)});
    if (!result.IsString()) return 1;
    std::string& reply = frame->replies.emplace_back(ToWtf8(result.As<Napi::String>()));
    *out_json = reply.data();
    *out_len = reply.size();
    return 0;
  } catch (const Napi::Error& error) {
    if (!frame->error) frame->error.emplace(error);
    return 1;
  } catch (...) {
    return 1;
  }
}

/** `call(op, argsJson, host | null)` → `{status, json}`. */
Napi::Value Call(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const std::string op = ToWtf8(StringArgument(info, 0, "op"));
  const std::string args = ToWtf8(StringArgument(info, 1, "argsJson"));
  const bool has_host = info[2].IsFunction();
  if (!has_host && !info[2].IsNull() && !info[2].IsUndefined()) {
    throw Napi::TypeError::New(env, "cb must be a function or null");
  }
  CallFrame frame{env, has_host ? info[2].As<Napi::Function>() : Napi::Function(), {}, {}};

  char* out = nullptr;
  size_t out_len = 0;
  const CantusStatus status =
      cantus_call(op.data(), op.size(), args.data(), args.size(), has_host ? Trampoline : nullptr,
                  has_host ? &frame : nullptr, &out, &out_len);
  CantusBuffer owned(out);
  if (frame.error) throw *frame.error;

  Napi::Object reply = Napi::Object::New(env);
  reply.Set("status", Napi::Number::New(env, status));
  reply.Set("json", Napi::String::New(env, out != nullptr ? out : "", out_len));
  return reply;
}

/** `release(handle)`; ids that are not a handle the core issued are ignored, as the C ABI does. */
Napi::Value Release(const Napi::CallbackInfo& info) {
  if (!info[0].IsNumber()) throw Napi::TypeError::New(info.Env(), "handle must be a number");
  const double id = info[0].As<Napi::Number>().DoubleValue();
  if (id >= 0 && id <= 9007199254740991.0 && id == static_cast<double>(static_cast<uint64_t>(id))) {
    cantus_release(static_cast<uint64_t>(id));
  }
  return info.Env().Undefined();
}

/** `version()` → `{version, algorithmVersion, abiVersion}`, the shape of the `$version` op. */
Napi::Value Version(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("version", Napi::String::New(env, cantus_version()));
  out.Set("algorithmVersion", Napi::Number::New(env, cantus_algorithm_version()));
  out.Set("abiVersion", Napi::Number::New(env, cantus_abi_version()));
  return out;
}

/** `listOps()` → the JSON text of cantus_list_ops(). */
Napi::Value ListOps(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  char* out = nullptr;
  size_t out_len = 0;
  const CantusStatus status = cantus_list_ops(&out, &out_len);
  CantusBuffer owned(out);
  if (status != CANTUS_OK) throw Napi::Error::New(env, "cantus_list_ops failed");
  return Napi::String::New(env, out, out_len);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  if (cantus_abi_version() != CANTUS_ABI_VERSION) {
    throw Napi::Error::New(env, "libcantus reports ABI version " +
                                    std::to_string(cantus_abi_version()) + ", expected " +
                                    std::to_string(CANTUS_ABI_VERSION));
  }
  exports.Set("call", Napi::Function::New(env, Call, "call"));
  exports.Set("release", Napi::Function::New(env, Release, "release"));
  exports.Set("version", Napi::Function::New(env, Version, "version"));
  exports.Set("listOps", Napi::Function::New(env, ListOps, "listOps"));
  return exports;
}

}  // namespace

NODE_API_MODULE(cantus_node, Init)
