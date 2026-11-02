/**
 * @file shared.h
 * @brief Internal pieces of ts/src/model/shared.ts: the typed helpers the model classes share.
 *
 * The helpers that read untyped caller data (`assertDataObject`, `copyPlain` and the like) belong
 * to the op layer, which sees the wire form (ops/codec_m1.h).
 */
#ifndef CANTUS_SRC_MODEL_SHARED_H_
#define CANTUS_SRC_MODEL_SHARED_H_

#include <optional>
#include <stdexcept>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "js/math.h"
#include "model/limits.gen.h"

namespace cantus {

/** A failed parse of another type, as the failure of this one (`parsed.ok ? ... : parsed`). */
template <class To, class From>
ParseResult<To> parse_failure_of(ParseResult<From>&& parsed) {
  try {
    std::move(parsed).unwrap();
  } catch (const InvalidInputError& e) {
    return ParseResult<To>::failure(e);
  } catch (const NoSolutionError& e) {
    return ParseResult<To>::failure(e);
  } catch (const BudgetExceededError& e) {
    return ParseResult<To>::failure(e);
  }
  throw std::logic_error("parse_failure_of: the parse succeeded");
}

/** Zero with its sign dropped, so `-0` never reaches the plain data (`withoutNegativeZero`). */
inline double without_negative_zero(double value) { return value == 0 ? 0 : value; }

/** Where the last of a run of spans ends, and never before beat 0 (`spanEnd`). */
template <class... Runs>
double span_end(const Runs&... runs) {
  double end = 0;
  auto scan = [&end](const auto& run) {
    for (const auto& span : run) {
      end = js::max(end, span.endBeat);
    }
  };
  (scan(runs), ...);
  return end;
}

/** A defensive copy of one note event, carrying only the fields a note holds. */
NoteEvent copy_note_event(const NoteEvent& note);

/**
 * The note events checked and copied in the order given; zero-length notes are accepted, as they
 * are everywhere on the analysis side.
 */
std::vector<NoteEvent> copy_checked_notes(const std::vector<NoteEvent>& notes,
                                          std::string_view name,
                                          std::optional<double> budget = std::nullopt);

/** `{...mine, ...theirs}` over the fields a caller named. */
template <class T>
void lay_over(std::optional<T>& mine, const std::optional<T>& theirs) {
  if (theirs) {
    mine = theirs;
  }
}

/**
 * A defensive copy of a time signature, checked the way every meter function checks it.
 * @throws InvalidInputError if the signature is not one the library accepts.
 */
TimeSignature copy_time_signature(const TimeSignature& ts,
                                  std::string_view name = "time signature");

/** Whether two signatures name the same meter, an absent grouping equal to an empty one. */
bool same_time_signature(const TimeSignature& a, const TimeSignature& b);

}  // namespace cantus

#endif  // CANTUS_SRC_MODEL_SHARED_H_
