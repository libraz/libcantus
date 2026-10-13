/**
 * @file internal.h
 * @brief Meter arithmetic shared by the meter module and the validation guards
 *        (ts/src/core/meter/internal.ts).
 *
 * Nothing here validates. The TS module caches each map's bar index against the map's identity;
 * the C++ side derives it per question instead, which changes no result.
 */
#ifndef CANTUS_SRC_CORE_METER_INTERNAL_H_
#define CANTUS_SRC_CORE_METER_INTERNAL_H_

#include <cstddef>
#include <optional>
#include <vector>

#include "cantus/core/meter.h"

namespace cantus {

/** Length of one denominator unit in quarter-note beats. */
double unit_beats_of(const TimeSignature& ts);

/** A multiple of three greater than three. */
bool is_compound_numerator(double numerator);

/** Sum of an additive grouping, or nullopt when there is none. */
std::optional<double> grouping_sum_of(const TimeSignature& ts);

/** Whether the grouping counts denominator units rather than compound pulses. */
bool is_additive_reading(const TimeSignature& ts);

/** Main pulses per bar under the signature's effective reading. */
double pulse_count_of(const TimeSignature& ts);

/** Length of one main pulse in quarter-note beats. */
double pulse_beats_of(const TimeSignature& ts);

/** The grouping measured in main pulses, or nullopt. */
std::optional<std::vector<double>> pulse_grouping_of(const TimeSignature& ts);

/** Length of a bar in quarter-note beats. */
double bar_beats_of(const TimeSignature& ts);

/** Index of the map entry in force at a beat. */
std::size_t entry_index_of(const MeterMap& map, double beat);

/** Absolute beat at which the bar containing `beat` begins. */
double bar_start_of(const MeterMap& map, double beat);

/** Length of the bar containing `beat`, shortened by a following change. */
double bar_length_of(const MeterMap& map, double beat);

/** Bar index of a beat, counting the bar at beat 0 as bar 0. */
double bar_index_of(const MeterMap& map, double beat);

/** Absolute beat at which bar `bar_index` begins. */
double beat_of_bar_index(const MeterMap& map, double bar_index);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_METER_INTERNAL_H_
