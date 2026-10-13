#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <limits>
#include <vector>

#include "js/math.h"

namespace js = cantus::js;

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();
const double kNaN = std::nan("");

bool is_neg_zero(double v) { return v == 0 && std::signbit(v); }
bool is_pos_zero(double v) { return v == 0 && !std::signbit(v); }

}  // namespace

TEST_CASE("round keeps JS half-way and signed-zero behaviour", "[math]") {
  CHECK(is_neg_zero(js::round(-0.0)));
  CHECK(is_neg_zero(js::round(-0.3)));
  CHECK(is_neg_zero(js::round(-0.5)));
  CHECK(is_pos_zero(js::round(0.3)));
  CHECK(is_pos_zero(js::round(0.49999999999999994)));
  CHECK(is_neg_zero(js::round(-0.49999999999999994)));
  CHECK(js::round(-2.5) == -2);
  CHECK(js::round(2.5) == 3);
  CHECK(js::round(-1.5) == -1);
  CHECK(js::round(-0.5000000000000001) == -1);
  CHECK(js::round(4503599627370495.5) == 4503599627370496);
  CHECK(js::round(-4503599627370495.5) == -4503599627370495);
  CHECK(js::round(9007199254740993.0) == 9007199254740992.0);
  CHECK(js::round(kInf) == kInf);
  CHECK(js::round(-kInf) == -kInf);
  CHECK(std::isnan(js::round(kNaN)));
}

TEST_CASE("max and min propagate NaN, order signed zeros, and handle empty", "[math]") {
  CHECK(js::max({}) == -kInf);
  CHECK(js::min({}) == kInf);
  CHECK(js::max(std::vector<double>{}) == -kInf);
  CHECK(is_pos_zero(js::max(-0.0, 0.0)));
  CHECK(is_pos_zero(js::max(0.0, -0.0)));
  CHECK(is_neg_zero(js::min(0.0, -0.0)));
  CHECK(is_neg_zero(js::min(-0.0, 0.0)));
  CHECK(std::isnan(js::max(1.0, kNaN, 3.0)));
  CHECK(std::isnan(js::min(kNaN, -kInf)));
  CHECK(js::max(1.0, 7.0, 3, -2.0) == 7);
  CHECK(js::min(std::vector<double>{4, -1, 9}) == -1);
  CHECK(js::max({-kInf}) == -kInf);
}

TEST_CASE("sign keeps signed zeros and NaN", "[math]") {
  CHECK(is_neg_zero(js::sign(-0.0)));
  CHECK(is_pos_zero(js::sign(0.0)));
  CHECK(std::isnan(js::sign(kNaN)));
  CHECK(js::sign(-1e-300) == -1);
  CHECK(js::sign(kInf) == 1);
}

TEST_CASE("int32 conversions and imul wrap like JS", "[math]") {
  CHECK(js::to_int32(2147483648.0) == -2147483647 - 1);
  CHECK(js::to_int32(4294967296.0 + 5) == 5);
  CHECK(js::to_int32(-1.9) == -1);
  CHECK(js::to_int32(kNaN) == 0);
  CHECK(js::to_int32(kInf) == 0);
  CHECK(js::to_int32(1e20) == 1661992960);
  CHECK(js::to_uint32(-1) == 4294967295u);
  CHECK(js::to_uint32(-4294967297.5) == 4294967295u);
  CHECK(js::imul(0xffffffff, 5) == -5);
  CHECK(js::imul(0x7fffffff, 0x7fffffff) == 1);
  CHECK(js::imul(-1, 8) == -8);
  CHECK(js::imul(2654435761.0, 2246822519.0) == -62244025);
}

TEST_CASE("pow follows the ES special cases", "[math]") {
  CHECK(std::isnan(js::pow(1, kInf)));
  CHECK(std::isnan(js::pow(-1, -kInf)));
  CHECK(std::isnan(js::pow(1, kNaN)));
  CHECK(js::pow(kNaN, 0) == 1);
  CHECK(is_neg_zero(js::pow(-0.0, 3)));
  CHECK(is_pos_zero(js::pow(-0.0, 0.5)));
  CHECK(js::pow(-kInf, 0.5) == kInf);
  CHECK(js::pow(-0.0, -3) == -kInf);
  CHECK(std::isnan(js::pow(-8, 1.0 / 3)));
  CHECK(js::pow(2, 10) == 1024);
  CHECK(js::pow(2, -1074) == 5e-324);
}

TEST_CASE("log2 and exp special values", "[math]") {
  CHECK(js::log2(0.0) == -kInf);
  CHECK(js::log2(-0.0) == -kInf);
  CHECK(std::isnan(js::log2(-1)));
  CHECK(js::log2(kInf) == kInf);
  CHECK(is_pos_zero(js::log2(1)));
  CHECK(js::log2(5e-324) == -1074);
  CHECK(js::exp(1) == 2.718281828459045);
  CHECK(is_pos_zero(js::exp(-kInf)));
  CHECK(js::exp(kInf) == kInf);
  CHECK(js::exp(-0.0) == 1);
  CHECK(js::exp(710) == kInf);
}
