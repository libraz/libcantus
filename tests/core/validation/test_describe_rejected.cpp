#include <catch2/catch_test_macros.hpp>
#include <string>

#include "core/validation/validation.h"
#include "json/json.h"

using namespace cantus;

TEST_CASE("describe_rejected matches describeRejected", "[validation]") {
  CHECK(describe_rejected(json::Value(nullptr)) == "null");
  CHECK(describe_rejected(json::Value("x")) == "\"x\"");
  CHECK(describe_rejected(json::Value(true)) == "boolean");
  CHECK(describe_rejected(json::Value(7)) == "number");
  CHECK(describe_rejected(json::parse("[]")) == "object");
  CHECK(describe_rejected(json::parse("{}")) == "object");
  CHECK(describe_rejected(json::parse(R"({"$n":"NaN"})")) == "number");
  CHECK(describe_rejected(json::parse(R"({"$u":1})")) == "undefined");
  CHECK(describe_rejected(json::parse(R"({"$big":"1"})")) == "bigint");
  CHECK(describe_rejected(json::parse(R"({"$sym":"s"})")) == "symbol");
  CHECK(describe_rejected(json::parse(R"({"$cb":1})")) == "function");
  CHECK(describe_rejected(json::parse(R"({"$class":"Chord"})")) == "object");

  std::string exact(64, 'a');
  CHECK(describe_rejected(json::Value(exact)) == "\"" + exact + "\"");
  CHECK(describe_rejected(json::Value(std::string(65, 'b'))) ==
        "\"" + std::string(64, 'b') + "\" (truncated from 65 characters)");
  // 63 'a' + U+1F600 + 'b' is 66 code units; the cut at 64 leaves a lone high surrogate.
  CHECK(describe_rejected(json::Value(std::string(63, 'a') + "\xF0\x9F\x98\x80" + "b")) ==
        "\"" + std::string(63, 'a') + "\\ud83d\" (truncated from 66 characters)");
  // 64 code units including a pair is not truncated.
  CHECK(describe_rejected(json::Value(std::string(62, 'a') + "\xF0\x9F\x98\x80")) ==
        "\"" + std::string(62, 'a') + "\xF0\x9F\x98\x80\"");
}
