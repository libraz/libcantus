// A program using the installed typed API: one call into each of the five layers.

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
  // core, theory, analyze, generate, model.
  if (cantus::format_note(cantus::parse_note("C#4")) != "C#4") return 2;
  if (cantus::named_scale_mask("major") != 0xAB5) return 3;
  const auto chords = cantus::detect_chord({60, 64, 67});
  if (chords.empty() || chords[0].rootPc != 0 || !chords[0].exact) return 4;
  if (cantus::generate_rhythm("4/4").empty()) return 5;
  if (cantus::Note::from_midi(61).name() != "C#4") return 6;
  std::printf("cantus %s\n", cantus::version());
  return 0;
}
