#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <string>
#include <vector>

#include "js/utf16.h"
#include "json/json.h"

namespace json = cantus::json;

namespace {

std::string roundtrip(const std::string& text) { return json::stringify(json::parse(text)); }

std::vector<std::string> keys(const json::Value& v) {
  std::vector<std::string> out;
  for (const json::Member& m : v.as_object()) {
    out.push_back(m.key);
  }
  return out;
}

}  // namespace

TEST_CASE("parse then stringify matches JSON.stringify(JSON.parse(text))", "[json]") {
  const std::string text =
      R"({"z":[1,-0,1e400,-1e400,1e-400,-1e-400,0.1,5e-324,2.2250738585072011e-308,)"
      R"(123456789012345678901234567890,1E2,-0.0e-5],)"
      R"("s":"a\u00e9\u20ac\ud83d\ude00\/\b\f\n\r\t\u0001","n":null,"t":true,"f":false,)"
      R"("o":{"__proto__":{"x":[]}},"e":{},"a":[]})";
  CHECK(roundtrip(text) ==
        "{\"z\":[1,0,null,null,0,0,0.1,5e-324,2.225073858507201e-308,1.2345678901234568e+29,100,"
        "0],\"s\":\"a\xC3\xA9\xE2\x82\xAC\xF0\x9F\x98\x80/\\b\\f\\n\\r\\t\\u0001\",\"n\":null,"
        "\"t\":true,\"f\":false,\"o\":{\"__proto__\":{\"x\":[]}},\"e\":{},\"a\":[]}");
  CHECK(roundtrip(" \t\r\n 7 ") == "7");
  CHECK(roundtrip("\"x\"") == "\"x\"");
}

TEST_CASE("numbers read as JSON.parse reads them", "[json]") {
  json::Value v = json::parse("[1e400,-1e400,1e-400,-1e-400,-0,5e-324,2.4703282292062328e-324]");
  const json::Array& a = v.as_array();
  CHECK(a[0].as_number() == INFINITY);
  CHECK(a[1].as_number() == -INFINITY);
  CHECK((a[2].as_number() == 0 && !std::signbit(a[2].as_number())));
  CHECK((a[3].as_number() == 0 && std::signbit(a[3].as_number())));
  CHECK((a[4].as_number() == 0 && std::signbit(a[4].as_number())));
  CHECK(a[5].as_number() == 5e-324);
  CHECK(a[6].as_number() == 5e-324);
}

TEST_CASE("object keys keep JS property order; duplicates overwrite in place", "[json]") {
  json::Value v =
      json::parse(R"({"b":1,"2":0,"1":0,"a":2,"b":3,"4294967295":0,"4294967294":0,"01":0,"-1":0})");
  CHECK(keys(v) ==
        std::vector<std::string>{"1", "2", "4294967294", "b", "a", "4294967295", "01", "-1"});
  CHECK(v.as_object().find("b")->as_number() == 3);
  CHECK(json::stringify(json::parse(R"({"__proto__":1,"__proto__":2})")) == R"({"__proto__":2})");
}

TEST_CASE("large objects keep lookups and order through the hash index", "[json]") {
  json::Object o;
  for (int i = 0; i < 40; ++i) {
    o.set("k" + std::to_string(i), i);
  }
  o.set("k3", 300);
  o.set("7", 7);
  o.set("k39", 3900);
  o.set("3", 3);
  REQUIRE(o.size() == 42);
  CHECK(o.find("k3")->as_number() == 300);
  CHECK(o.find("k39")->as_number() == 3900);
  CHECK(o.find("7")->as_number() == 7);
  CHECK(o.find("missing") == nullptr);
  CHECK(o.begin()->key == "3");
  CHECK((o.begin() + 1)->key == "7");
  CHECK((o.begin() + 2)->key == "k0");
  json::Object copy = o;
  CHECK(copy == o);
  CHECK(copy.find("k20")->as_number() == 20);
}

TEST_CASE("lone surrogates survive as WTF-8 and are written escaped", "[json][surrogate]") {
  json::Value high = json::parse(R"("\ud800")");
  CHECK(high.as_string() == "\xED\xA0\x80");
  CHECK(cantus::js::utf16_length(high.as_string()) == 1);
  CHECK(json::stringify(high) == R"("\ud800")");

  CHECK(json::parse(R"("\ud83d\ude00")").as_string() == "\xF0\x9F\x98\x80");
  CHECK(json::stringify(json::parse(R"("\udc00\ud800")")) == R"("\udc00\ud800")");
  CHECK(json::stringify(json::parse(R"("a\uDBFFz\uDFFF")")) == R"("a\udbffz\udfff")");
  // Raw WTF-8 halves, and an escaped half next to a raw one, collapse into one code point.
  CHECK(json::parse("\"\xED\xA0\xBD\xED\xB8\x80\"").as_string() == "\xF0\x9F\x98\x80");
  CHECK(json::parse("\"\\ud83d\xED\xB8\x80\"").as_string() == "\xF0\x9F\x98\x80");
  CHECK(json::stringify(json::Value(std::string("\xED\xB0\x80"))) == R"("\udc00")");
}

TEST_CASE("nesting is limited to kMaxDepth", "[json][depth]") {
  auto nested = [](std::size_t depth) { return std::string(depth, '[') + std::string(depth, ']'); };
  CHECK_NOTHROW(json::parse(nested(json::kMaxDepth)));
  CHECK_THROWS_AS(json::parse(nested(json::kMaxDepth + 1)), json::ParseError);

  std::string objects;
  for (std::size_t i = 0; i < json::kMaxDepth; ++i) objects += "{\"a\":";
  CHECK_NOTHROW(json::parse(objects + "1" + std::string(json::kMaxDepth, '}')));
  CHECK_THROWS_AS(json::parse("[" + objects + "1" + std::string(json::kMaxDepth, '}') + "]"),
                  json::ParseError);
  try {
    json::parse(nested(json::kMaxDepth + 1));
  } catch (const json::ParseError& e) {
    CHECK(e.offset() == json::kMaxDepth);
  }
}

TEST_CASE("malformed input is rejected", "[json]") {
  const std::vector<std::string> bad = {"",
                                        " ",
                                        "01",
                                        "1.",
                                        ".5",
                                        "-",
                                        "+1",
                                        "[1,]",
                                        "{\"a\":1,}",
                                        "tru",
                                        "nul",
                                        "\"\\x\"",
                                        "\"a\nb\"",
                                        "\"\\u12\"",
                                        "\"\\u12G4\"",
                                        "[1] x",
                                        "NaN",
                                        "Infinity",
                                        "'a'",
                                        "{a:1}",
                                        "[",
                                        "{\"a\"}",
                                        "\"abc",
                                        "1e",
                                        "1e+",
                                        "-01",
                                        "\xEF\xBB\xBF{}",
                                        "\"\xC0\x80\"",
                                        "\"\xFF\"",
                                        "\"\xE2\x82\"",
                                        "\"\xF4\x90\x80\x80\"",
                                        "\"\xE0\x80\x80\"",
                                        "\"\x80\"",
                                        "\"\xF0\x8F\xBF\xBF\""};
  for (const std::string& text : bad) {
    INFO(text);
    CHECK_THROWS_AS(json::parse(text), json::ParseError);
  }
}

TEST_CASE("embedded NUL is kept", "[json]") {
  json::Value v = json::parse(R"("a\u0000b")");
  CHECK(v.as_string() == std::string("a\0b", 3));
  CHECK(json::stringify(v) == R"("a\u0000b")");
}

TEST_CASE("non-finite numbers are written as null", "[json]") {
  json::Array a{json::Value(NAN), json::Value(INFINITY), json::Value(-0.0), json::Value(1.5)};
  CHECK(json::stringify(json::Value(a)) == "[null,null,0,1.5]");
}
