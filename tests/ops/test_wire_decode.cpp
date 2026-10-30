// Decoding of model-class values at the boundary, as the TS wire backend decodes every argument of
// an API op: hand-built payloads the JS facade never sends.

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <string>

#include "cantus/cantus_c.h"
#include "cantus/ops.h"
#include "json/json.h"
#include "ops/handles.h"

namespace {

using cantus::ops::call;
using cantus::ops::Result;

std::string field(const Result& r, const char* key) {
  cantus::json::Value parsed = cantus::json::parse(r.json);
  const cantus::json::Value* v = parsed.as_object().find(key);
  REQUIRE(v != nullptr);
  return v->is_string() ? v->as_string() : cantus::json::stringify(*v);
}

/** A host whose every callback answers with the text `ctx` points to. */
int32_t answer(void* ctx, uint32_t, const char*, size_t, char** out, size_t* out_len) {
  auto* text = static_cast<std::string*>(ctx);
  *out = text->data();
  *out_len = text->size();
  return 0;
}

/** cantus_call() of `op` with a host answering `reply` to every callback. */
Result call_answered(const std::string& op, const std::string& args, std::string reply) {
  char* out = nullptr;
  size_t out_len = 0;
  CantusStatus status =
      cantus_call(op.data(), op.size(), args.data(), args.size(), answer, &reply, &out, &out_len);
  Result r{status, std::string(out, out_len)};
  cantus_free(out);
  return r;
}

}  // namespace

TEST_CASE("an unknown class name in an API op's arguments is BAD_REQUEST", "[decode]") {
  Result r =
      call("chordSpecOf", R"([{"$class":"x","rootPc":0,"quality":"maj","intervals":[0,4,7]}])");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(field(r, "message") == R"(unknown class "x")");

  r = call("chordSpecOf", R"([{"$class":"","rootPc":0,"quality":"maj","intervals":[0,4,7]}])");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(field(r, "message") == R"(unknown class "")");

  r = call("Interval.between", R"([{"$class":"x","letter":0,"alter":0,"octave":4},)"
                               R"({"$class":"Note","letter":2,"alter":0,"octave":4}])");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(field(r, "message") == R"(unknown class "x")");

  r = call("Timeline.fromProgression", "[[{\"$class\":\"\xF0\x9F\x98\x80\"}]]");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(field(r, "message") == "unknown class \"\xF0\x9F\x98\x80\"");
}

TEST_CASE("a free function's class arguments are checked by their own class", "[decode]") {
  Result r =
      call("chordToRoman", R"([{"rootPc":7,"quality":"dom7","intervals":[0,4,7,10]},)"
                           R"({"$class":"Key","tonic":"x","scale":{"rootPc":0,"modeMask12":2741},)"
                           R"("variant":"major"}])");
  CHECK(r.status == CANTUS_INVALID_INPUT);
  CHECK(field(r, "message") == "note data must be an object; received string");
}

TEST_CASE("class values are decoded innermost first", "[decode]") {
  Result r =
      call("toChordData", R"([{"rootPc":0,"x":[{"$class":"outer","in":{"$class":"inner"}}]}])");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(field(r, "message") == R"(unknown class "inner")");
}

TEST_CASE("builtin probes take class values in wire form", "[decode]") {
  Result r = call("$echo", R"([{"$class":"x","a":1}])");
  CHECK(r.status == CANTUS_OK);
  CHECK(r.json == R"({"$class":"x","a":1})");
}

TEST_CASE("a callback result holding a $ref reaches the op as the value it names", "[decode]") {
  const std::string chord = R"({"$class":"Chord","rootPc":2,"quality":"min","intervals":[0,3,7]})";
  Result retained = call("$retain", "[" + chord + "]");
  REQUIRE(retained.status == CANTUS_OK);
  auto id = static_cast<std::uint64_t>(
      cantus::json::parse(retained.json).as_object().find("$ref")->as_number());

  Result echoed = call_answered("$call", R"([{"$cb":0}])", retained.json);
  CHECK(echoed.status == CANTUS_OK);
  CHECK(echoed.json == chord);
  Result nested = call_answered("$call", R"([{"$cb":0}])", R"({"in":[)" + retained.json + "]}");
  CHECK(nested.json == R"({"in":[)" + chord + "]}");

  // An op reading the result sees the same chord as the plain value gives it.
  const std::string line = R"([[{"pitch":66,"startBeat":0,"durationBeat":1}],{"at":{"$cb":0}},)"
                           R"({"rootPc":0,"modeMask12":2741}])";
  Result by_ref = call_answered("spellLine", line, retained.json);
  CHECK(by_ref.status == CANTUS_OK);
  CHECK(by_ref.json == call_answered("spellLine", line, chord).json);

  cantus::ops::release_handle(id);
  Result released = call_answered("$call", R"([{"$cb":0}])", retained.json);
  CHECK(released.status == CANTUS_RELEASED_HANDLE);
  CHECK(field(released, "message") == "Chord handle " + std::to_string(id) + " has been released");
}
