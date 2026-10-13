#include <catch2/catch_test_macros.hpp>
#include <cmath>

#include "js/format.h"
#include "js/value.h"
#include "json/json.h"

namespace js = cantus::js;
namespace json = cantus::json;

TEST_CASE("type_of matches typeof", "[value]") {
  CHECK(js::type_of(json::Value(nullptr)) == "object");
  CHECK(js::type_of(json::Value(true)) == "boolean");
  CHECK(js::type_of(json::Value(7)) == "number");
  CHECK(js::type_of(json::Value("x")) == "string");
  CHECK(js::type_of(json::parse("[]")) == "object");
  CHECK(js::type_of(json::parse("{}")) == "object");
  CHECK(js::type_of(json::parse(R"({"$n":"NaN"})")) == "number");
  CHECK(js::type_of(json::parse(R"({"$u":1})")) == "undefined");
  CHECK(js::type_of(json::parse(R"({"$big":"1"})")) == "bigint");
  CHECK(js::type_of(json::parse(R"({"$sym":"s"})")) == "symbol");
  CHECK(js::type_of(json::parse(R"({"$cb":1})")) == "function");
}

TEST_CASE("truthy matches JS truthiness", "[value]") {
  CHECK_FALSE(js::truthy(json::Value(nullptr)));
  CHECK_FALSE(js::truthy(json::Value(false)));
  CHECK_FALSE(js::truthy(json::Value(0)));
  CHECK_FALSE(js::truthy(json::Value("")));
  CHECK_FALSE(js::truthy(json::parse(R"({"$u":1})")));
  CHECK_FALSE(js::truthy(json::parse(R"({"$n":"NaN"})")));
  CHECK_FALSE(js::truthy(json::parse(R"({"$n":"-0"})")));
  CHECK_FALSE(js::truthy(json::parse(R"({"$big":"0"})")));
  CHECK(js::truthy(json::parse(R"({"$n":"-Infinity"})")));
  CHECK(js::truthy(json::parse(R"({"$big":"5"})")));
  CHECK(js::truthy(json::parse("[]")));
  CHECK(js::truthy(json::parse("{}")));
  CHECK(js::truthy(json::Value("0")));
}

TEST_CASE("to_number matches ToNumber", "[value]") {
  CHECK(js::to_number(json::Value(nullptr)) == 0);
  CHECK(js::to_number(json::Value(true)) == 1);
  CHECK(js::to_number(json::Value(" 12 ")) == 12);
  CHECK(std::isnan(js::to_number(json::Value("x"))));
  CHECK(js::to_number(json::parse("[]")) == 0);
  CHECK(js::to_number(json::parse("[5]")) == 5);
  CHECK(std::isinf(js::to_number(json::parse(R"({"$n":"Infinity"})"))));
  CHECK(std::signbit(js::to_number(json::parse(R"({"$n":"-0"})"))));
  CHECK(js::to_number(json::parse(R"({"$big":"10"})")) == 10);
  CHECK(js::to_number(json::parse(R"({"$tojson":1,"$repr":"3"})")) == 3);
  CHECK(std::isnan(js::to_number(json::parse(R"({"$u":1})"))));
  CHECK(std::isnan(js::to_number(json::parse("{}"))));
  CHECK_THROWS_AS(js::to_number(json::parse(R"({"$sym":"s"})")), js::TypeError);
}
