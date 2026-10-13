// The vocabulary the analyze layer explains itself in: ts/src/analyze/functional/rationale.ts.

#include "analyze/functional/rationale.h"

namespace cantus {

std::string capitalize(std::string_view text) {
  std::string out(text);
  if (!out.empty() && out[0] >= 'a' && out[0] <= 'z') {
    out[0] = static_cast<char>(out[0] - 'a' + 'A');
  }
  return out;
}

}  // namespace cantus
