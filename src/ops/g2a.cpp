// Op adapters of generate/bass, generate/countermelody.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_g2a.h), in the TS order and with the TS names, then calls the typed
// function. A guard that returns its argument returns the wire value it was given.

#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/generate/bass.h"
#include "cantus/generate/countermelody.h"
#include "core/validation/validation.h"
#include "generate/bass/bass.h"
#include "generate/bass/internal.h"
#include "generate/bass/licks.h"
#include "generate/bass/limits.gen.h"
#include "generate/context/limits.gen.h"
#include "generate/countermelody/countermelody.h"
#include "generate/vocabulary/types.h"
#include "js/format.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_c2.h"
#include "ops/codec_g1.h"
#include "ops/codec_g2a.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"
#include "theory/safety/weights.h"

namespace cantus::ops {

namespace {

//--------------------------------------------------------------------------------------------
// generate/bass

/** `opts.ts ?? DEFAULT_TS`, read as `meterAt(0, toMeterData(ts, 'ts'))`. */
TimeSignature read_ts_option(const json::Value& opts) {
  const json::Value* ts = opt_null_default(opts, "ts");
  return ts != nullptr ? meter_at(0, read_meter_like(*ts, "ts")) : meter_at(0, kBassDefaultTs);
}

/** `bassRegister(context.instrument('bass'), opts.instrument, octave)` over the wire. */
BassRegister read_bass_register(const WireContext& ctx, const json::Value& given, double octave) {
  // `given` is read first; the context's own instrument is read only when it is absent.
  std::optional<InstrumentProfileArg> instrument;
  std::optional<InstrumentProfile> named;
  if (!is_undefined(given)) {
    instrument = InstrumentProfileArg(read_instrument_profile(given, "instrument"));
  } else {
    named = read_named_stringed(ctx.instrument("bass"));
  }
  return bass_register(named, instrument, octave);
}

void register_bass() {
  def("$const:BASS_STYLES", [](Args&) -> json::Value {
    return to_json(std::vector<BassStyle>(BASS_STYLES.begin(), BASS_STYLES.end()));
  });
  def("$const:BASS_LICKS", [](Args&) -> json::Value { return to_json(BASS_LICKS); });
  def("isLickMaterial", [](Args& a) -> json::Value { return wire_is_lick_material(a[0]); });
  def("generateBassLine", [](Args& a) -> json::Value {
    const json::Value& opts = assert_record(a[0], "bass line options");
    const json::Array& placement = assert_array(get(opts, "segments"), "bass segments");
    assert_generation_budget(json::Value(static_cast<double>(placement.size())), "bass segments",
                             get(opts, "budget"));
    BassLineRequest request;
    request.segments = read_bass_segments(placement);
    if (request.segments.empty()) {
      return json::Value(json::Array());
    }
    request.ts = read_ts_option(opts);
    const json::Value* style = opt_null_default(opts, "style");
    request.style = *parse_bass_style(assert_one_of(style != nullptr ? *style : json::Value("root"),
                                                    bass_style_names(), "bass style"));
    const json::Value* given_octave = opt_null_default(opts, "octave");
    double octave = assert_integer(given_octave != nullptr
                                       ? *given_octave
                                       : json::Value(static_cast<double>(BASS_DEFAULT_OCTAVE)),
                                   "bass octave", -1, 8);
    assert_generation_budget(json::Value(estimated_bass_notes(request.segments)), "bass notes",
                             get(opts, "budget"));
    WireContext ctx = read_generation_context(a, get(opts, "ctx"));
    BassRegister bass = read_bass_register(ctx, get(opts, "instrument"), octave);
    request.instrument = bass.instrument;
    request.low = bass.low;
    request.key = read_key_like(get(opts, "key"));
    return to_json(generate_bass_line_with(request, ctx.resolved));
  });
  def("placeLicks", [](Args& a) -> json::Value {
    const json::Value& asked = assert_record(a[2], "opts");
    const json::Array& placement = assert_array(a[0], "timeline");
    assert_generation_budget(json::Value(static_cast<double>(placement.size())), "lick segments",
                             get(asked, "budget"));
    LickRequest request;
    request.genre = *parse_genre(assert_one_of(get(asked, "genre"), genre_names(), "lick genre"));
    request.ts = read_ts_option(asked);
    const json::Value* given_octave = opt_null_default(asked, "octave");
    double octave = assert_integer(given_octave != nullptr
                                       ? *given_octave
                                       : json::Value(static_cast<double>(BASS_DEFAULT_OCTAVE)),
                                   "lick octave", -1, 8);
    request.scale = read_key_like(a[1]);
    BassPlacement read = read_bass_placement(placement);
    request.segments = std::move(read.segments);
    request.qualities = std::move(read.qualities);
    if (request.segments.empty()) {
      return json::Value(json::Array());
    }
    assert_generation_budget(json::Value(estimated_lick_bars(request.segments, request.ts)),
                             "lick bars", get(asked, "budget"));
    WireContext ctx = read_generation_context(a, get(asked, "ctx"));
    // The caller's own ceiling is checked whether or not the context also names one.
    const json::Value& difficulty = get(asked, "difficulty");
    if (!is_undefined(difficulty)) {
      request.difficulty = assert_range(difficulty, CEILING_MIN_DIFFICULTY, CEILING_MAX_DIFFICULTY,
                                        "lick difficulty");
    }
    BassRegister bass = read_bass_register(ctx, get(asked, "instrument"), octave);
    request.instrument = bass.instrument;
    request.low = bass.low;
    ctx.resolved.vocabulary = read_lick_vocabulary(ctx.vocabulary);
    return to_json(place_licks_with(request, ctx.resolved));
  });
}

//--------------------------------------------------------------------------------------------
// generate/countermelody

/** The names of the safety profiles, for assert_one_of(). */
std::vector<std::string_view> safety_profile_names() {
  std::vector<std::string_view> names;
  for (const NamedProfileWeights& row : PROFILE_WEIGHTS) {
    names.push_back(row.name);
  }
  return names;
}

/** A chord a host or a timeline answered with: a falsy value is none (`chord && ...`). */
Nullable<Chord> read_host_chord_answer(const json::Value& answer) {
  if (!js::truthy(answer)) {
    return Nullable<Chord>();
  }
  return Nullable<Chord>(read_chord_fields(answer));
}

/** `assertWeightOverrides(opts.weights)`, and the overrides it accepted. */
ProfileWeightOverrides read_weight_overrides(const json::Value& weights) {
  ProfileWeightOverrides overrides;
  if (is_undefined(weights)) {
    return overrides;
  }
  if (js::type_of(weights) != "object" || weights.is_null()) {
    throw InvalidInputError(
        "countermelody weights must be an object of weight overrides; received " +
        describe_rejected(weights));
  }
  auto take = [&overrides](const std::string& field, const json::Value& value) {
    double number = assert_finite_number(value, "countermelody weights." + field);
    if (auto member = weight_override_member(field)) {
      overrides.*member = number;
    }
  };
  if (weights.is_array()) {
    const json::Array& list = weights.as_array();
    for (std::size_t index = 0; index < list.size(); ++index) {
      take(index_text(index), list[index]);
    }
    // `profileWeights` reads the overrides as a record once they are checked.
    throw InvalidInputError("overrides must be an object; received " + describe_rejected(weights));
  } else if (weights.is_object()) {
    for (const json::Member& member : weights.as_object()) {
      take(unescape_key(member.key), member.value);
    }
  }
  return overrides;
}

void register_countermelody() {
  def("generateCounterMelody", [](Args& a) -> json::Value {
    const json::Value& opts = assert_record(a[0], "countermelody options");
    CounterRequest request;
    const json::Value& timeline = get(opts, "timeline");
    // The raw chord-change beats: the timeline's own boundaries, or the caller's list.
    std::vector<json::Value> beats;
    json::Value beat_count;
    if (is_undefined(timeline)) {
      const json::Value& chord_at = get(opts, "chordAt");
      if (is_undefined(chord_at)) {
        throw InvalidInputError("countermelody needs a timeline or a chordAt callback");
      }
      const Args* args = &a;
      json::Value fn = chord_at;
      request.chord_at = [args, fn](double beat) -> Nullable<Chord> {
        if (is_timeline_hybrid(fn)) {
          return read_host_chord_answer(timeline_chord_at(get(fn, "segments").as_array(), beat));
        }
        if (tag_of(fn) != Tag::kCallback) {
          throw js::TypeError("harmony.chordAt is not a function");
        }
        return read_host_chord_answer(args->callback(fn)(json::Array{json::Value(beat)}));
      };
      const json::Value* given = opt_null_default(opts, "chordChangeBeats");
      if (given != nullptr) {
        read_array_like(*given, beats, beat_count);
      } else {
        beat_count = json::Value(0.0);
      }
    } else {
      const json::Value& listed = property_of(timeline, "segments");
      if (is_null_or_undefined(listed)) {
        throw js::TypeError(std::string("Cannot read properties of ") +
                            (listed.is_null() ? "null" : "undefined") + " (reading 'flatMap')");
      }
      if (!listed.is_array()) {
        throw js::TypeError("timeline.segments.flatMap is not a function");
      }
      for (const json::Value& segment : listed.as_array()) {
        beats.push_back(property_of(segment, "startBeat"));
        beats.push_back(property_of(segment, "endBeat"));
      }
      beat_count = json::Value(static_cast<double>(beats.size()));
      const Args* args = &a;
      json::Value held = timeline;
      request.chord_at = [args, held](double beat) -> Nullable<Chord> {
        if (is_timeline_hybrid(held)) {
          return read_host_chord_answer(timeline_chord_at(get(held, "segments").as_array(), beat));
        }
        const json::Value& at = get(held, "at");
        if (tag_of(at) != Tag::kCallback) {
          throw js::TypeError("timeline.at is not a function");
        }
        return read_host_chord_answer(args->callback(at)(json::Array{json::Value(beat)}));
      };
    }
    // `register` is compared, not checked: any name but 'below' and 'above' selects neither side.
    const json::Value* given_side = opt_null_default(opts, "register");
    json::Value side = given_side != nullptr ? *given_side : json::Value("below");
    request.side = js::strict_equals(side, json::Value("below"))   ? CounterSide::kBelow
                   : js::strict_equals(side, json::Value("above")) ? CounterSide::kAbove
                                                                   : CounterSide::kOther;
    request.melody = assert_note_events(get(opts, "melody"), "countermelody melody",
                                        line_options(undefined_value()));
    request.ts = meter_at(0, [&opts]() {
      const json::Value* ts = opt_null_default(opts, "ts");
      return ts != nullptr ? read_meter_like(*ts, "ts") : MeterData(kCounterDefaultTs);
    }());
    cantus::assert_time_signature(request.ts);
    const json::Value* rhythm = opt_null_default(opts, "rhythm");
    request.rhythm = *parse_counter_rhythm(assert_one_of(
        rhythm != nullptr ? *rhythm : json::Value("complement"), counter_rhythm_names(), "rhythm"));
    const json::Value* profile = opt_null_default(opts, "profile");
    request.profile =
        *parse_safety_profile(assert_one_of(profile != nullptr ? *profile : json::Value("pop"),
                                            safety_profile_names(), "safety profile"));
    ProfileWeightOverrides overrides = read_weight_overrides(get(opts, "weights"));
    request.weights = profile_weights(request.profile, overrides);
    request.key = read_key_like(get(opts, "key"));
    WireContext ctx = read_generation_context(a, get(opts, "ctx"));

    request.change_beats.clear();
    for (const json::Value& beat : beats) {
      request.change_beats.push_back(number_of(beat).value_or(std::nan("")));
    }
    request.assert_change_beats = [beats, beat_count]() {
      assert_generation_budget(beat_count, "chord change beats", undefined_value());
      for (std::size_t index = 0; index < beats.size(); ++index) {
        // `chordChangeBeats[index] ?? NaN`: a hole or a null reads as NaN.
        json::Value beat =
            is_null_or_undefined(beats[index]) ? json::Value(std::nan("")) : beats[index];
        assert_range(beat, 0, kMaxSafeInteger, "chordChangeBeats[" + index_text(index) + "]");
      }
    };
    json::Value low = get(opts, "pitchLow");
    json::Value high = get(opts, "pitchHigh");
    request.pitch_low = [low](double fallback) {
      return clamp_to_midi(is_null_or_undefined(low) ? json::Value(fallback) : low,
                           "countermelody pitchLow");
    };
    request.pitch_high = [high](double fallback) {
      return clamp_to_midi(is_null_or_undefined(high) ? json::Value(fallback) : high,
                           "countermelody pitchHigh");
    };
    return to_json(generate_counter_melody_with(request, ctx.resolved));
  });
  def("imitate", [](Args& a) -> json::Value {
    std::vector<NoteEvent> lead =
        assert_note_events(a[0], "imitate lead", line_options(undefined_value()));
    const json::Value& opts = assert_record(a[1], "opts");
    ImitationPlan plan;
    // Onsets are unbounded below library-wide, because a pickup sounds before the downbeat.
    plan.atBeat = assert_finite_number(get(opts, "atBeat"), "atBeat");
    plan.interval = read_interval_like(get(opts, "interval"));
    plan.key = read_key_like(get(opts, "key"));
    plan.from = -std::numeric_limits<double>::infinity();
    plan.to = std::numeric_limits<double>::infinity();
    if (const json::Value* present = opt_strict(opts, "from")) {
      plan.from = assert_finite_number(*present, "from");
    }
    if (const json::Value* present = opt_strict(opts, "to")) {
      plan.to = assert_finite_number(*present, "to");
    }
    if (plan.from > plan.to) {
      throw InvalidInputError("imitate needs from <= to; received " + js::to_string(plan.from) +
                              " > " + js::to_string(plan.to));
    }
    const json::Value* scale = opt_null_default(opts, "velocityScale");
    plan.velocityScale =
        assert_finite_number(scale != nullptr ? *scale : json::Value(1.0), "velocityScale");
    const json::Value* answer = opt_null_default(opts, "answer");
    plan.tonal = *parse_imitation_answer(assert_one_of(
                     answer != nullptr ? *answer : json::Value("real"), imitation_answer_names(),
                     "imitate answer")) == ImitationAnswer::kTonal;
    const json::Value* invert = opt_null_default(opts, "invert");
    plan.invert = invert != nullptr && js::truthy(*invert);
    // The answer keeps every field the lead's notes carry, in the order they carry them.
    json::Value sounding_wire = drop_silent_notes(a[0]);
    std::vector<NoteEvent> sounding = sounding_notes_only(lead);
    std::vector<std::size_t> subject = imitation_subject(sounding, plan.from, plan.to);
    std::vector<NoteEvent> answers = imitation_answers(sounding, subject, plan);
    json::Array out;
    for (std::size_t at = 0; at < subject.size(); ++at) {
      json::Value note = sounding_wire.as_array()[subject[at]];
      note.as_object().set("pitch", answers[at].pitch);
      note.as_object().set("startBeat", answers[at].startBeat);
      if (!is_undefined(get(note, "velocity"))) {
        note.as_object().set("velocity", *answers[at].velocity);
      }
      out.push_back(std::move(note));
    }
    return json::Value(std::move(out));
  });
}

}  // namespace

void register_g2a() {
  register_bass();
  register_countermelody();
}

}  // namespace cantus::ops
