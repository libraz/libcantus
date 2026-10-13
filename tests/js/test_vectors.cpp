#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "js/math.h"
#include "js/number.h"
#include "json/json.h"

using cantus::json::Value;

// The same port built with contraction (ieee754_fused.cpp).
namespace cantus_fused::js {
double log2(double x);
double exp(double x);
double pow(double x, double y);
}  // namespace cantus_fused::js

namespace {

Value load(const std::string& name) {
  std::ifstream in(std::string(CANTUS_JS_VECTOR_DIR) + "/" + name, std::ios::binary);
  REQUIRE(in.good());
  std::stringstream buf;
  buf << in.rdbuf();
  return cantus::json::parse(buf.str());
}

double from_hex(const std::string& column, std::size_t index) {
  std::uint64_t bits = std::stoull(column.substr(index * 16, 16), nullptr, 16);
  double d;
  std::memcpy(&d, &bits, sizeof d);
  return d;
}

std::string hex(double d) {
  std::uint64_t bits;
  std::memcpy(&bits, &d, sizeof bits);
  char buf[17];
  std::snprintf(buf, sizeof buf, "%016llx", static_cast<unsigned long long>(bits));
  return buf;
}

/** Bit-identical, except that every NaN matches every NaN (JS has one NaN). */
bool same(double a, double b) {
  if (std::isnan(a) || std::isnan(b)) {
    return std::isnan(a) && std::isnan(b);
  }
  return hex(a) == hex(b);
}

std::size_t vector_count(const Value& file, const char* column) {
  std::size_t count = static_cast<std::size_t>(file.as_object().find("count")->as_number());
  REQUIRE(count > 0);
  REQUIRE(file.as_object().find(column)->as_string().size() == count * 16);
  return count;
}

/**
 * Tally of port results against Node. A miss is tolerated only where Node's FMA rounding
 * explains it: the contracted build reproduces Node, and Node ran on a target with FMA.
 */
struct Tally {
  std::string arch;
  std::size_t fused_only = 0;
  std::size_t mismatches = 0;

  void add(double got, double fused, double want, const std::string& what) {
    if (same(got, want)) return;
    if (arch != "x64" && same(fused, want)) {
      ++fused_only;
      return;
    }
    if (++mismatches <= 10) UNSCOPED_INFO(what << " want=" << hex(want) << " got=" << hex(got));
  }
};

std::string arch_of(const Value& file) { return file.as_object().find("arch")->as_string(); }

template <class F, class G>
void check_unary(const char* file_name, F fn, G fused_fn) {
  Value file = load(file_name);
  std::size_t count = vector_count(file, "x");
  const std::string& x = file.as_object().find("x")->as_string();
  const std::string& result = file.as_object().find("result")->as_string();
  Tally tally{arch_of(file)};
  for (std::size_t i = 0; i < count; ++i) {
    double in = from_hex(x, i);
    tally.add(fn(in), fused_fn(in), from_hex(result, i), std::string(file_name) + " x=" + hex(in));
  }
  CHECK(tally.mismatches == 0);
  WARN(file_name << ": " << tally.fused_only << " of " << count
                 << " results differ only by Node's FMA contraction");
}

}  // namespace

TEST_CASE("log2 matches Node bit for bit", "[vectors]") {
  check_unary(
      "log2.json", [](double v) { return cantus::js::log2(v); },
      [](double v) { return cantus_fused::js::log2(v); });
}

TEST_CASE("exp matches Node bit for bit", "[vectors]") {
  check_unary(
      "exp.json", [](double v) { return cantus::js::exp(v); },
      [](double v) { return cantus_fused::js::exp(v); });
}

TEST_CASE("pow matches Node bit for bit", "[vectors]") {
  Value file = load("pow.json");
  std::size_t count = vector_count(file, "x");
  const auto& o = file.as_object();
  const std::string& x = o.find("x")->as_string();
  const std::string& y = o.find("y")->as_string();
  const std::string& result = o.find("result")->as_string();
  Tally tally{arch_of(file)};
  for (std::size_t i = 0; i < count; ++i) {
    double a = from_hex(x, i);
    double b = from_hex(y, i);
    tally.add(cantus::js::pow(a, b), cantus_fused::js::pow(a, b), from_hex(result, i),
              "pow x=" + hex(a) + " y=" + hex(b));
  }
  CHECK(tally.mismatches == 0);
  WARN("pow.json: " << tally.fused_only << " of " << count
                    << " results differ only by Node's FMA contraction");
}

TEST_CASE("round, toString, toFixed, max and min match Node", "[vectors]") {
  Value file = load("number.json");
  std::size_t count = vector_count(file, "x");
  const auto& o = file.as_object();
  const std::string& x = o.find("x")->as_string();
  const std::string& round = o.find("round")->as_string();
  const auto& to_string = o.find("to_string")->as_array();
  const auto& digits = o.find("to_fixed_digits")->as_array();
  const auto& to_fixed = o.find("to_fixed")->as_array();
  const std::string& max = o.find("max_with_next")->as_string();
  const std::string& min = o.find("min_with_next")->as_string();
  REQUIRE(to_string.size() == count);
  REQUIRE(to_fixed.size() == count);
  REQUIRE(max.size() == count);
  REQUIRE(min.size() == count);

  auto expect_pick = [](char which, double a, double b) {
    if (which == 'n') return std::nan("");
    return which == 'a' ? a : b;
  };
  std::size_t mismatches = 0;
  auto report = [&](const char* what, double v, const std::string& want, const std::string& got) {
    if (++mismatches <= 10) {
      UNSCOPED_INFO(what << " x=" << hex(v) << " want=" << want << " got=" << got);
    }
  };
  for (std::size_t i = 0; i < count; ++i) {
    double a = from_hex(x, i);
    double b = from_hex(x, (i + 1) % count);
    double r = cantus::js::round(a);
    if (!same(r, from_hex(round, i))) report("round", a, hex(from_hex(round, i)), hex(r));
    std::string s = cantus::js::to_string(a);
    if (s != to_string[i].as_string()) report("to_string", a, to_string[i].as_string(), s);
    std::string f = cantus::js::to_fixed(a, static_cast<int>(digits[i].as_number()));
    if (f != to_fixed[i].as_string()) report("to_fixed", a, to_fixed[i].as_string(), f);
    double hi = cantus::js::max(a, b);
    if (!same(hi, expect_pick(max[i], a, b))) report("max", a, std::string(1, max[i]), hex(hi));
    double lo = cantus::js::min(a, b);
    if (!same(lo, expect_pick(min[i], a, b))) report("min", a, std::string(1, min[i]), hex(lo));
  }
  CHECK(mismatches == 0);
}
