#include "ops/codec_a4.h"

#include <memory>
#include <optional>
#include <string>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1a.h"
#include "ops/codec_t1.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

void write_fields(const ArrangementAnalysis& v, FieldWriter& w) {
  w.field("keys", v.keys);
  w.field("prevailingKey", scale_first(v.prevailingKey));
  w.field("timeline", v.timeline);
  w.field("segmentConfidence", v.segmentConfidence);
  w.field("cadences", v.cadences);
  w.field("tracks", v.tracks);
  w.field("conflicts", v.conflicts);
}

SafetyProfile read_arrangement_profile(const json::Value& opts) {
  return *parse_safety_profile(
      assert_one_of(opt_or(opts, "profile", to_string(SafetyProfile::kPop)),
                    std::vector<std::string_view>{to_string(SafetyProfile::kStrict),
                                                  to_string(SafetyProfile::kPop)},
                    "arrangement profile"));
}

TimelineHost wire_timeline_host(const Args& a, const json::Value& timeline) {
  // `timeline.at(beat)` is asked as often as TS asks it, so the callback is resolved once.
  std::shared_ptr<WireSegments> segments;
  std::optional<Callback> at;
  const json::Value* source = nullptr;
  if (is_timeline_hybrid(timeline)) {
    source = &timeline;
  } else {
    const json::Value& method = get(timeline, "at");
    if (is_timeline_hybrid(method)) {
      source = &method;
    } else if (js::type_of(method) == "function") {
      at = a.callback(method);
    } else {
      throw js::TypeError("timeline.at is not a function");
    }
  }
  const json::Value& listed = get(timeline, "segments");
  if (!listed.is_array()) {
    throw InvalidInputError("timeline.segments must be an array; received " +
                            describe_rejected(listed));
  }
  segments = std::make_shared<WireSegments>(listed.as_array());
  const json::Array* own = nullptr;
  if (source != nullptr) {
    const json::Value& payload = get(*source, "segments");
    if (!payload.is_array()) {
      throw InvalidInputError("timeline.segments must be an array; received " +
                              describe_rejected(payload));
    }
    own = &payload.as_array();
  }
  auto chord_at = [at, own](double beat) -> json::Value {
    return own != nullptr ? timeline_chord_at(*own, beat) : (*at)(json::Array{json::Value(beat)});
  };

  TimelineHost host;
  host.spans = segments->spans();
  host.chords = segments->reads();
  host.voice_at = [chord_at](double beat) { return read_host_chord(chord_at(beat)); };
  const CallContext* context = &a.context();
  host.found_at = [chord_at, context](double beat) -> std::optional<FoundChord> {
    auto wire = std::make_shared<const json::Value>(chord_at(beat));
    if (!js::truthy(*wire)) {
      return std::nullopt;
    }
    // `functionOf` reads the chord it is handed through `toChordData`, once, and every reading
    // of it goes through a guard that refuses a quality no table has.
    auto checked = std::make_shared<std::optional<ChordData>>();
    FoundChord found;
    found.raw = read_chord_fields(*wire);
    found.checked = [wire, checked]() -> const Chord& {
      if (!*checked) {
        ChordData data = read_chord_like(*wire);
        settle_chord_quality(data);
        *checked = std::move(data);
      }
      return (*checked)->chord;
    };
    // `chordPitchClasses` is the op itself: it checks the chord the way the public function does.
    found.pitch_classes = [wire, context]() {
      json::Array arguments;
      arguments.push_back(*wire);
      Args delegated(arguments, *context);
      json::Value out = find_op("chordPitchClasses")->fn(delegated);
      std::vector<int> pcs;
      for (const json::Value& pc : out.as_array()) {
        pcs.push_back(static_cast<int>(*number_of(pc)));
      }
      return pcs;
    };
    return found;
  };
  // The segments live in the caller's value; the host keeps the reader of them alive.
  auto keep = segments;
  host.chords = ChordReads{[keep](std::size_t i) -> const Chord& { return keep->raw(i); },
                           [keep](std::size_t i) -> const Chord& { return keep->checked(i); },
                           [keep](std::size_t i) { return keep->root_pc(i); },
                           [keep](std::size_t i) { keep->scan_dominant(i); },
                           [keep](std::size_t i) { keep->check_pitch_classes(i); },
                           [keep](std::size_t i) { keep->scan_six_four(i); }};
  return host;
}

}  // namespace cantus::ops
