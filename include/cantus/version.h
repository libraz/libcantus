/**
 * @file version.h
 * @brief Library version. CMake configure fails when these disagree with ts/package.json.
 */
#ifndef CANTUS_VERSION_H_
#define CANTUS_VERSION_H_

#define CANTUS_VERSION_MAJOR 1
#define CANTUS_VERSION_MINOR 4
#define CANTUS_VERSION_PATCH 0
#define CANTUS_VERSION_STRING "1.4.0"

namespace cantus {

/** The library version, e.g. "1.3.0". */
inline constexpr const char* version() noexcept { return CANTUS_VERSION_STRING; }

}  // namespace cantus

#endif  // CANTUS_VERSION_H_
