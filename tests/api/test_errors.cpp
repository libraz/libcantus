// The typed error taxonomy (cantus/core/errors.h).

#include <catch2/catch_test_macros.hpp>
#include <stdexcept>
#include <string>

#include "cantus/core/errors.h"
#include "core/errors/errors.h"

namespace {

cantus::ParseResult<int> parse_digit(char c) {
  try {
    if (c == '!') {
      throw std::logic_error("not ours");
    }
    if (c < '0' || c > '9') {
      throw cantus::InvalidInputError(std::string("not a digit: ") + c);
    }
    return cantus::ParseResult<int>::success(c - '0');
  } catch (...) {
    return cantus::parse_failure<int>();
  }
}

}  // namespace

TEST_CASE("each error carries its code and message", "[errors]") {
  cantus::InvalidInputError invalid("bad");
  cantus::NoSolutionError none("no", 4);
  cantus::BudgetExceededError budget("big");
  CHECK(invalid.code() == cantus::ErrorCode::kInvalidInput);
  CHECK(none.code() == cantus::ErrorCode::kNoSolution);
  CHECK(budget.code() == cantus::ErrorCode::kBudgetExceeded);
  CHECK(std::string(invalid.what()) == "bad");
  CHECK(none.at() == 4u);
  CHECK_FALSE(cantus::NoSolutionError("no").at().has_value());
  CHECK(cantus::is_libcantus_error(invalid));
  CHECK(cantus::is_libcantus_error(none));
  CHECK(cantus::is_libcantus_error(budget));
  CHECK_FALSE(cantus::is_libcantus_error(cantus::Error(cantus::ErrorCode::kInternal, "x")));
  CHECK_THROWS_AS(throw budget, std::runtime_error);
  CHECK_THROWS_AS(throw none, cantus::Error);
}

TEST_CASE("ParseResult reports failure instead of throwing it", "[errors]") {
  auto ok = parse_digit('7');
  REQUIRE(ok.ok());
  CHECK(ok.value() == 7);
  CHECK(std::move(ok).unwrap() == 7);

  auto failed = parse_digit('x');
  REQUIRE_FALSE(failed.ok());
  CHECK(failed.error().code() == cantus::ErrorCode::kInvalidInput);
  CHECK(std::string(failed.error().what()) == "not a digit: x");
  CHECK_THROWS_AS(std::move(failed).unwrap(), cantus::InvalidInputError);
  CHECK_THROWS_AS(parse_digit('7').error(), std::bad_variant_access);

  auto none = cantus::ParseResult<int>::failure(cantus::NoSolutionError("n", 2));
  try {
    std::move(none).unwrap();
    FAIL("no throw");
  } catch (const cantus::NoSolutionError& e) {
    CHECK(e.at() == 2u);
  }
}

TEST_CASE("parse_failure rethrows what is not ours", "[errors]") {
  CHECK_THROWS_AS(parse_digit('!'), std::logic_error);
}
