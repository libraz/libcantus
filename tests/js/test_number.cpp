#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>

#include "js/number.h"

namespace js = cantus::js;

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();

/** `String(v)`, spelling -0 as "-0" so tests can tell the zeros apart. */
std::string show(double v) { return v == 0 && std::signbit(v) ? "-0" : js::to_string(v); }

}  // namespace

TEST_CASE("to_string follows Number::toString boundaries", "[number]") {
  CHECK(js::to_string(0.0) == "0");
  CHECK(js::to_string(-0.0) == "0");
  CHECK(js::to_string(std::nan("")) == "NaN");
  CHECK(js::to_string(kInf) == "Infinity");
  CHECK(js::to_string(-kInf) == "-Infinity");
  CHECK(js::to_string(0.1) == "0.1");
  CHECK(js::to_string(0.1 + 0.2) == "0.30000000000000004");
  CHECK(js::to_string(1e21) == "1e+21");
  CHECK(js::to_string(1e20) == "100000000000000000000");
  CHECK(js::to_string(123456789012345680000.0) == "123456789012345680000");
  CHECK(js::to_string(1e-7) == "1e-7");
  CHECK(js::to_string(1.5e-7) == "1.5e-7");
  CHECK(js::to_string(0.000001) == "0.000001");
  CHECK(js::to_string(-0.000001) == "-0.000001");
  CHECK(js::to_string(2.5e-5) == "0.000025");
  CHECK(js::to_string(5e-324) == "5e-324");
  CHECK(js::to_string(1.7976931348623157e308) == "1.7976931348623157e+308");
  CHECK(js::to_string(9007199254740992.0) == "9007199254740992");
  CHECK(js::to_string(1e100) == "1e+100");
  CHECK(js::to_string(-123.456) == "-123.456");
  CHECK(js::to_string(4.35) == "4.35");
}

TEST_CASE("to_fixed uses the exact ES algorithm", "[number]") {
  CHECK(js::to_fixed(0.125, 2) == "0.13");
  CHECK(js::to_fixed(0.5, 0) == "1");
  CHECK(js::to_fixed(-0.5, 0) == "-1");
  CHECK(js::to_fixed(2.5, 0) == "3");
  CHECK(js::to_fixed(-2.5, 0) == "-3");
  CHECK(js::to_fixed(1.005, 2) == "1.00");
  CHECK(js::to_fixed(1.45, 1) == "1.4");
  CHECK(js::to_fixed(1.255, 2) == "1.25");
  CHECK(js::to_fixed(8.345, 2) == "8.35");
  CHECK(js::to_fixed(-1.5e-7, 2) == "-0.00");
  CHECK(js::to_fixed(-0.0, 2) == "0.00");
  CHECK(js::to_fixed(1e21, 2) == "1e+21");
  CHECK(js::to_fixed(999999999999999900000.0, 2) == "999999999999999868928.00");
  CHECK(js::to_fixed(123.456, 10) == "123.4560000000");
  CHECK(js::to_fixed(0.1, 20) == "0.10000000000000000555");
  CHECK(js::to_fixed(5e-324, 100) == "0." + std::string(100, '0'));
  CHECK(js::to_fixed(std::nan(""), 2) == "NaN");
  CHECK(js::to_fixed(kInf, 3) == "Infinity");
  CHECK(js::to_fixed(-kInf, 1) == "-Infinity");
  CHECK_THROWS_AS(js::to_fixed(1, 101), std::range_error);
  CHECK_THROWS_AS(js::to_fixed(1, -1), std::range_error);
}

TEST_CASE("number follows StringToNumber", "[number]") {
  CHECK(show(js::number("")) == "0");
  CHECK(show(js::number("  ")) == "0");
  CHECK(show(js::number("  12  ")) == "12");
  CHECK(show(js::number(" \n\t-12.5e1 ")) == "-125");
  CHECK(show(js::number("\xE3\x80\x80 3\xEF\xBB\xBF")) == "3");  // U+3000 ... U+FEFF
  CHECK(show(js::number("0x1F")) == "31");
  CHECK(show(js::number("-0x1F")) == "NaN");
  CHECK(show(js::number("0b101")) == "5");
  CHECK(show(js::number("0o17")) == "15");
  CHECK(show(js::number("0x")) == "NaN");
  CHECK(show(js::number("0b2")) == "NaN");
  CHECK(show(js::number("0X1fffffffffffff1")) == "144115188075855860");
  CHECK(show(js::number("0x20000000000001")) == "9007199254740992");
  CHECK(show(js::number("0x20000000000003")) == "9007199254740996");
  CHECK(show(js::number("00012")) == "12");
  CHECK(show(js::number("-0")) == "-0");
  CHECK(show(js::number(".5")) == "0.5");
  CHECK(show(js::number("5.")) == "5");
  CHECK(show(js::number("+.5e-3")) == "0.0005");
  CHECK(show(js::number(".")) == "NaN");
  CHECK(show(js::number("1e")) == "NaN");
  CHECK(show(js::number("1e+")) == "NaN");
  CHECK(show(js::number("1_0")) == "NaN");
  CHECK(show(js::number("12px")) == "NaN");
  CHECK(show(js::number("+-1")) == "NaN");
  CHECK(show(js::number("+Infinity")) == "Infinity");
  CHECK(show(js::number("-Infinity")) == "-Infinity");
  CHECK(show(js::number("infinity")) == "NaN");
  CHECK(show(js::number("Infinityx")) == "NaN");
  CHECK(show(js::number("1e1000")) == "Infinity");
  CHECK(show(js::number("-1e-400")) == "-0");
}

TEST_CASE("parse_int follows Number.parseInt", "[number]") {
  CHECK(show(js::parse_int("  -0x1F")) == "-31");
  CHECK(show(js::parse_int("0x")) == "NaN");
  CHECK(show(js::parse_int("-0x")) == "NaN");
  CHECK(show(js::parse_int("12abc")) == "12");
  CHECK(show(js::parse_int("abc")) == "NaN");
  CHECK(show(js::parse_int("-0")) == "-0");
  CHECK(show(js::parse_int("-00")) == "-0");
  CHECK(show(js::parse_int("0")) == "0");
  CHECK(show(js::parse_int("-")) == "NaN");
  CHECK(show(js::parse_int("  ")) == "NaN");
  CHECK(show(js::parse_int("1e3")) == "1");
  CHECK(show(js::parse_int(" +12")) == "12");
  CHECK(show(js::parse_int("0x1g")) == "1");
  CHECK(show(js::parse_int("z", 36)) == "35");
  CHECK(show(js::parse_int("zz", 35)) == "NaN");
  CHECK(show(js::parse_int("10", 37)) == "NaN");
  CHECK(show(js::parse_int("10", 1)) == "NaN");
  CHECK(show(js::parse_int("10", 4294967312.0)) == "16");
  CHECK(show(js::parse_int("-1", 2.9)) == "-1");
  CHECK(show(js::parse_int("0x10", 16)) == "16");
  CHECK(show(js::parse_int("0x10", 8)) == "0");
  CHECK(show(js::parse_int("9", 8)) == "NaN");
  CHECK(show(js::parse_int("11", 2)) == "3");
  CHECK(show(js::parse_int("123456789012345678901234567890")) == "1.2345678901234568e+29");
  CHECK(show(js::parse_int("zzzzzzzzzzzzzzzzzzzz", 36)) == "1.3367494538843734e+31");
  CHECK(show(js::parse_int("7fffffffffffffffff", 16)) == "2.3611832414348226e+21");
  CHECK(show(js::parse_int("777777777777777777777", 8)) == "9223372036854776000");
  CHECK(show(js::parse_int(std::string(40, '1'), 3)) == "6078832729528464000");
  CHECK(show(js::parse_int(std::string(400, '0') + "5")) == "5");
  CHECK(show(js::parse_int("1" + std::string(309, '0'))) == "Infinity");
}
