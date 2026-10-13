/**
 * @file detect.h
 * @brief Internal entry points of ts/src/analyze/detect/index.ts beside the public API in
 *        cantus/analyze/detect.h.
 */
#ifndef CANTUS_SRC_ANALYZE_DETECT_DETECT_H_
#define CANTUS_SRC_ANALYZE_DETECT_DETECT_H_

#include <vector>

#include "analyze/detect/profiles.h"
#include "cantus/analyze/detect.h"

namespace cantus {

/**
 * detect_key() with the profile resolved by `profile_source` at the point the analysis first
 * needs it (`opts.profile` is not read).
 */
std::vector<KeyMatch> detect_key_over(const std::vector<int>& pitches, const DetectKeyOptions& opts,
                                      const ProfileSource& profile_source);

/** detect_key_from_notes() with the profile resolved by `profile_source`. */
std::vector<KeyMatch> detect_key_from_notes_over(const std::vector<NoteEvent>& notes,
                                                 const DetectKeyFromNotesOptions& opts,
                                                 const ProfileSource& profile_source);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_DETECT_DETECT_H_
