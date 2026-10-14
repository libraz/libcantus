#include "ops/dispatch.h"

#include <string>
#include <utility>

#include "js/format.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/error_map.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

constexpr char kNoCallbacks[] = "callback arguments need a host callback function";

json::Value parse_args(std::string_view args_json) {
  if (args_json.empty()) {
    return json::Value(json::Array());
  }
  try {
    return json::parse(args_json);
  } catch (const json::ParseError& e) {
    throw RequestError(std::string("invalid args JSON: ") + e.what());
  }
}

}  // namespace

Result dispatch(std::string_view op, std::string_view args_json,
                const CallContext& context) noexcept {
  try {
    const OpEntry* entry = find_op(op);
    if (entry == nullptr) {
      throw RequestError(ErrorCode::kUnknownOp, "unknown op " + js::quote(op));
    }
    if ((entry->flags & kCallbacks) != 0 && !context.has_callbacks()) {
      throw RequestError(kNoCallbacks);
    }
    json::Value args = parse_args(args_json);
    if (!args.is_array()) {
      throw RequestError("args must be a JSON array");
    }
    if (validate(args).callbacks > 0 && !context.has_callbacks()) {
      throw RequestError(kNoCallbacks);
    }
    Args a(args.as_array(), context);
    OptionViews views;
    json::Value result = entry->fn(a);
    return Result{CANTUS_OK, ops::stringify(result)};
  } catch (...) {
    ErrorReply reply = map_current_exception();
    return Result{reply.status, std::move(reply.json)};
  }
}

Result call(std::string_view op, std::string_view args_json) noexcept {
  return dispatch(op, args_json, CallContext());
}

}  // namespace cantus::ops
