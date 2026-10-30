#include "ops/callbacks.h"

#include <string>
#include <string_view>

#include "js/number.h"
#include "ops/codec.h"
#include "ops/error_map.h"

namespace cantus::ops {

json::Value CallContext::invoke(std::uint32_t id, const json::Array& args) const {
  if (fn_ == nullptr) {
    throw RequestError("callback arguments need a host callback function");
  }
  std::string payload = "[";
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (i > 0) {
      payload.push_back(',');
    }
    ops::stringify_to(args[i], payload);
  }
  payload.push_back(']');
  char* out = nullptr;
  std::size_t out_len = 0;
  std::int32_t status = fn_(ctx_, id, payload.data(), payload.size(), &out, &out_len);
  if (status != 0) {
    throw HostCallbackError("callback " + js::to_string(id) + " failed");
  }
  if (out == nullptr || out_len == 0) {
    return undefined_value();
  }
  json::Value result;
  try {
    result = json::parse(std::string_view(out, out_len));
  } catch (const json::ParseError& e) {
    throw RequestError(std::string("invalid callback result JSON: ") + e.what());
  }
  decode_host_value(result, true);
  return result;
}

}  // namespace cantus::ops
