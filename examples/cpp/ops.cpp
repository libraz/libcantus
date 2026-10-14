// Calls ops by name with JSON arguments, the way a host that holds JSON would.

#include <cantus/ops.h>

#include <cstdio>

int main() {
  cantus::ops::Result chord = cantus::ops::call("detectChordBest", "[[60, 64, 67]]");
  std::printf("%s\n", chord.json.c_str());
  if (!chord.ok()) return 1;

  // A failure comes back as a status and an error object, never as an exception.
  cantus::ops::Result bad = cantus::ops::call("detectChord", "[[128]]");
  std::printf("%d %s\n", static_cast<int>(bad.status), bad.json.c_str());
  return bad.status == CANTUS_INVALID_INPUT ? 0 : 1;
}
