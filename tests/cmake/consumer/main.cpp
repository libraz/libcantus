// A program using the installed typed API.

#include <cantus/cantus.h>

#include <cstdio>
#include <cstring>

int main() {
  if (std::strcmp(cantus::version(), CANTUS_VERSION_STRING) != 0 ||
      cantus::ALGORITHM_VERSION < cantus::MIN_ALGORITHM_VERSION) {
    return 1;
  }
  try {
    throw cantus::NoSolutionError("no voicing fits", 2);
  } catch (const cantus::Error& e) {
    if (e.code() != cantus::ErrorCode::kNoSolution || !cantus::is_libcantus_error(e)) {
      return 1;
    }
  }
  std::printf("cantus %s\n", cantus::version());
  return 0;
}
