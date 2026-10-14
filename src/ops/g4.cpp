// Op adapters of generate/harmonize, generate/reharmony.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h), in the TS order and with the TS names, then calls the typed function.

#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "generate/harmonize/candidates.h"
#include "generate/harmonize/harmonize.h"
#include "generate/reharmony/reharmony.h"
#include "js/format.h"
#include "js/math.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_c1.h"
#include "ops/codec_g1.h"
#include "ops/codec_g4.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

bool nullish(const json::Value& v) { return v.is_null() || is_undefined(v); }

/** `opts.x ?? fallback`. */
json::Value value_or(const json::Value& opts, std::string_view key, const json::Value& fallback) {
  const json::Value& given = get(opts, key);
  return nullish(given) ? fallback : given;
}

/** `for (const end of phraseEnds) assertFiniteNumber(end, ...)` over `opts.phraseEnds ?? []`. */
std::vector<double> read_phrase_ends(const json::Value& given) {
  std::vector<double> ends;
  if (nullish(given)) {
    return ends;
  }
  if (given.is_array()) {
    for (const json::Value& end : given.as_array()) {
      ends.push_back(assert_finite_number(end, "harmonize phrase end"));
    }
    return ends;
  }
  if (given.is_string() && !given.as_string().empty()) {
    // A string iterates by character, and the first one is not a number.
    assert_finite_number(json::Value(js::utf16_slice(given.as_string(), 0, 1)),
                         "harmonize phrase end");
  }
  if (given.is_string()) {
    // An empty string has nothing to iterate; it fails where the grid is cut, which has no
    // `filter` to call on it (see the budget hook below).
    return ends;
  }
  throw js::TypeError("phraseEnds is not iterable");
}

}  // namespace

void register_g4() {
  def("classifyMelodyTones", [](Args& a) -> json::Value {
    MeterData ts = read_meter_like(a[1], "ts");
    json::Object bag;
    bag.set("allowNonPositiveDuration", true);
    std::vector<NoteEvent> melody =
        assert_note_events(a[0], "melody notes", json::Value(std::move(bag)));
    return to_json(classify_melody_tones(melody, MeterArg(ts)));
  });
  def("harmonizeMelody", [](Args& a) -> json::Value {
    const json::Value& opts = assert_record(a[0], "harmonize options");
    std::vector<NoteEvent> melody = assert_note_events(get(opts, "melody"), "harmonize melody",
                                                       line_options(get(opts, "budget")));
    std::vector<double> phrase_ends = read_phrase_ends(get(opts, "phraseEnds"));
    std::vector<NoteEvent> sounding = sounding_notes_only(melody);
    MeterData meter = read_meter_like(value_or(opts, "ts", json::Value("4/4")), "ts");
    TimeSignature ts = meter_at(0, MeterArg(meter));
    assert_time_signature(ts);
    const json::Value& requested = get(opts, "key");
    bool infer = nullish(requested) || (requested.is_string() && requested.as_string() == "infer");
    ResolvedKey key = resolve_key(infer ? KeyArg(infer_key(sounding)) : read_key_arg(requested));
    json::Value placement = value_or(opts, "placement", json::Value(json::Object()));
    WireContext ctx = read_generation_context(a, get(opts, "ctx"));
    std::string strength = assert_one_of(value_or(opts, "reharmonize", json::Value("diatonic")),
                                         reharmonize_strength_names(), "reharmonize");
    double harmonic =
        ctx.resolved.harmonic.value_or(reharmonize_dial(*parse_reharmonize_strength(strength)));

    HarmonizeRequest request(std::move(melody), std::move(sounding), ctx.resolved.part("harmony"));
    request.phraseEnds = std::move(phrase_ends);
    request.ts = ts;
    request.key = std::move(key);
    request.placement.transposeSearch = js::truthy(get(placement, "transposeSearch"));
    request.placement.octaveSearch = js::truthy(get(placement, "octaveSearch"));
    request.harmonic = harmonic;
    json::Value rhythm = get(opts, "harmonicRhythm");
    request.harmonicRhythm = [rhythm](const TimeSignature& signature) {
      return assert_range(
          nullish(rhythm) ? json::Value(default_harmonic_rhythm(signature)) : rhythm,
          std::numeric_limits<double>::denorm_min(), kMaxSafeInteger, "harmonic rhythm");
    };
    json::Value budget = get(opts, "budget");
    // The grid is cut by `phraseEnds.filter(...)`, right after its length is charged.
    bool string_ends = get(opts, "phraseEnds").is_string();
    request.charge = [budget, string_ends](double estimated, std::string_view name) {
      assert_generation_budget(json::Value(estimated), name, budget);
      if (string_ends && name == "harmonic segments") {
        throw js::TypeError("phraseEnds.filter is not a function");
      }
    };
    return to_json(harmonize_with(request));
  });
  def("substituteChord", [](Args& a) -> json::Value {
    json::Value bag = arg_or(a, 2, json::Object());
    const json::Value& opts = assert_options(bag, "opts");
    ChordData data = read_chord_like(a[0]);
    ResolvedKey key = resolve_key(read_key_arg(a[1]));
    json::Value pcs = get(opts, "melodyPcs");
    return to_json(substitute_chord_with(
        data.chord, key, [&data] { settle_chord_quality(data); },
        [&pcs]() -> std::optional<std::vector<int>> {
          if (nullish(pcs)) {
            return std::nullopt;
          }
          if (!pcs.is_array()) {
            throw js::TypeError("opts?.melodyPcs?.map is not a function");
          }
          std::vector<int> out;
          for (const json::Value& pc : pcs.as_array()) {
            out.push_back(pitch_class_of(assert_finite_number(pc, "pitch")));
          }
          return out;
        }));
  });
  def("modalInterchangePalette", [](Args& a) -> json::Value {
    return to_json(modal_interchange_palette(KeyArg(resolve_key(read_key_arg(a[0])))));
  });
  def("negativeHarmonyMirror", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    ResolvedKey key = resolve_key(read_key_arg(a[1]));
    // Every reading of the chord goes through a guard that refuses a quality no table has.
    settle_chord_quality(data);
    return to_json(negative_harmony_mirror(data.chord, KeyArg(key)));
  });
}

}  // namespace cantus::ops
