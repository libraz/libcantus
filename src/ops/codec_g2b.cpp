#include "ops/codec_g2b.h"

#include <string>
#include <utility>

#include "cantus/core/random.h"
#include "js/format.h"
#include "ops/codec_a2.h"
#include "ops/codec_c2.h"
#include "ops/validate.h"

namespace cantus::ops {

Draw wire_part(const WireContext& ctx, const json::Value& name) {
  json::Array prefix{name, json::Value("v"),
                     json::Value(static_cast<double>(ctx.resolved.algorithmVersion))};
  CallContext none;
  Args view(prefix, none);
  SeedPath path = read_seed_path(view, 0);
  if (ctx.resolved.rng) {
    return Draw(*ctx.resolved.rng, std::move(path));
  }
  return Draw(PositionalRng(derive_seed(ctx.resolved.seed, path)));
}

json::Value timeline_at(const Args& a, const json::Value& timeline, double beat) {
  if (is_timeline_hybrid(timeline)) {
    return timeline_chord_at(get(timeline, "segments").as_array(), beat);
  }
  const json::Value& at = get(timeline, "at");
  if (is_timeline_hybrid(at)) {
    return timeline_chord_at(get(at, "segments").as_array(), beat);
  }
  if (tag_of(at) != Tag::kCallback) {
    throw js::TypeError("timeline.at is not a function");
  }
  return a.callback(at)(json::Array{json::Value(beat)});
}

std::vector<int> wire_chord_pitch_classes(const json::Value& chord) {
  assert_chord(chord);
  assert_options(undefined_value(), "opts");
  assert_mask_inputs(chord);
  return chord_pitch_classes(read_chord_fields(chord));
}

json::Value motif_notes_json(const json::Array& source, const std::vector<MotifResult>& results) {
  json::Array out;
  for (const MotifResult& result : results) {
    json::Value note;
    if (result.source) {
      note = source[*result.source];
      json::Object& fields = note.as_object();
      fields.set("pitch", result.pitch);
      fields.set("startBeat", result.startBeat);
      fields.set("durationBeat", result.durationBeat);
    } else {
      json::Object fields;
      fields.set("pitch", result.pitch);
      fields.set("startBeat", result.startBeat);
      fields.set("durationBeat", result.durationBeat);
      note = json::Value(std::move(fields));
    }
    out.push_back(std::move(note));
  }
  return json::Value(std::move(out));
}

}  // namespace cantus::ops
