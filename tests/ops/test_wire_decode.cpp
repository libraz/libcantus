// Decoding of model-class values at the boundary, as the TS wire backend decodes every argument of
// an API op: hand-built payloads the JS facade never sends.

#include <catch2/catch_test_macros.hpp>
#include <string>

#include "cantus/cantus_c.h"
#include "cantus/ops.h"
#include "json/json.h"

namespace {

using cantus::ops::call;
using cantus::ops::Result;

std::string field(const Result& r, const char* key) {
  cantus::json::Value parsed = cantus::json::parse(r.json);
  const cantus::json::Value* v = parsed.as_object().find(key);
  REQUIRE(v != nullptr);
  return v->is_string() ? v->as_string() : cantus::json::stringify(*v);
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
