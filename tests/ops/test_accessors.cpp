// The option accessors (null read as default, strict, nullable) and the CANTUS_JSON_FIELDS output
// codec.

#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "cantus/core/nullable.h"
#include "json/json.h"
#include "ops/accessors.h"
#include "ops/codec.h"

namespace cantus::ops {

struct Inner {
  int pitch;
  double velocity;
};

struct Outer {
  std::string name;
  std::optional<double> startBeat;
  Nullable<int> voice;
  std::vector<Inner> notes;
  std::vector<std::optional<int>> holes;
  std::variant<int, std::string> label;
  bool muted;
};

CANTUS_JSON_FIELDS(Inner, pitch, velocity)
CANTUS_JSON_FIELDS(Outer, name, startBeat, voice, notes, holes, label, muted)

}  // namespace cantus::ops

namespace {

using cantus::json::parse;
using cantus::json::Value;

double number(const Value& v) { return v.as_number(); }

}  // namespace

TEST_CASE("opt_null_default treats absent and null alike", "[accessors]") {
  using cantus::ops::opt_null_default;
  Value opts = parse(R"({"a":1,"b":null,"$$c":3})");
  CHECK(opt_null_default(opts, "a", number) == 1.0);
  CHECK_FALSE(opt_null_default(opts, "b", number).has_value());
  CHECK_FALSE(opt_null_default(opts, "z", number).has_value());
  CHECK(opt_null_default(opts, "$c", number) == 3.0);
  CHECK(opt_null_default(parse("[1]"), "0") == nullptr);
  CHECK(opt_null_default(parse("null"), "a") == nullptr);
}

TEST_CASE("opt_strict passes null on for the validator to reject", "[accessors]") {
  using cantus::ops::opt_strict;
  Value opts = parse(R"({"a":1,"b":null})");
  CHECK(opt_strict(opts, "b") != nullptr);
  CHECK(opt_strict(opts, "b")->is_null());
  CHECK(opt_strict(opts, "z") == nullptr);
  bool saw_null = false;
  auto read = [&](const Value& v) {
    saw_null = v.is_null();
    return 0;
  };
  CHECK(opt_strict(opts, "b", read).has_value());
  CHECK(saw_null);
}

TEST_CASE("opt_nullable tells absent from null", "[accessors]") {
  using cantus::ops::opt_nullable;
  using cantus::ops::Presence;
  Value opts = parse(R"({"a":2,"b":null})");
  CHECK(opt_nullable(opts, "a") == Presence::kValue);
  CHECK(opt_nullable(opts, "b") == Presence::kNull);
  CHECK(opt_nullable(opts, "z") == Presence::kAbsent);
  auto a = opt_nullable(opts, "a", number);
  REQUIRE(a.has_value());
  CHECK(**a == 2.0);
  auto b = opt_nullable(opts, "b", number);
  REQUIRE(b.has_value());
  CHECK_FALSE(b->has_value());
  CHECK_FALSE(opt_nullable(opts, "z", number).has_value());
}

TEST_CASE("CANTUS_JSON_FIELDS writes fields in order", "[codec]") {
  cantus::ops::Outer o{"lead",
                       std::nullopt,
                       cantus::Nullable<int>(),
                       {{60, 0.5}, {62, -0.0}},
                       {1, std::nullopt},
                       std::string("x"),
                       false};
  CHECK(cantus::ops::stringify(cantus::ops::to_json(o)) ==
        R"({"name":"lead","voice":null,"notes":[{"pitch":60,"velocity":0.5},)"
        R"({"pitch":62,"velocity":{"$n":"-0"}}],"holes":[1,{"$u":1}],"label":"x","muted":false})");
  o.startBeat = std::numeric_limits<double>::quiet_NaN();
  o.voice = 2;
  o.label = 7;
  CHECK(cantus::ops::stringify(cantus::ops::to_json(o)) ==
        R"({"name":"lead","startBeat":{"$n":"NaN"},"voice":2,"notes":[{"pitch":60,"velocity":0.5},)"
        R"({"pitch":62,"velocity":{"$n":"-0"}}],"holes":[1,{"$u":1}],"label":7,"muted":false})");
}

TEST_CASE("to_json of an empty optional is undefined", "[codec]") {
  CHECK(cantus::ops::stringify(cantus::ops::to_json(std::optional<int>())) == R"({"$u":1})");
  CHECK(cantus::ops::stringify(cantus::ops::to_json(cantus::Nullable<int>())) == "null");
}
