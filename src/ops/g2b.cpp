// Op adapters of generate/motif, generate/ornament, generate/groove, generate/rhythm,
// generate/progression.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_g2b.h), in the TS order and with the TS names, then calls the typed
// function. A guard that returns its argument returns the wire value it was given, and a note a
// TS function copies with `{ ...note }` keeps every field the caller wrote on it, in its order.

#include <cmath>
#include <functional>
#include <limits>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/core/validation.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/groove/groove.h"
#include "generate/groove/limits.gen.h"
#include "generate/motif/limits.gen.h"
#include "generate/motif/motif.h"
#include "generate/ornament/ornament.h"
#include "generate/progression/limits.gen.h"
#include "generate/progression/progression.h"
#include "generate/rhythm/limits.gen.h"
#include "generate/rhythm/rhythm.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_g1.h"
#include "ops/codec_g2a.h"
#include "ops/codec_g2b.h"
#include "ops/codec_t1.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** A bag of the note-list options TS reads with its defaults: durations that never sound pass. */
json::Value default_note_options() { return json::Value(json::Object()); }

/** `opts.ts ?? DEFAULT_TS`, read as `meterAt(0, toMeterData(ts, 'ts'))`. */
/** `toMeterData(opts.ts ?? fallback, 'ts')`: the whole meter, a map included. */
MeterData read_meter_or(const json::Value& opts, const TimeSignature& fallback) {
  const json::Value* ts = opt_null_default(opts, "ts");
  return ts != nullptr ? read_meter_like(*ts, "ts") : MeterData(fallback);
}

TimeSignature read_ts_or(const json::Value& opts, const TimeSignature& fallback) {
  const json::Value* ts = opt_null_default(opts, "ts");
  return ts != nullptr ? meter_at(0, read_meter_like(*ts, "ts")) : meter_at(0, fallback);
}

/** The sounding notes of a wire list, and the wire notes they are, in order. */
struct Sounding {
  std::vector<NoteEvent> typed;
  json::Array wire;
};

Sounding sounding_of(const json::Value& events, const std::vector<NoteEvent>& checked) {
  Sounding out;
  out.typed = sounding_notes_only(checked);
  out.wire = drop_silent_notes(events).as_array();
  return out;
}

//--------------------------------------------------------------------------------------------
// generate/rhythm

void register_rhythm() {
  def("rhythmToNoteEvents", [](Args& a) -> json::Value {
    // Both fields are checked before any event is read.
    double pitch = assert_midi_pitch(a[1], "pitch");
    json::Value velocity =
        arg_or(a, 2, json::Value(static_cast<double>(RHYTHM_DEFAULT_NOTE_VELOCITY)));
    double checked_velocity = assert_integer(velocity, "velocity", 0, 127);
    const json::Array& given = assert_array(a[0], "events");
    std::vector<RhythmEvent> events;
    for (std::size_t index = 0; index < given.size(); ++index) {
      std::string name = "events[" + index_text(index) + "]";
      const json::Value& event = assert_record(given[index], name);
      RhythmEvent read;
      read.position = assert_range(get(event, "position"), -kMaxSafeInteger, kMaxSafeInteger,
                                   name + ".position");
      read.duration = assert_range(get(event, "duration"), -kMaxSafeInteger, kMaxSafeInteger,
                                   name + ".duration");
      events.push_back(read);
    }
    json::Value out = to_json(
        rhythm_to_note_events(events, static_cast<int>(pitch), static_cast<int>(checked_velocity)));
    // A guard that returns its argument returns the wire value (a -0 stays -0).
    for (json::Value& note : out.as_array()) {
      note.as_object().set("pitch", a[1]);
      note.as_object().set("velocity", velocity);
    }
    return out;
  });
  def("onsetWeightCurve", [](Args& a) -> json::Value {
    return onset_weight_curve(static_cast<int>(assert_integer(a[0], "weight", 0, 3)));
  });
  def("generateRhythm", [](Args& a) -> json::Value {
    // The meter is read once, here: the grid below is one repeated bar.
    const json::Value& asked = assert_options(a[1], "opts");
    TimeSignature meter = meter_at(0, read_meter_like(a[0], "ts"));
    json::Value bars = opt_or(asked, "bars", json::Value(static_cast<double>(RHYTHM_DEFAULT_BARS)));
    json::Value subdivision =
        opt_or(asked, "subdivision", json::Value(static_cast<double>(RHYTHM_DEFAULT_SUBDIVISION)));
    WireContext ctx = read_generation_context(a, get(asked, "ctx"));
    double checked_bars = assert_positive_int(bars, "rhythm bars");
    double checked_subdivision = assert_positive_int(subdivision, "rhythm subdivision");
    return to_json(generate_rhythm_with(meter, checked_bars, checked_subdivision, ctx.resolved));
  });
  def("rhythmDensity", [](Args& a) -> json::Value {
    const json::Array& events = assert_array(a[0], "events");
    // Read before the empty case, so a malformed meter is rejected whichever way the call leaves.
    double bar_beats = beats_per_bar(read_meter_like(a[1], "ts"));
    if (events.empty()) {
      return 0.0;
    }
    // `last?.position ?? 0` and `last?.duration ?? 0`.
    const json::Value& last = events.back();
    json::Value position = json::Value(0.0);
    json::Value duration = json::Value(0.0);
    if (!is_null_or_undefined(last)) {
      if (!is_null_or_undefined(get(last, "position"))) {
        position = get(last, "position");
      }
      if (!is_null_or_undefined(get(last, "duration"))) {
        duration = get(last, "duration");
      }
    }
    double span_beats = js::to_number(js::add(position, duration));
    double bars = span_beats / bar_beats;
    return bars > 0 ? static_cast<double>(events.size()) / bars : 0.0;
  });
}

//--------------------------------------------------------------------------------------------
// generate/groove

void register_groove() {
  def("humanize", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    // The meter is read once, here, and every position below is weighed against it.
    HumanizeRequest request;
    request.ts = read_meter_or(asked, kGenerateDefaultTs);
    std::vector<NoteEvent> events =
        assert_note_events(a[0], "humanize events", line_options(undefined_value()));
    Sounding sounding = sounding_of(a[0], events);
    json::Value timing = opt_or(asked, "timing", json::Value(GROOVE_DEFAULT_TIMING));
    json::Value velocity_jitter =
        opt_or(asked, "velocity", json::Value(GROOVE_DEFAULT_VELOCITY_JITTER));
    json::Value accent = opt_or(asked, "accent", json::Value(GROOVE_DEFAULT_ACCENT));
    json::Value base_velocity =
        opt_or(asked, "baseVelocity", json::Value(GROOVE_DEFAULT_BASE_VELOCITY));
    request.timing = assert_range(timing, 0, kMaxSafeInteger, "humanize timing");
    request.velocityJitter = assert_range(velocity_jitter, 0, 127, "humanize velocity jitter");
    request.accent = assert_range(accent, 0, 127, "humanize accent");
    request.baseVelocity = assert_range(base_velocity, 0, 127, "humanize base velocity");
    WireContext ctx = read_generation_context(a, get(asked, "ctx"));
    Draw draw = wire_part(ctx, opt_or(asked, "part", json::Value("humanize")));
    std::vector<NoteEvent> out = humanize_with(sounding.typed, request, draw);
    // A copy keeps every field the note carries; the pass writes its own over it.
    json::Array notes;
    for (std::size_t i = 0; i < out.size(); ++i) {
      json::Value note = sounding.wire[i];
      note.as_object().set("startBeat", out[i].startBeat);
      note.as_object().set("velocity", *out[i].velocity);
      notes.push_back(std::move(note));
    }
    return json::Value(std::move(notes));
  });
  def("extractGrooveTemplate", [](Args& a) -> json::Value {
    TimeSignature meter = groove_signature(read_meter_like(a[1], "ts"));
    std::vector<NoteEvent> events =
        assert_note_events(a[0], "groove source events", line_options(undefined_value()));
    double subdivision = assert_positive_int(
        arg_or(a, 2, json::Value(static_cast<double>(GROOVE_DEFAULT_SUBDIVISION))),
        "groove subdivision");
    return to_json(extract_groove_template(events, meter, static_cast<int>(subdivision)));
  });
  def("applyGrooveTemplate", [](Args& a) -> json::Value {
    TimeSignature meter = groove_signature(read_meter_like(a[2], "ts"));
    std::vector<NoteEvent> events =
        assert_note_events(a[0], "groove target events", line_options(undefined_value()));
    const json::Value& given = a[1];
    GrooveTemplate groove;
    double subdivision =
        assert_positive_int(property_of(given, "subdivision"), "template subdivision");
    double slots_per_bar =
        assert_positive_int(property_of(given, "slotsPerBar"), "template slotsPerBar");
    std::vector<json::Value> slots;
    json::Value length;
    const json::Value& listed = property_of(given, "slots");
    property_of(listed, "length");
    read_array_like(listed, slots, length);
    assert_generation_budget(length, "template slots", undefined_value());
    if (*number_of(length) != slots_per_bar) {
      throw InvalidInputError("template slots length must equal slotsPerBar");
    }
    const json::Value& template_ts = get(given, "ts");
    if (js::truthy(template_ts) &&
        (!js::strict_equals(get(template_ts, "numerator"), json::Value(meter.numerator)) ||
         !js::strict_equals(get(template_ts, "denominator"), json::Value(meter.denominator)))) {
      throw InvalidInputError("Groove template meter " +
                              format_time_signature(read_meter_like(template_ts, "ts")) +
                              " does not match apply-time meter " + format_time_signature(meter));
    }
    double bar_beats = beats_per_bar(meter);
    // `slotsPerBar` is what the grid is read through, so it has to be what this bar holds.
    double expected_slots = std::ceil(bar_beats * subdivision);
    if (slots_per_bar != expected_slots) {
      throw InvalidInputError("Groove template slotsPerBar " + js::to_string(slots_per_bar) +
                              " does not match " + js::to_string(expected_slots) +
                              " slots per bar of " + format_time_signature(meter) +
                              " at subdivision " + js::to_string(subdivision));
    }
    groove.subdivision = static_cast<int>(subdivision);
    groove.slotsPerBar = static_cast<int>(slots_per_bar);
    for (std::size_t index = 0; index < slots.size(); ++index) {
      const json::Value& slot = slots[index];
      GrooveSlot read;
      // A hole in the list is a slot that records nothing.
      if (!is_undefined(slot)) {
        std::string name = "template slots[" + index_text(index) + "]";
        read.timingOffset =
            assert_finite_number(property_of(slot, "timingOffset"), name + ".timingOffset");
        const json::Value& velocity = property_of(slot, "velocity");
        if (!is_null_or_undefined(velocity)) {
          read.velocity = assert_range(velocity, 0, 127, name + ".velocity");
        }
      }
      groove.slots.push_back(read);
    }
    // The template is checked; the notes are snapped to it in the numbers TS computes them in.
    Sounding sounding = sounding_of(a[0], events);
    std::vector<GroovedNote> out = groove_notes(sounding.typed, groove, meter);
    json::Array notes;
    for (std::size_t i = 0; i < out.size(); ++i) {
      json::Value note = sounding.wire[i];
      note.as_object().set("startBeat", out[i].startBeat);
      if (out[i].velocity) {
        note.as_object().set("velocity", *out[i].velocity);
      }
      notes.push_back(std::move(note));
    }
    return json::Value(std::move(notes));
  });
}

//--------------------------------------------------------------------------------------------
// generate/ornament

void register_ornament() {
  def("$const:ORNAMENT_STYLES", [](Args&) -> json::Value {
    return to_json(std::vector<OrnamentStyle>(ORNAMENT_STYLES.begin(), ORNAMENT_STYLES.end()));
  });
  def("ornament", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    std::vector<NoteEvent> events =
        assert_note_events(a[0], "ornament notes", line_options(undefined_value()));
    OrnamentStyle style = *parse_ornament_style(assert_one_of(
        opt_or(asked, "style", json::Value("ghost")), ornament_style_names(), "ornament style"));
    MeterData ts = read_meter_or(asked, kGenerateDefaultTs);
    std::optional<double> amount;
    if (const json::Value* given = opt_strict(asked, "amount")) {
      amount = assert_range(*given, 0, 1, "ornament amount");
    }
    // `resolveContextWith`: the context's own dial wins where both name it.
    WireContext ctx = read_generation_context(a, get(asked, "ctx"));
    if (!ctx.resolved.ornament) {
      ctx.resolved.ornament = amount;
    }
    Sounding sounding = sounding_of(a[0], events);
    std::vector<NoteEvent> out = ornament_with(sounding.typed, style, ts, ctx.resolved);
    json::Array notes;
    for (std::size_t i = 0; i < out.size(); ++i) {
      json::Value note = sounding.wire[i];
      // Only a note the pass decorated changes: one that carried an articulation is left alone.
      if (!sounding.typed[i].articulation && out[i].articulation) {
        note.as_object().set("articulation", to_string(*out[i].articulation));
        // A velocity the pass leaves as it was stays as the caller wrote it (a -0 included).
        if (out[i].velocity && out[i].velocity != sounding.typed[i].velocity) {
          note.as_object().set("velocity", *out[i].velocity);
        }
      }
      notes.push_back(std::move(note));
    }
    return json::Value(std::move(notes));
  });
}

//--------------------------------------------------------------------------------------------
// generate/motif

/** The pitches of a checked wire note list as written, a -0 included. */
std::vector<double> wire_pitches(const json::Value& notes) {
  std::vector<double> pitches;
  for (const json::Value& note : notes.as_array()) {
    pitches.push_back(*number_of(get(note, "pitch")));
  }
  return pitches;
}

/** `assertCellNotes(cell, name)`: the cell is a record, and its notes are a note-event array. */
std::vector<NoteEvent> read_cell_notes(const json::Value& cell, std::string_view name) {
  const json::Value& read = assert_record(cell, "motif cell");
  return assert_note_events(get(read, "notes"), name, default_note_options());
}

void register_motif() {
  def("generateMotif", [](Args& a) -> json::Value {
    const json::Value& opts = assert_record(a[0], "motif options");
    MotifPlan plan;
    plan.contour =
        *parse_motif_contour(assert_one_of(opt_or(opts, "contour", to_string(MotifContour::kArch)),
                                           motif_contour_names(), "motif contour"));
    plan.bars = assert_positive_int(get(opts, "bars"), "motif bars");
    // The meter is read once, here: a motif is one repeated bar grid.
    plan.barBeats = beats_per_bar(read_ts_or(opts, kGenerateDefaultTs));
    assert_generation_budget(json::Value(js::max(3.0, plan.bars * 2)), "motif notes",
                             undefined_value());
    // The dial is handed over as it was given: `jitter` is sugar for the context's ornament dial.
    WireContext ctx = read_generation_context(a, get(opts, "ctx"));
    std::optional<double> jitter;
    if (const json::Value* given = opt_strict(opts, "jitter")) {
      jitter = assert_range(*given, 0, 1, "complexity ornament");
    }
    if (!ctx.resolved.ornament) {
      ctx.resolved.ornament = jitter;
    }
    plan.key = read_key_like(get(opts, "key"));
    const json::Value& chord = get(opts, "chord");
    if (js::truthy(chord)) {
      ChordData read = read_chord_like(chord);
      plan.chord = read.chord;
      if (!known_chord_quality(get(read.wire, "quality"))) {
        plan.unknownChordQuality = js::string_of(get(read.wire, "quality"));
      }
    }
    return to_json(generate_motif_with(plan, ctx.resolved));
  });
  def("motifToNoteEvents", [](Args& a) -> json::Value {
    read_cell_notes(a[0], "motif cell notes");
    // `{ ...note }` copies each note whole.
    return get(a[0], "notes");
  });
  def("transformMotif", [](Args& a) -> json::Value {
    // The key is read into its plain form once, here at the boundary.
    std::optional<KeyScale> key;
    if (!a.undefined(3)) {
      key = read_key_like(a[3]);
    }
    std::vector<NoteEvent> notes = read_cell_notes(a[0], "motif notes");
    MotifTransform transform =
        *parse_motif_transform(assert_one_of(a[1], motif_transform_names(), "motif transform"));
    std::optional<double> amount;
    if (!a.undefined(2)) {
      amount = assert_finite_number(a[2], "motif transform amount");
      if (transform == MotifTransform::kTransposeChromatic ||
          transform == MotifTransform::kTransposeDiatonic ||
          transform == MotifTransform::kSequence) {
        assert_integer(a[2],
                       std::string(transform == MotifTransform::kTransposeChromatic ? "chromatic"
                                                                                    : "diatonic") +
                           " transform amount");
      }
      if ((transform == MotifTransform::kAugment || transform == MotifTransform::kDiminish) &&
          *amount <= 0) {
        throw InvalidInputError("time transform amount must be positive");
      }
    }
    std::vector<MotifResult> results =
        transform_notes(notes, wire_pitches(get(a[0], "notes")), transform, amount, key);
    json::Object cell;
    cell.set("notes", motif_notes_json(get(a[0], "notes").as_array(), results));
    return json::Value(std::move(cell));
  });
  def("developMotif", [](Args& a) -> json::Value {
    TimeSignature meter = meter_at(0, read_meter_like(a[4], "ts"));
    assert_wire_timeline(a[1]);
    double bars = assert_positive_int(a[3], "development bars");
    std::vector<NoteEvent> notes = read_cell_notes(a[0], "motif notes");
    KeyScale scale = read_key_like(a[2]);
    const Args* args = &a;
    json::Value timeline = a[1];
    ChordAt chord_at = [args, timeline](double beat) -> std::optional<ChordTones> {
      json::Value chord = timeline_at(*args, timeline, beat);
      if (!js::truthy(chord)) {
        return std::nullopt;
      }
      // The chord is read as `chordPitchClasses` reads it, when a position asks for its tones.
      return ChordTones([chord]() { return wire_chord_pitch_classes(chord); });
    };
    std::vector<MotifResult> results =
        develop_notes(notes, wire_pitches(get(a[0], "notes")), chord_at, scale, bars, meter);
    json::Object cell;
    cell.set("notes", motif_notes_json(get(a[0], "notes").as_array(), results));
    return json::Value(std::move(cell));
  });
}

//--------------------------------------------------------------------------------------------
// generate/progression

/** The names `opts.ext` may take: 'auto', then every chord quality. */
std::vector<std::string> extension_names() {
  std::vector<std::string> names{"auto"};
  for (ChordQuality quality : chord_qualities()) {
    names.emplace_back(to_string(quality));
  }
  return names;
}

/** A preset's style as the caller wrote it: the style it names, if the table has one. */
std::optional<ProgStyle> style_named(const json::Value& style) {
  return style.is_string() ? parse_prog_style(style.as_string()) : std::nullopt;
}

void register_progression() {
  def("$const:BORROWED_DEGREES", [](Args&) -> json::Value { return to_json(BORROWED_DEGREES); });
  def("progressions", [](Args&) -> json::Value { return to_json(progressions()); });
  def("progressionsByStyle", [](Args& a) -> json::Value {
    // A style name from a config file or a JavaScript caller is checked against the table.
    ProgStyle style = *parse_prog_style(assert_one_of(a[0], prog_style_names(), "style"));
    return to_json(progressions_by_style(style));
  });
  def("pickProgressionPreset", [](Args& a) -> json::Value {
    WireContext ctx = read_generation_context(a, arg_or(a, 1, json::Value(0.0)));
    return to_json(preset_for(style_named(a[0]), js::template_string(a[0]), ctx.resolved));
  });
  def("generateProgression", [](Args& a) -> json::Value {
    const json::Value& opts = assert_record(a[0], "progression options");
    ProgressionPlan plan;
    plan.bars = assert_positive_int(get(opts, "bars"), "progression bars");
    assert_generation_budget(get(opts, "bars"), "progression chords", undefined_value());
    // The key is resolved once, here at the boundary, so a tonic that contradicts it is refused.
    plan.key = resolve_key(read_key_arg(get(opts, "key"))).scale;
    WireContext ctx = read_generation_context(a, get(opts, "ctx"));
    std::optional<ProgressionPreset> preset;
    bool cadence_strong = false;
    const json::Value& given_preset = get(opts, "preset");
    if (!is_undefined(given_preset)) {
      const json::Value& custom = assert_record(given_preset, "progression preset");
      const json::Array& degrees =
          assert_array(get(custom, "degrees"), "progression preset degrees");
      if (degrees.empty()) {
        throw InvalidInputError("progression preset must name at least one degree");
      }
      ProgressionPreset read;
      for (std::size_t index = 0; index < degrees.size(); ++index) {
        const json::Value& given = degrees[index];
        double degree =
            assert_degree(given, "progression preset degrees[" + index_text(index) + "]");
        if (!((degree >= 1 && degree <= 7) || is_borrowed_degree(degree))) {
          throw InvalidInputError("progression preset degrees[" + index_text(index) +
                                  "] is not a supported progression degree; received " +
                                  js::to_string(degree));
        }
        read.degrees.push_back(static_cast<int>(degree));
      }
      read.functional = *parse_prog_function(
          assert_one_of(opt_or(custom, "functional", to_string(ProgFunction::kLoop)),
                        prog_function_names(), "progression preset functional"));
      cadence_strong = read.functional == ProgFunction::kCadenceStrong;
      preset = std::move(read);
    }
    const json::Value& preset_id = get(opts, "presetId");
    if (!preset && !is_undefined(preset_id)) {
      for (const ProgressionPreset& candidate : builtin_presets()) {
        if (js::strict_equals(json::Value(candidate.id), preset_id)) {
          preset = candidate;
          cadence_strong = candidate.functional == ProgFunction::kCadenceStrong;
          break;
        }
      }
      if (!preset) {
        throw InvalidInputError("Unknown progression preset: " + js::template_string(preset_id));
      }
    }
    if (!preset) {
      const json::Value& style = get(opts, "style");
      preset = preset_for(style_named(style), js::template_string(style), ctx.resolved);
      cadence_strong = preset->functional == ProgFunction::kCadenceStrong;
    }
    const json::Value& ext = get(opts, "ext");
    if (!is_undefined(ext)) {
      std::vector<std::string> names = extension_names();
      std::string picked(assert_one_of(
          ext, std::vector<std::string_view>(names.begin(), names.end()), "progression extension"));
      if (picked != "auto") {
        plan.ext = parse_chord_quality(picked);
      }
    }
    plan.degrees = preset->degrees;
    plan.cadenceStrong = cadence_strong;
    // One chord per bar of the meter the caller counts in.
    plan.barBeats = beats_per_bar(read_ts_or(opts, kGenerateDefaultTs));
    return to_json(generate_progression_with(plan, ctx.resolved));
  });
}

}  // namespace

void register_g2b() {
  register_rhythm();
  register_groove();
  register_ornament();
  register_motif();
  register_progression();
}

}  // namespace cantus::ops
