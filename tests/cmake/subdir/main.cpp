// A program using the typed API from an add_subdirectory() build: one call into each of the five
// layers.

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
  // core, theory, analyze, generate, model.
  if (cantus::pitch_class_of(-1) != 11) return 2;
  if (!cantus::resolve_scale_name("major").has_value()) return 3;
  if (!cantus::detect_chord_best({57, 60, 64}).has_value()) return 4;
  if (cantus::progressions().empty()) return 5;
  if (cantus::Note::parse("Bb3").name() != "Bb3") return 6;
  std::printf("cantus %s (algorithm %u)\n", cantus::version(),
              static_cast<unsigned>(cantus::ALGORITHM_VERSION));
  return 0;
}
