// Nesting depth up to json::kMaxDepth costs heap, not native stack, through the whole call:
// parse, tag validation, class decoding, the op, writing the result and destruction.

#include <pthread.h>

#include <catch2/catch_test_macros.hpp>
#include <cstddef>
#include <string>

#include "cantus/cantus_c.h"
#include "json/json.h"

namespace {

/** A stack well below every platform's default secondary-thread stack (512 KB on macOS). */
constexpr std::size_t kSmallStack = 256 * 1024;

/** Nesting the parser accepts, with room for the args array around it. */
constexpr std::size_t kDeep = 4090;

struct Reply {
  CantusStatus status = CANTUS_INTERNAL;
  std::string json;
};

struct Request {
  std::string op;
  std::string args;
  Reply reply;
};

void* run_call(void* arg) {
  auto* request = static_cast<Request*>(arg);
  char* out = nullptr;
  std::size_t out_len = 0;
  request->reply.status = cantus_call(request->op.data(), request->op.size(), request->args.data(),
                                      request->args.size(), nullptr, nullptr, &out, &out_len);
  request->reply.json.assign(out, out_len);
  cantus_free(out);
  return nullptr;
}

/** cantus_call on a fresh thread with a kSmallStack stack. */
Reply call_on_small_stack(const std::string& op, const std::string& args) {
  Request request{op, args, {}};
  pthread_attr_t attr;
  REQUIRE(pthread_attr_init(&attr) == 0);
  REQUIRE(pthread_attr_setstacksize(&attr, kSmallStack) == 0);
  pthread_t thread;
  REQUIRE(pthread_create(&thread, &attr, run_call, &request) == 0);
  REQUIRE(pthread_join(thread, nullptr) == 0);
  pthread_attr_destroy(&attr);
  return request.reply;
}

std::string nested_arrays(std::size_t depth) {
  return std::string(depth, '[') + "1" + std::string(depth, ']');
}

std::string nested_objects(std::size_t depth) {
  std::string out;
  for (std::size_t i = 0; i < depth; ++i) {
    out += R"({"a":)";
  }
  out += "1";
  out += std::string(depth, '}');
  return out;
}

std::string message_of(const Reply& reply) {
  cantus::json::Value parsed = cantus::json::parse(reply.json);
  const cantus::json::Value* message = parsed.as_object().find("message");
  REQUIRE(message != nullptr);
  return message->as_string();
}

}  // namespace

TEST_CASE("a deep array argument and result fit a small thread stack", "[depth]") {
  std::string deep = nested_arrays(kDeep);
  Reply reply = call_on_small_stack("$echo", "[" + deep + "]");
  CHECK(reply.status == CANTUS_OK);
  CHECK(reply.json == deep);
}

TEST_CASE("a deep object argument and result fit a small thread stack", "[depth]") {
  std::string deep = nested_objects(kDeep);
  Reply reply = call_on_small_stack("$echo", "[" + deep + "]");
  CHECK(reply.status == CANTUS_OK);
  CHECK(reply.json == deep);
}

TEST_CASE("an API op decodes deep arguments on a small thread stack", "[depth]") {
  // Class decoding walks every argument before the op runs; the op then refuses the chord.
  std::string chord = R"({"rootPc":0,"deep":)" + nested_objects(kDeep - 2) + "}";
  Reply reply = call_on_small_stack("toChordData", "[" + chord + "]");
  CHECK(reply.status == CANTUS_INVALID_INPUT);
  CHECK(message_of(reply) == "chord.intervals must be an array of semitone offsets");

  std::string listed = R"({"rootPc":0,"deep":)" + nested_arrays(kDeep - 2) + "}";
  reply = call_on_small_stack("toChordData", "[" + listed + "]");
  CHECK(reply.status == CANTUS_INVALID_INPUT);
}

TEST_CASE("an error message naming a deep array fits a small thread stack", "[depth]") {
  // `${value}` joins nested arrays: the message reads the innermost element.
  Reply reply = call_on_small_stack("roleOf", "[" + nested_arrays(kDeep) + R"(,"C"])");
  CHECK(reply.status == CANTUS_INVALID_INPUT);
  CHECK(message_of(reply) == "pitch must be finite; received 1");
}

TEST_CASE("nesting past the limit is refused, not followed", "[depth]") {
  Reply reply = call_on_small_stack("$echo", "[" + nested_arrays(cantus::json::kMaxDepth) + "]");
  CHECK(reply.status == CANTUS_BAD_REQUEST);
}
