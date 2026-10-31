#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <cmath>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/random.h"

using namespace cantus;

TEST_CASE("Rng draws the mulberry32 stream", "[random]") {
  Rng rng = create_rng(42);
  CHECK(rng.next() == 0.6011037519201636);
  CHECK(rng.next() == 0.44829055899754167);
  CHECK(rng.range(1, 6) == 6);
  CHECK(rng.float_(2, 3) == 2.6697340414393693);
  CHECK(rng.prob(0.5));
}

TEST_CASE("Rng rejects bad arguments without consuming a draw", "[random]") {
  Rng rng = create_rng(42);
  CHECK_THROWS_WITH(rng.prob(1.5), "probability must be in [0, 1]; received 1.5");
  CHECK_THROWS_WITH(rng.range(3, 1),
                    "range lower bound must not exceed upper bound; received 3 > 1");
  CHECK_THROWS_WITH(rng.float_(2, 1),
                    "float lower bound must not exceed upper bound; received 2 > 1");
  CHECK(rng.next() == 0.6011037519201636);
}

TEST_CASE("Rng float stays below its upper bound", "[random]") {
  Rng narrow = create_rng(1);
  Rng wide = create_rng(1);
  Rng at_zero = create_rng(1);
  for (int i = 0; i < 2000; ++i) {
    CHECK(narrow.float_(0.7, 0.7000000000000001) < 0.7000000000000001);
    CHECK(wide.float_(1e16, 1e16 + 2) < 1e16 + 2);
    CHECK(at_zero.float_(-5e-324, 0) < 0);
  }
  Rng floats = create_rng(7);
  Rng units = create_rng(7);
  for (int i = 0; i < 50; ++i) {
    double unit = units.next();
    CHECK(floats.float_(2, 6) == 2 + unit * 4);
  }
  CHECK(create_rng(3).float_(5, 5) == 5);
}

TEST_CASE("derive_seed and PositionalRng hash UTF-16 code units", "[random]") {
  CHECK(derive_seed(42, {"drums", "chorus", 3.0}) == 1211545333U);
  CHECK(derive_seed(7) == 352299484U);
  CHECK(derive_seed(1, {"\xC3\xA9\xF0\x9F\x98\x80", 2.5}) == 2424302766U);
  CHECK(create_positional_rng(7).at({"ghost", 4.0, 2.5}) == 0.018488293746486306);
  CHECK_THROWS_WITH(derive_seed(1, {std::nan("")}),
                    "seed path segment 0 must be finite; received NaN");
}

TEST_CASE("include_at compares the draw with the complexity", "[random]") {
  PositionalRng rng = create_positional_rng(7);
  CHECK(include_at(rng, 0.3, {"ghost", 4.0, 2.5}));
  CHECK_FALSE(include_at(rng, 0.0, {"ghost", 4.0, 2.5}));
  CHECK_THROWS_WITH(include_at(rng, 7, {}), "complexity must be in [0, 1]; received 7");
  CHECK_THROWS_WITH(include_at([](const SeedPath&) { return 1.0; }, 0.5),
                    "positional draw must be in [0, 1); received 1");
}

TEST_CASE("resolve_algorithm_version accepts the versions this build produces", "[random]") {
  CHECK(resolve_algorithm_version() == ALGORITHM_VERSION);
  CHECK(resolve_algorithm_version(1) == 1U);
  CHECK_THROWS_WITH(resolve_algorithm_version(2),
                    "algorithm version 2 is not produced by this build; supported versions are "
                    "1..1");
}
