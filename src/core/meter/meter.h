/**
 * @file meter.h
 * @brief Internal entry points of ts/src/core/meter/index.ts beside the public API.
 */
#ifndef CANTUS_SRC_CORE_METER_METER_H_
#define CANTUS_SRC_CORE_METER_METER_H_

#include <string_view>

#include "cantus/core/meter.h"

namespace cantus {

/** to_meter_data() without the copy (`readMeterData`). */
MeterData read_meter_data(const MeterArg& value, std::string_view name = "meter");

/** Longest grid step landing on every main pulse and change the meter states (`metricGridUnit`). */
double metric_grid_unit(const MeterArg& meter);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_METER_METER_H_
