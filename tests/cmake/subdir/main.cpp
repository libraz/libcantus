// A program using the typed API from an add_subdirectory() build.

#include <cantus/cantus.h>

#include <cstdio>

int main() {
  try {
    throw cantus::InvalidInputError("pitch must be an integer in [0, 127]; received 128");
  } catch (const cantus::Error& e) {
    if (e.code() != cantus::ErrorCode::kInvalidInput) {
      return 1;
    }
  }
  std::printf("cantus %s (algorithm %u)\n", cantus::version(),
              static_cast<unsigned>(cantus::ALGORITHM_VERSION));
  return 0;
}
