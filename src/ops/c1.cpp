// Op adapters of core (layer root), core/validation, core/instrument, core/meter.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_c1.h), in the TS order and with the TS names, then calls the typed
// function. A guard that returns its argument returns the wire value it was given.

#include <limits>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_c1.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** A `{bar, beat}` position read as barPositionToPulse / barPositionToBeat read it. */
BarPosition read_bar_position(const json::Value& pos, std::string_view name,
                              std::string_view bar_name, std::string_view beat_name) {
  const json::Value& position = assert_record(pos, name);
  double bar = assert_integer(get(position, "bar"), bar_name);
  double beat = assert_finite_number(get(position, "beat"), beat_name);
  return BarPosition{bar, beat};
}

void register_validation() {
  def("$const:DEFAULT_GENERATION_BUDGET",
      [](Args&) -> json::Value { return to_json(DEFAULT_GENERATION_BUDGET); });
  def("assertFiniteNumber", [](Args& a) -> json::Value {
    with_name_arg(a, 1, [&](const std::string& name) { assert_finite_number(a[0], name); });
    return a.take(0);
  });
  def("assertInteger", [](Args& a) -> json::Value {
    with_name_arg(a, 1, [&](const std::string& name) {
      assert_integer(a[0], name, arg_or(a, 2, -kMaxSafeInteger), arg_or(a, 3, kMaxSafeInteger));
    });
    return a.take(0);
  });
  def("assertMidiPitch", [](Args& a) -> json::Value {
    with_name_arg(a, 1, "MIDI pitch",
                  [&](const std::string& name) { assert_midi_pitch(a[0], name); });
    return a.take(0);
  });
  def("clampToMidi", [](Args& a) -> json::Value {
    return to_json(with_name_arg(
        a, 1, "MIDI pitch", [&](const std::string& name) { return clamp_to_midi(a[0], name); }));
  });
  def("assertDegree", [](Args& a) -> json::Value {
    with_name_arg(a, 1, "degree", [&](const std::string& name) { assert_degree(a[0], name); });
    return a.take(0);
  });
  def("assertFiniteSemitones", [](Args& a) -> json::Value {
    with_name_arg(a, 1, "semitones",
                  [&](const std::string& name) { assert_finite_semitones(a[0], name); });
    return a.take(0);
  });
  def("dropSilentNotes", [](Args& a) -> json::Value { return drop_silent_notes(a.take(0)); });
  def("soundingNotesOnly", [](Args& a) -> json::Value { return drop_silent_notes(a.take(0)); });
  def("assertOneOf", [](Args& a) -> json::Value {
    assert_one_of(a[0], a[1], name_arg(a, 2));
    return a.take(0);
  });
  def("assertPositiveInt", [](Args& a) -> json::Value {
    with_name_arg(a, 1, [&](const std::string& name) {
      assert_positive_int(a[0], name, arg_or(a, 2, static_cast<double>(DEFAULT_GENERATION_BUDGET)));
    });
    return a.take(0);
  });
  def("assertRange", [](Args& a) -> json::Value {
    with_name_arg(a, 3, [&](const std::string& name) { assert_range(a[0], a[1], a[2], name); });
    return a.take(0);
  });
  def("assertGenerationBudget", [](Args& a) -> json::Value {
    assert_generation_budget(a[0], name_arg(a, 1), a[2]);
    return a.take(0);
  });
  def("assertTimeSignature", [](Args& a) -> json::Value {
    assert_time_signature(a[0], name_arg(a, 1, "time signature"));
    return a.take(0);
  });
  def("assertMeterMap", [](Args& a) -> json::Value {
    assert_meter_map(a[0], name_arg(a, 1, "meters"));
    return a.take(0);
  });
  def("assertNoteEvent", [](Args& a) -> json::Value {
    assert_note_event(a[0], name_arg(a, 1, "note event"), arg_or(a, 2, json::Object()));
    return a.take(0);
  });
  def("assertNoteEvents", [](Args& a) -> json::Value {
    assert_note_events(a[0], name_arg(a, 1, "note events"), arg_or(a, 2, json::Object()));
    return a.take(0);
  });
}

void register_instrument() {
  def("$const:ARTICULATIONS", [](Args&) -> json::Value {
    return to_json(std::vector<Articulation>(ARTICULATIONS.begin(), ARTICULATIONS.end()));
  });
  def("$const:LIMBS",
      [](Args&) -> json::Value { return to_json(std::vector<Limb>(LIMBS.begin(), LIMBS.end())); });
  def("$const:BASS_4_STRING", [](Args&) -> json::Value { return to_json(BASS_4_STRING); });
  def("$const:BASS_5_STRING", [](Args&) -> json::Value { return to_json(BASS_5_STRING); });
  def("$const:GUITAR_STANDARD", [](Args&) -> json::Value { return to_json(GUITAR_STANDARD); });
  def("$const:GUITAR_DROP_D", [](Args&) -> json::Value { return to_json(GUITAR_DROP_D); });
  def("toInstrumentProfile", [](Args& a) -> json::Value {
    with_name_arg(a, 1, "instrument", [&](const std::string& name) {
      to_instrument_profile(read_instrument_profile(a[0], name), name);
    });
    return like_data(a.take(0));
  });
  def("toStringedProfile", [](Args& a) -> json::Value {
    with_name_arg(a, 1, "instrument", [&](const std::string& name) {
      to_stringed_profile(read_instrument_profile(a[0], name), name);
    });
    return like_data(a.take(0));
  });
  def("instrumentRange", [](Args& a) -> json::Value {
    return to_json(instrument_range(read_instrument_profile(a[0])));
  });
  def("canSound", [](Args& a) -> json::Value {
    InstrumentProfile profile = read_instrument_profile(a[0], "instrument");
    auto pitch = static_cast<int>(assert_midi_pitch(a[1], "pitch"));
    return to_json(can_sound(profile, pitch));
  });
  def("fingeringsFor", [](Args& a) -> json::Value {
    InstrumentProfile profile = read_instrument_profile(a[0], "instrument");
    to_stringed_profile(profile, "instrument");
    auto pitch = static_cast<int>(assert_midi_pitch(a[1], "pitch"));
    return to_json(fingerings_for(profile, pitch));
  });
  def("foldIntoRange", [](Args& a) -> json::Value {
    InstrumentProfile profile = read_instrument_profile(a[1], "instrument");
    auto pitch = static_cast<int>(assert_midi_pitch(a[0], "pitch"));
    return to_json(fold_into_range(pitch, profile));
  });
  def("playability", [](Args& a) -> json::Value {
    NoteEventAssertOptions note_options;
    note_options.allowNonPositiveDuration = true;
    std::vector<NoteEvent> notes = assert_note_events(a[0], "playability notes", note_options);
    std::optional<double> bpm;
    if (!a.undefined(2)) {
      bpm = assert_range(a[2], kMinValue, 1000, "playability bpm");
    }
    InstrumentProfile profile = read_instrument_profile(a[1], "playability profile");
    return to_json(playability(notes, profile, bpm));
  });
}

void register_meter() {
  def("parseTimeSignature", [](Args& a) -> json::Value {
    if (!a[0].is_string()) {
      throw InvalidInputError("time signature must be a string; received " + js::type_of(a[0]));
    }
    return to_json(parse_time_signature(a[0].as_string()));
  });
  def("tryParseTimeSignature", [](Args& a) -> json::Value {
    if (!a[0].is_string()) {
      return to_json(ParseResult<TimeSignature>::failure(
          InvalidInputError("time signature must be a string; received " + js::type_of(a[0]))));
    }
    return to_json(try_parse_time_signature(a[0].as_string()));
  });
  def("toMeterData", [](Args& a) -> json::Value {
    std::string name = name_arg(a, 1, "meter");
    return to_json(to_meter_data(read_meter_like(a[0], name), name));
  });
  def("formatTimeSignature", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    FormatTimeSignatureOptions opts;
    const json::Value& grouping = get(asked, "grouping");
    if (grouping.is_bool() && grouping.as_bool()) {
      opts.grouping = true;
    }
    return to_json(format_time_signature(read_meter_like(a[0], "ts"), opts));
  });
  def("isCompound",
      [](Args& a) -> json::Value { return to_json(is_compound(read_meter_like(a[0], "ts"))); });
  def("beatsPerBar",
      [](Args& a) -> json::Value { return to_json(beats_per_bar(read_meter_like(a[0], "ts"))); });
  def("pulsesPerBar",
      [](Args& a) -> json::Value { return to_json(pulses_per_bar(read_meter_like(a[0], "ts"))); });
  def("pulseBeats",
      [](Args& a) -> json::Value { return to_json(pulse_beats(read_meter_like(a[0], "ts"))); });
  def("meterAt", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return to_json(meter_at(beat, read_meter_like(a[1])));
  });
  def("barStartBeat", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return to_json(bar_start_beat(beat, read_meter_like(a[1])));
  });
  def("barIndexAt", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return to_json(bar_index_at(beat, read_meter_like(a[1])));
  });
  def("beatsPerBarAt", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return to_json(beats_per_bar_at(beat, read_meter_like(a[1])));
  });
  def("beatToBarPosition", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return to_json(beat_to_bar_position(beat, read_meter_like(a[1])));
  });
  def("metricWeight", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return to_json(metric_weight(beat, read_meter_like(a[1])));
  });
  def("isStrongBeat", [](Args& a) -> json::Value {
    double beat = assert_finite_number(a[0], "beat");
    return to_json(is_strong_beat(beat, read_meter_like(a[1])));
  });
  def("barPositionToPulse", [](Args& a) -> json::Value {
    BarPosition pos = read_bar_position(a[0], "position", "position.bar", "position.beat");
    return to_json(bar_position_to_pulse(pos, read_meter_like(a[1])));
  });
  def("barPositionToBeat", [](Args& a) -> json::Value {
    BarPosition pos =
        read_bar_position(a[0], "bar position", "bar position bar", "bar position beat");
    return to_json(bar_position_to_beat(pos, read_meter_like(a[1])));
  });
  def("formatBarPosition", [](Args& a) -> json::Value {
    auto decimals = static_cast<int>(assert_integer(arg_or(a, 2, 2), "decimals", 0, 100));
    double beat = assert_finite_number(a[0], "beat");
    return to_json(format_bar_position(beat, read_meter_like(a[1]), decimals));
  });
  def("resolveMeters", [](Args& a) -> json::Value {
    std::string name = name_arg(a, 1, "meters");
    return to_json(resolve_wire_meters(a[0], name));
  });
  def("tuplet", [](Args& a) -> json::Value {
    double total = assert_range(a[0], 0, kMaxSafeInteger, "tuplet total beats");
    auto count = static_cast<int>(assert_positive_int(a[1], "tuplet count"));
    return to_json(tuplet(total, count));
  });
}

}  // namespace

void register_c1() {
  register_validation();
  register_instrument();
  register_meter();
}

}  // namespace cantus::ops
