// Builtin ops through the in-process entry point ops::call().

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <string_view>

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

TEST_CASE("$echo returns its argument", "[builtins]") {
  CHECK(call("$echo", R"([{"a":[1,"x",null,true]}])").json == R"({"a":[1,"x",null,true]})");
  CHECK(call("$echo", "[]").json == R"({"$u":1})");
  CHECK(call("$echo", "").json == R"({"$u":1})");
  CHECK(call("$echo", R"([1,2])").json == "1");
  CHECK(call("$echo", R"([{"$n":"NaN"}])").json == R"({"$n":"NaN"})");
}

TEST_CASE("$throw raises every error code with its name", "[builtins]") {
  struct Expect {
    const char* code;
    CantusStatus status;
    const char* name;
  };
  const Expect cases[] = {
      {"INVALID_INPUT", CANTUS_INVALID_INPUT, "InvalidInputError"},
      {"NO_SOLUTION", CANTUS_NO_SOLUTION, "NoSolutionError"},
      {"BUDGET_EXCEEDED", CANTUS_BUDGET_EXCEEDED, "BudgetExceededError"},
      {"HOST_TYPE_ERROR", CANTUS_HOST_TYPE_ERROR, "TypeError"},
      {"UNKNOWN_OP", CANTUS_UNKNOWN_OP, "Error"},
      {"BAD_REQUEST", CANTUS_BAD_REQUEST, "Error"},
      {"CALLBACK_FAILED", CANTUS_CALLBACK_FAILED, "Error"},
      {"RELEASED_HANDLE", CANTUS_RELEASED_HANDLE, "Error"},
      {"INTERNAL", CANTUS_INTERNAL, "Error"},
  };
  for (const Expect& e : cases) {
    INFO(e.code);
    Result r = call("$throw", std::string(R"([{"code":")") + e.code + R"(","message":"m \"q\""}])");
    CHECK(r.status == e.status);
    CHECK(r.json == std::string(R"({"code":")") + e.code + R"(","name":")" + e.name +
                        R"(","message":"m \"q\""})");
  }
}

TEST_CASE("$throw carries at for NO_SOLUTION only", "[builtins]") {
  Result r = call("$throw", R"([{"code":"NO_SOLUTION","message":"none","at":3}])");
  CHECK(r.status == CANTUS_NO_SOLUTION);
  CHECK(r.json == R"({"code":"NO_SOLUTION","name":"NoSolutionError","message":"none","at":3})");
  CHECK(call("$throw", R"([{"code":"INVALID_INPUT","message":"x","at":3}])").status ==
        CANTUS_BAD_REQUEST);
  CHECK(call("$throw", R"([{"code":"NO_SOLUTION","message":"x","at":-1}])").status ==
        CANTUS_BAD_REQUEST);
  CHECK(call("$throw", R"([{"code":"NOPE","message":"x"}])").status == CANTUS_BAD_REQUEST);
  CHECK(call("$throw", R"([{"code":"INVALID_INPUT"}])").status == CANTUS_BAD_REQUEST);
  CHECK(call("$throw", "[]").status == CANTUS_BAD_REQUEST);
}

TEST_CASE("$counter is a handle with #next and an identity-tagged #value", "[builtins]") {
  Result h = call("$counter", "[5]");
  REQUIRE(h.ok());
  CHECK(field(h, "$type") == "$counter");
  std::string self = "[" + h.json + "]";
  Result v1 = call("$counter#value", self);
  Result v2 = call("$counter#value", self);
  CHECK(field(v1, "count") == "5");
  CHECK(field(v1, "$id") == field(v2, "$id"));
  CHECK(call("$counter#next", self).json == "6");
  Result v3 = call("$counter#value", self);
  CHECK(field(v3, "count") == "6");
  CHECK(field(v3, "$id") != field(v1, "$id"));
  CHECK(call("$counter", R"(["x"])").status == CANTUS_BAD_REQUEST);
  CHECK(call("$counter#next", "[1]").status == CANTUS_BAD_REQUEST);
}

TEST_CASE("ops::call refuses callbacks", "[builtins]") {
  Result r = call("$call", R"([{"$cb":0}])");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(field(r, "message") == "callback arguments need a host callback function");
  CHECK(call("$echo", R"([{"$cb":0}])").status == CANTUS_BAD_REQUEST);
}

TEST_CASE("$version reports the library, algorithm and ABI versions", "[builtins]") {
  CHECK(call("$version", "[]").json ==
        R"({"version":"1.4.1","algorithmVersion":1,"abiVersion":1})");
}

TEST_CASE("requests that cannot run are BAD_REQUEST or UNKNOWN_OP", "[builtins]") {
  CHECK(call("nope", "[]").status == CANTUS_UNKNOWN_OP);
  CHECK(field(call("nope", "[]"), "message") == R"(unknown op "nope")");
  CHECK(call("$echo", "{}").status == CANTUS_BAD_REQUEST);
  CHECK(call("$echo", "[").status == CANTUS_BAD_REQUEST);
  CHECK(call("$echo", "[1] x").status == CANTUS_BAD_REQUEST);
  CHECK(call("$echo", R"([{"$what":1}])").status == CANTUS_BAD_REQUEST);
}

TEST_CASE("an op name that is not UTF-8 is refused without being read past or echoed",
          "[builtins]") {
  // The views end before the bytes that follow them, so a decoder reading on would show it.
  const std::string padded = "\xff\xe2\x82 tail";
  for (std::string_view op :
       {std::string_view(padded.data(), 1), std::string_view(padded.data() + 1, 2)}) {
    Result r = call(op, "[]");
    CHECK(r.status == CANTUS_BAD_REQUEST);
    CHECK(field(r, "message") == "op name is not valid UTF-8");
  }
}
