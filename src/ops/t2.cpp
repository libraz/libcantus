// Op adapters of theory/symbol, theory/tendency, theory/counterpoint, theory/transposition,
// theory/harmony, theory/chordscale, theory/figured-bass.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_c2.h, ops/codec_t1.h, ops/codec_t2.h), in the TS order and with the
// TS names, then calls the typed function. A guard that returns its argument returns the wire
// value it was given. theory/tendency has no op of its own.

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/chordscale.h"
#include "cantus/theory/counterpoint.h"
#include "cantus/theory/figured_bass.h"
#include "cantus/theory/harmony.h"
#include "cantus/theory/symbol.h"
#include "cantus/theory/transposition.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_t2.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"
#include "theory/chordscale/chordscale.h"

namespace cantus::ops {

namespace {

/** A scale name argument, which TS refuses unless it is a string (`resolveScaleName`). */
const std::string& scale_name_arg(const json::Value& name) {
  if (!name.is_string()) {
    throw InvalidInputError("scale name must be a string; received " + describe_rejected(name));
  }
  return name.as_string();
}

/** Whether a chord's intervals hold a third, so that `thirdSlotOf` reads no spec. */
bool states_third(const Chord& chord) {
  for (double interval : chord.intervals) {
    // `1 << (((interval % 12) + 12) % 12)` shifts by the integer part.
    auto ic = static_cast<int>(std::fmod(std::fmod(interval, 12) + 12, 12));
    if (ic == 3 || ic == 4) {
      return true;
    }
  }
  return false;
}

/** Whether a chord sounds a major third and a minor seventh over its root (`resolvesToMinorTonic`).
 */
bool sounds_dominant_seventh_tones(const Chord& chord) {
  std::vector<int> pcs = chord_pitch_classes(chord);
  auto sounds = [&](double semitones) {
    int pc = pitch_class_of(chord.rootPc + semitones);
    return std::find(pcs.begin(), pcs.end(), pc) != pcs.end();
  };
  return sounds(4) && sounds(10);
}

/** The names of the hidden-parallel readings, for assert_one_of(). */
std::vector<std::string_view> hidden_reading_names() {
  return {to_string(HiddenParallelReading::kFourPart), to_string(HiddenParallelReading::kTwoVoice)};
}

//--------------------------------------------------------------------------------------------
// theory/symbol

/** `tryParseChordSymbol`'s try block over wire arguments. */
ParseResult<Chord> parse_wire(const json::Value& text, const json::Value& asked) {
  try {
    if (!text.is_string()) {
      throw InvalidInputError("chord symbol must be a string; received " + js::type_of(text));
    }
    NoteNameOptions opts;
    opts.system = read_symbol_system(asked);
    return try_parse_chord_symbol(text.as_string(), opts);
  } catch (const InvalidInputError& e) {
    return ParseResult<Chord>::failure(e);
  }
}

void register_symbol() {
  def("tryParseChordSymbol", [](Args& a) -> json::Value {
    // The options are the caller's own configuration, so a malformed bag is raised, not reported.
    const json::Value& asked = assert_options(a[1], "opts");
    return to_json(parse_wire(a[0], asked));
  });
  def("parseChordSymbol", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    return to_json(parse_wire(a[0], asked).unwrap());
  });
  def("toChordData", [](Args& a) -> json::Value { return read_chord_like(a[0]).wire; });
  def("formatChordSymbol", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    settle_chord_quality(data);
    const json::Value& asked = assert_options(a[1], "opts");
    ChordSymbolOptions opts;
    opts.flats = read_symbol_flats(asked);
    // `hintFor(data.rootSpelling, rootPc)` reads a hint as a note before the root is written.
    const json::Value& root_hint = get(data.wire, "rootSpelling");
    if (!is_undefined(root_hint)) {
      read_note(root_hint, "note");
    }
    try {
      opts.system = read_symbol_system(asked);
    } catch (const InvalidInputError&) {
      // The system is first used where the root is written, after the chord has been read that far.
      Chord prefix = data.chord;
      prefix.bassPc.reset();
      format_chord_symbol(prefix, opts);
      throw;
    }
    // So is the slash bass's, when the bass is not the root.
    const json::Value& bass_hint = get(data.wire, "bassSpelling");
    if (data.chord.bassPc &&
        pitch_class_of(*data.chord.bassPc) != pitch_class_of(data.chord.rootPc) &&
        !is_undefined(bass_hint)) {
      read_note(bass_hint, "note");
    }
    return json::Value(format_chord_symbol(data.chord, opts));
  });
  def("transposeChordSymbol", [](Args& a) -> json::Value {
    double semitones = assert_finite_semitones(a[1]);
    const json::Value& asked = assert_options(a[2], "opts");
    if (!a[0].is_string()) {
      throw InvalidInputError("chord symbol must be a string; received " + js::type_of(a[0]));
    }
    ChordSymbolOptions opts;
    opts.system = read_symbol_system(asked);
    opts.flats = read_symbol_flats(asked);
    return json::Value(transpose_chord_symbol(a[0].as_string(), semitones, opts));
  });
}

//--------------------------------------------------------------------------------------------
// theory/harmony

void register_harmony() {
  def("roleOf", [](Args& a) -> json::Value {
    // The id is carried into the result, so a value that is not one would be reported back.
    double chord_id = assert_finite_number(arg_or(a, 2, 0), "chordId");
    ChordData data = read_chord_like(a[1]);
    double pitch = assert_finite_number(a[0], "pitch");
    // `thirdSlotOf`, then `chordToneRole`'s reading of the chord's own spelling.
    if (!states_third(data.chord)) {
      read_spec_quality(data.chord, get(data.wire, "quality"));
    }
    reads_tone_letter_offsets(data.wire);
    return to_json(role_of(pitch, data.chord, chord_id));
  });
}

//--------------------------------------------------------------------------------------------
// theory/counterpoint

/** A predicate over two voices that moves, each read as `pitchOf` reads it. */
using FourVoices = bool (*)(const PitchArg&, const PitchArg&, const PitchArg&, const PitchArg&);

void def_four_voices(const char* name, FourVoices fn) {
  def(name, [fn](Args& a) -> json::Value {
    double first = read_pitch(a[0]);
    double second = read_pitch(a[1]);
    double third = read_pitch(a[2]);
    double fourth = read_pitch(a[3]);
    return to_json(fn(first, second, third, fourth));
  });
}

void register_counterpoint() {
  def("classifySpelledInterval", [](Args& a) -> json::Value {
    bool two_voice = assert_flag(arg_or(a, 1, true), "twoVoice");
    const json::Value& interval = assert_record(a[0], "interval");
    double number = assert_degree(get(interval, "number"), "interval.number");
    const json::Value& quality = get(interval, "quality");
    if (!quality.is_string()) {
      throw InvalidInputError("interval.quality must be an interval quality; received " +
                              describe_rejected(quality));
    }
    SpelledInterval read;
    read.number = static_cast<int>(number);
    read.quality = quality.as_string();
    return to_json(classify_spelled_interval(read, two_voice));
  });
  def("createsVoiceCrossing", [](Args& a) -> json::Value {
    double upper = read_pitch(a[0]);
    double lower = read_pitch(a[1]);
    return to_json(creates_voice_crossing(upper, lower));
  });
  def("createsVerticalDissonance", [](Args& a) -> json::Value {
    // The classifiers it hands the flag to default an absent one to true.
    if (!is_wire_number(a[0]) && !is_wire_number(a[1])) {
      // spelledInterval names its notes `a` and `b`.
      NoteData first = read_note(a[0], "a");
      NoteData second = read_note(a[1], "b");
      bool two_voice = assert_flag(arg_or(a, 2, true), "twoVoice");
      return to_json(creates_vertical_dissonance(first, second, two_voice));
    }
    double first = read_pitch(a[0]);
    double second = read_pitch(a[1]);
    bool two_voice = assert_flag(arg_or(a, 2, true), "twoVoice");
    return to_json(creates_vertical_dissonance(first, second, two_voice));
  });
  def("isForbiddenMelodicLeap", [](Args& a) -> json::Value {
    if (!is_wire_number(a[0]) && !is_wire_number(a[1])) {
      NoteData prev = read_note(a[0], "a");
      NoteData cur = read_note(a[1], "b");
      return to_json(is_forbidden_melodic_leap(prev, cur));
    }
    // The distance is taken as `pitchOf(cur) - pitchOf(prev)`: the later note is read first.
    double cur = read_pitch(a[1]);
    double prev = read_pitch(a[0]);
    return to_json(is_forbidden_melodic_leap(prev, cur));
  });
  def("isAugmentedMelodicInterval", [](Args& a) -> json::Value {
    // A number says nothing about spelling, so neither argument is read further.
    if (is_wire_number(a[0]) || is_wire_number(a[1])) {
      return to_json(false);
    }
    NoteData prev = read_note(a[0], "a");
    NoteData cur = read_note(a[1], "b");
    return to_json(is_augmented_melodic_interval(prev, cur));
  });
  def_four_voices("createsParallelPerfect", creates_parallel_perfect);
  def_four_voices("createsParallelOctave", creates_parallel_octave);
  def_four_voices("createsParallelUnison", creates_parallel_unison);
  def_four_voices("createsBattuta", creates_battuta);
  def_four_voices("createsVoiceOverlap", creates_voice_overlap);
  def("createsHiddenParallelPerfect", [](Args& a) -> json::Value {
    // A reading outside the two named ones would silently take the lenient half of the rule.
    std::string reading =
        assert_one_of(arg_or(a, 4, "fourPart"), hidden_reading_names(), "strictness");
    double first = read_pitch(a[0]);
    double second = read_pitch(a[1]);
    double third = read_pitch(a[2]);
    double fourth = read_pitch(a[3]);
    return to_json(creates_hidden_parallel_perfect(first, second, third, fourth,
                                                   *parse_hidden_parallel_reading(reading)));
  });
  def("exceedsSpacing", [](Args& a) -> json::Value {
    double max_semitones = assert_finite_number(arg_or(a, 2, 12), "maxSemitones");
    double upper = read_pitch(a[0]);
    double lower = read_pitch(a[1]);
    return to_json(exceeds_spacing(upper, lower, max_semitones));
  });
  def("isLeadingToneResolution", [](Args& a) -> json::Value {
    double prev = read_pitch(a[0]);
    double cur = read_pitch(a[1]);
    KeyScale key = read_key_like(a[2]);
    return to_json(is_leading_tone_resolution(prev, cur, key));
  });
  def("voiceIndependence", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[2], "opts");
    const json::Array& upper = assert_array(a[0], "lead");
    const json::Array& lower = assert_array(a[1], "counter");
    if (upper.size() != lower.size()) {
      throw InvalidInputError(
          "voiceIndependence needs the two lines aligned slot for slot; received " +
          js::to_string(upper.size()) + " and " + js::to_string(lower.size()));
    }
    // An attack array of the wrong length would read every slot past its end as a sustain.
    VoiceIndependenceOptions opts;
    read_attack_arrays(asked, upper.size(), opts);
    // Each slot's pitches are read lead first, as the TS map reads them.
    std::vector<Nullable<NoteData>> lead;
    std::vector<Nullable<NoteData>> counter;
    auto line_note = [](const json::Value& value) -> Nullable<NoteData> {
      if (value.is_null()) {
        return std::nullopt;
      }
      NoteData note = read_note(value, "note");
      note_to_midi(note);
      return note;
    };
    for (std::size_t index = 0; index < upper.size(); ++index) {
      lead.push_back(line_note(upper[index]));
      counter.push_back(line_note(lower[index]));
    }
    return to_json(voice_independence(lead, counter, opts));
  });
}

//--------------------------------------------------------------------------------------------
// theory/transposition

/** An instrument as the typed API reads it: a name, or a wire interval read the way TS reads it. */
IntervalArg read_instrument(const json::Value& instrument) {
  if (instrument.is_string()) {
    return IntervalArg(instrument.as_string());
  }
  return IntervalArg(read_interval_like(instrument));
}

void register_transposition() {
  def("$const:TRANSPOSING_INSTRUMENTS", [](Args&) -> json::Value {
    json::Object o;
    for (const TransposingInstrumentEntry& entry : TRANSPOSING_INSTRUMENTS) {
      o.set(std::string(entry.name), std::string(entry.interval));
    }
    return json::Value(std::move(o));
  });
  def("instrumentTransposition", [](Args& a) -> json::Value {
    if (a[0].is_string()) {
      return to_json(instrument_transposition(IntervalArg(a[0].as_string())));
    }
    return to_json(read_interval_like(a[0]));
  });
  def("toSoundingPitch", [](Args& a) -> json::Value {
    NoteData note = read_note_like(a[0]);
    return to_json(to_sounding_pitch(note, read_instrument(a[1])));
  });
  def("toWrittenPitch", [](Args& a) -> json::Value {
    NoteData note = read_note_like(a[0]);
    return to_json(to_written_pitch(note, read_instrument(a[1])));
  });
}

//--------------------------------------------------------------------------------------------
// theory/chordscale

void register_chordscale() {
  def("scaleMatchesChord", [](Args& a) -> json::Value {
    // The mask is read with bit operations and a pitch class shifts it, so both coerce.
    double mask = read_mode_mask(a[1], "scaleMask");
    double root = assert_pitch_class(a[2], "scaleRootPc");
    const json::Array& pcs = assert_array(a[0], "chord pitch classes");
    for (std::size_t index = 0; index < pcs.size(); ++index) {
      std::string name = "chord pitch classes[" + index_text(index) + "]";
      // A hole or a null reads as NaN. The scan stops at the first tone the scale lacks, so
      // the entries after it are never read.
      double pc = pcs[index].is_null() || is_undefined(pcs[index])
                      ? cantus::assert_pitch_class(std::numeric_limits<double>::quiet_NaN(), name)
                      : assert_pitch_class(pcs[index], name);
      if (!scale_matches_chord({pc}, mask, root)) {
        return to_json(false);
      }
    }
    return to_json(true);
  });
  def("chordScales", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    settle_chord_quality(data);
    return to_json(chord_scales(data.chord));
  });
  def("avoidNotes", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[2], "opts");
    const std::string& name = scale_name_arg(a[1]);
    require_chord_scale_mask(name);
    ChordData data = read_chord_like(a[0]);
    AvoidNotesOptions opts;
    opts.use = *parse_avoid_note_use(
        assert_one_of(opt_or(asked, "use", to_string(AvoidNoteUse::kHarmonic)),
                      avoid_note_use_names(), "avoid-note use"));
    settle_chord_quality(data);
    return to_json(avoid_notes(data.chord, name, opts));
  });
  def("availableTensions", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[2], "opts");
    const std::string& name = scale_name_arg(a[1]);
    require_chord_scale_mask(name);
    ChordData data = read_chord_like(a[0]);
    settle_chord_quality(data);
    AvailableTensionsOptions opts;
    // The target is read only once the scale is weighed over the chord.
    const json::Value* target = opt_strict(asked, "resolvesTo");
    if (target != nullptr && weighs_tensions(data.chord, name)) {
      ChordData resolves = read_chord_like(*target);
      // Its tones are asked for only when a dominant seventh moves to it down a fifth.
      if (sounds_dominant_seventh_tones(data.chord) &&
          pitch_class_of(resolves.chord.rootPc) == pitch_class_of(data.chord.rootPc + 5)) {
        settle_chord_quality(resolves);
      }
      opts.resolvesTo = ChordArg(resolves.chord);
    }
    return to_json(available_tensions(data.chord, name, opts));
  });
  def("chordScaleReport", [](Args& a) -> json::Value {
    std::optional<double> limit;
    if (!a.undefined(1)) {
      limit = assert_positive_int(a[1], "chord-scale report limit");
    }
    ChordData data = read_chord_like(a[0]);
    settle_chord_quality(data);
    return to_json(chord_scale_report(data.chord, limit));
  });
  def("scalesForChanges", [](Args& a) -> json::Value {
    const json::Array& chords = assert_array(a[0], "chord-scale changes");
    assert_generation_budget(json::Value(static_cast<double>(chords.size())), "chord-scale changes",
                             undefined_value());
    std::vector<Chord> read;
    for (const json::Value& chord : chords) {
      ChordData data = read_chord_like(chord);
      settle_chord_quality(data);
      read.push_back(std::move(data.chord));
    }
    std::vector<ScaleChoice> choices = scales_for_changes(read);
    // Each choice pairs its scale with the chord exactly as it was handed in.
    json::Array out;
    for (std::size_t index = 0; index < choices.size(); ++index) {
      json::Object choice;
      choice.set("chord", chords[index]);
      choice.set("scale", to_json(choices[index].scale));
      out.emplace_back(std::move(choice));
    }
    return json::Value(std::move(out));
  });
}

//--------------------------------------------------------------------------------------------
// theory/figured-bass

/** `figuredBassRealization`'s prologue: the figures are a string, the bass a note, the key a key.
 */
FiguredBassRealization realization_of(Args& a) {
  if (!a[1].is_string()) {
    throw InvalidInputError("figured bass must be a string; received " + js::type_of(a[1]));
  }
  NoteData bass = read_note_like(a[0]);
  KeyArg key = read_key_arg(a[2]);
  return figured_bass_realization(bass, a[1].as_string(), key);
}

void register_figured_bass() {
  def("figuredBassRealization", [](Args& a) -> json::Value { return to_json(realization_of(a)); });
  def("realizeFiguredBass",
      [](Args& a) -> json::Value { return to_json(realization_of(a).chord); });
  def("figuredBassOf", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    ResolvedKey key = resolve_key(read_key_arg(a[1]));
    // `spellChord` asserts the chord, then reads its spelling hints.
    settle_chord_quality(data);
    read_spelled_hints(data.wire);
    return json::Value(figured_bass_of(data.chord, KeyArg(key)));
  });
}

}  // namespace

void register_t2() {
  register_symbol();
  register_harmony();
  register_counterpoint();
  register_transposition();
  register_chordscale();
  register_figured_bass();
}

}  // namespace cantus::ops
