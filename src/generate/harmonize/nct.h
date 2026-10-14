/**
 * @file nct.h
 * @brief Internal pieces of ts/src/generate/harmonize/nct.ts: reading an onset as the metric
 *        position it is playing.
 */
#ifndef CANTUS_SRC_GENERATE_HARMONIZE_NCT_H_
#define CANTUS_SRC_GENERATE_HARMONIZE_NCT_H_

namespace cantus {

/**
 * Read an onset as the metric position it is playing, snapping it to the pulse grid when it lies
 * within the tolerance a performance stays inside (`snapToPulse`).
 */
double snap_to_pulse(double beat, double pulse);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_HARMONIZE_NCT_H_
