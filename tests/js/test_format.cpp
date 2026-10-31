#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <stdexcept>
#include <string>

#include "js/format.h"
#include "js/utf16.h"
#include "json/json.h"

namespace js = cantus::js;
namespace json = cantus::json;

TEST_CASE("quote matches JSON.stringify of a string", "[format]") {
  CHECK(
      js::quote(std::string("\0\x1f\x7f", 3) + "\xED\xA0\x80x\xED\xB0\x80 \xF0\x9F\x98\x80\"\\/") ==
      "\"\\u0000\\u001f\x7f\\ud800x\\udc00 \xF0\x9F\x98\x80\\\"\\\\/\"");
  CHECK(js::quote("") == "\"\"");
}

TEST_CASE("template_string matches a template literal", "[format]") {
  json::Value v = json::parse(
      R"([1,null,{"$u":1},"a",[2,[3,null]],{},{"$n":"-0"},{"$n":"NaN"},{"$big":"10"},1e21,true])");
  CHECK(js::template_string(v) == "1,,,a,2,3,,[object Object],0,NaN,10,1e+21,true");
  CHECK(js::template_string(json::Value(nullptr)) == "null");
  CHECK(js::template_string(json::parse(R"({"$u":1})")) == "undefined");
  CHECK(js::template_string(json::parse(R"({"$n":"-Infinity"})")) == "-Infinity");
  CHECK(js::template_string(json::parse(R"({"$tojson":3,"$repr":"custom"})")) == "custom");
  CHECK(js::template_string(json::Value(-0.0)) == "0");
  CHECK(js::template_string(json::Value("5")) == "5");
  CHECK(js::template_string(json::parse("[]")) == "");
  CHECK(js::template_string(json::parse(R"({"$$n":"NaN"})")) == "[object Object]");
  CHECK_THROWS_AS(js::template_string(json::parse(R"({"$sym":"s"})")), js::TypeError);
  CHECK_THROWS_AS(js::template_string(json::parse(R"([1,{"$sym":"s"}])")), js::TypeError);
  CHECK_THROWS_AS(js::template_string(json::parse(R"({"$cb":1})")), std::invalid_argument);
  try {
    js::template_string(json::parse(R"({"$sym":"s"})"));
  } catch (const js::TypeError& e) {
    CHECK(std::string(e.what()) == "Cannot convert a Symbol value to a string");
  }
}

TEST_CASE("utf16 helpers count and order by code unit", "[utf16]") {
  const std::string emoji = "\xF0\x9F\x98\x80";
  const std::string halfwidth = "\xEF\xBD\xA1";  // U+FF61
  CHECK(js::utf16_length("a" + emoji + "b") == 4);
  CHECK(js::utf16_length("\xC3\xA9\xE2\x82\xAC") == 2);
  CHECK(js::utf16_compare(emoji, halfwidth) < 0);
  CHECK(js::utf16_compare(halfwidth, emoji) > 0);
  CHECK(js::utf16_compare("abc", "abc") == 0);
  CHECK(js::utf16_compare("ab", "abc") < 0);
  CHECK(js::utf16_slice("abc", -2) == "bc");
  CHECK(js::utf16_slice("abc", 2, 1) == "");
  CHECK(js::utf16_slice("abc", 0, 1e9) == "abc");
  CHECK(js::utf16_slice("abc", -1e9, std::nan("")) == "");
  CHECK(js::utf16_slice("a" + emoji + "b", 1, 2) == "\xED\xA0\xBD");
  CHECK(js::utf16_slice("a" + emoji + "b", 2) ==
        "\xED\xB8\x80"
        "b");
  CHECK(js::utf16_slice("a" + emoji + "b", 1, 3) == emoji);
  CHECK(js::to_utf16("a" + emoji) == std::u16string{u'a', 0xD83D, 0xDE00});
  CHECK(js::from_utf16(std::u16string{0xD83D, 0xDE00, 0xDC00}) == emoji + "\xED\xB0\x80");
  std::size_t units = 0;
  js::for_each_utf16_unit(emoji + "x", [&](char16_t) { ++units; });
  CHECK(units == 3);
}
