// The contour target of ts/src/generate/plan/types.ts.

#include "generate/plan/types.h"

namespace cantus {

namespace {

/** A tent over [0, 1] rising from -1 to +1 at `apex` and falling back. */
double tent(double t, double apex) {
  if (t <= apex) {
    return apex == 0 ? 1 : -1 + (2 * t) / apex;
  }
  return apex == 1 ? 1 : 1 - (2 * (t - apex)) / (1 - apex);
}

}  // namespace

double planned_contour_at(MelodicContourShape shape, double peak_position, double t) {
  switch (shape) {
    case MelodicContourShape::kArch:
      return tent(t, peak_position);
    case MelodicContourShape::kAscending:
      return -1 + 2 * t;
    case MelodicContourShape::kDescending:
      return 1 - 2 * t;
    case MelodicContourShape::kWave:
      return t < 0.5 ? tent(2 * t, 0.5) : tent(2 * t - 1, 0.5);
    case MelodicContourShape::kStatic:
      return 0;
  }
  return 0;
}

}  // namespace cantus
