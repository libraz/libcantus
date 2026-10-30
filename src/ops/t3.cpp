// Op adapters of theory/partwriting, theory/voicing.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_c2.h, ops/codec_t1.h, ops/codec_t2.h, ops/codec_t3.h), in the TS
// order and with the TS names, then calls the typed function. The option readers of ops/codec_t3.h
// resolve every option the entry point reads before the typed call.

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/partwriting.h"
#include "cantus/theory/voicing.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_t3.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"
#include "theory/partwriting/internal.h"

namespace cantus::ops {

namespace {

//--------------------------------------------------------------------------------------------
// theory/voicing

void register_voicing() {
  def("$const:SATB_RANGES", [](Args&) -> json::Value { return to_json(SATB_RANGES); });
  def("voiceChord", [](Args& a) -> json::Value {
    ChordData data = read_chord_like(a[0]);
    const json::Value& asked = assert_options(a[1], "opts");
    VoicingOptions opts;
    read_ranges_option(asked, opts);
    read_max_spacing_option(asked, opts);
    read_max_candidates_option(asked, opts);
    read_voiced_chord(data, asked, opts);
    return to_json(voice_chord(data.chord, opts));
  });
  def("voiceProgression", [](Args& a) -> json::Value {
    const json::Array& chords = assert_array(a[0], "chords");
    // The budget and the key are read off the options before the options are checked to be a bag.
    assert_generation_budget(json::Value(static_cast<double>(chords.size())),
                             "voiced progression chords", get(a[1], "budget"));
    std::vector<ChordData> read;
    for (const json::Value& chord : chords) {
      read.push_back(read_chord_like(chord));
    }
    VoicingOptions opts;
    read_key_option(a[1], opts);
    if (opts.key) {
      resolve_key(*opts.key);
    }
    const json::Value& asked = assert_options(a[1], "opts");
    read_ranges_option(asked, opts);
    read_max_spacing_option(asked, opts);
    read_max_candidates_option(asked, opts);
    if (const json::Value* budget = field(asked, "budget")) {
      opts.budget = number_of(*budget);
    }
    // Each chord's tones are read where its candidates are enumerated, then the roles its own
    // spelling gives them where its move is scored, chord by chord.
    std::vector<ChordArg> data;
    for (ChordData& chord : read) {
      settle_chord_quality(chord);
      reads_tone_letter_offsets(chord.wire);
      data.emplace_back(std::move(chord.chord));
    }
    return to_json(voice_progression(data, opts));
  });
  def("nextVoicing", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[2], "opts");
    std::vector<double> current = read_voicing(a[0], "current");
    ChordData data = read_chord_like(a[1]);
    VoicingOptions opts;
    // The ranges are read off `current` unless the options name them.
    bool derived = field(asked, "ranges") == nullptr && field(asked, "voices") == nullptr;
    if (derived) {
      if (current.empty()) {
        throw InvalidInputError("current must contain at least one pitch");
      }
    } else {
      read_ranges_option(asked, opts);
    }
    read_max_spacing_option(asked, opts);
    read_max_candidates_option(asked, opts);
    read_next_voiced_chord(data, asked, opts);
    return to_json(next_voicing(current, data.chord, opts));
  });
  def("voiceLeadingCost", [](Args& a) -> json::Value {
    std::vector<double> from = read_voicing(a[0], "from");
    std::vector<double> to = read_voicing(a[1], "to");
    return to_json(voice_leading_cost(from, to));
  });
  def("voiceChordStyled", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    ChordData data = read_chord_like(a[0]);
    StyledVoicingOptions opts;
    // A style the library does not name is voiced as the plain close stack.
    const json::Value* style = opt_null_default(asked, "style");
    if (style != nullptr && style->is_string()) {
      opts.style = parse_voicing_style(style->as_string());
    }
    if (const json::Value* octave = opt_null_default(asked, "octave")) {
      opts.octave = assert_integer(*octave, "styled voicing octave", -10, 10);
    }
    if (const json::Value* top = opt_strict(asked, "topNote")) {
      opts.topNote = assert_finite_number(*top, "styled voicing topNote");
    }
    const json::Value& rootless = get(asked, "rootless");
    opts.rootless = rootless.is_bool() && rootless.as_bool();
    return to_json(voice_chord_styled(data.chord, opts));
  });
}

//--------------------------------------------------------------------------------------------
// theory/partwriting

/** `spellPitch` refuses a pitch that is not a number after it has read the tonic and the key. */
SpelledVoicing spell_wire_voicing(const json::Array& pitches, const Chord& chord,
                                  const KeyArg& key) {
  std::vector<double> numbers;
  for (const json::Value& pitch : pitches) {
    if (is_wire_number(pitch)) {
      numbers.push_back(*number_of(pitch));
      continue;
    }
    // The pitches before it are spelled first, and so is a probe pitch when it is the first.
    spell_voicing(numbers.empty() ? std::vector<double>{60} : numbers, chord, key);
    numbers.push_back(assert_finite_number(pitch, "pitch"));
  }
  return spell_voicing(numbers, chord, key);
}

/** The notes of a species line, each read as `assertNote` reads it. */
std::vector<NoteData> read_line(const json::Array& notes) {
  std::vector<NoteData> out;
  for (const json::Value& note : notes) {
    out.push_back(read_note(note, "note"));
  }
  return out;
}

void register_partwriting() {
  def("spellVoicing", [](Args& a) -> json::Value {
    const json::Array& pitches = assert_array(a[0], "voicing");
    const json::Value& chord = assert_chord(a[1]);
    KeyArg key = read_key_arg(a[2]);
    return to_json(spell_wire_voicing(pitches, read_chord_fields(chord), key));
  });
  def("checkPartWriting", [](Args& a) -> json::Value {
    const json::Array& voicings = assert_array(a[0], "voicings");
    const json::Array& chords = assert_array(a[1], "chords");
    const json::Value& asked = assert_options(a[3], "opts");
    KeyScale key = read_key_like(a[2]);
    if (voicings.size() != chords.size()) {
      throw InvalidInputError("checkPartWriting needs one chord per voicing; received " +
                              js::to_string(voicings.size()) + " voicings and " +
                              js::to_string(chords.size()) + " chords");
    }
    PartWritingOptions opts;
    VoicingOptions limits;
    read_max_spacing_option(asked, limits);
    opts.maxSpacing = limits.maxSpacing;
    // The widest voicing decides whether the default ranges apply:
    // `Math.max(widest, voicing.length)` over whatever each voicing is.
    double voice_count = 0;
    for (const json::Value& voicing : voicings) {
      voice_count = js::max(voice_count, js::to_math_number(length_of(voicing)));
    }
    if (field(asked, "ranges") != nullptr) {
      read_ranges_option(asked, limits);
      opts.ranges = limits.ranges;
      if (static_cast<double>(opts.ranges->size()) < voice_count) {
        throw InvalidInputError("checkPartWriting needs one range per voice; received " +
                                js::to_string(opts.ranges->size()) + " ranges for " +
                                js::to_string(voice_count) + " voices");
      }
    }
    // A note without an octave is refused by check_part_writing() where TS meets it, so the notes
    // from there on are not read.
    std::vector<SpelledVoicing> notes;
    bool unread = false;
    for (const json::Value& voicing : voicings) {
      if (!voicing.is_array() && !unread) {
        throw js::TypeError("notes.map is not a function");
      }
      static const json::Array kNoVoices;
      SpelledVoicing line;
      for (const json::Value& note : voicing.is_array() ? voicing.as_array() : kNoVoices) {
        if (!unread) {
          // `note.octave === undefined`, read off whatever the voice holds.
          unread = is_undefined(property_of(note, "octave"));
        }
        line.push_back(unread ? NoteData{} : read_note(note, "note"));
      }
      notes.push_back(std::move(line));
    }
    std::vector<Chord> progression;
    for (const json::Value& chord : chords) {
      progression.push_back(read_chord_fields(chord));
    }
    return to_json(check_part_writing(notes, progression, KeyArg(key), opts));
  });
  def("checkSpecies", [](Args& a) -> json::Value {
    const json::Array& cantus_firmus = assert_array(a[0], "cantus firmus");
    const json::Array& counterpoint = assert_array(a[1], "counterpoint");
    const json::Value& asked = assert_options(a[4], "opts");
    KeyScale mode = read_key_like(a[3]);
    std::optional<double> species = is_wire_number(a[2]) ? number_of(a[2]) : std::nullopt;
    if (!species || !is_species_number(*species)) {
      throw species_rejected(a[2]);
    }
    if (cantus_firmus.empty() || counterpoint.empty()) {
      throw InvalidInputError("checkSpecies needs both a cantus firmus and a counterpoint");
    }
    SpeciesOptions opts;
    if (const json::Value* durations = field(asked, "durations")) {
      const json::Array& listed = assert_array(*durations, "durations");
      std::vector<double> read;
      for (std::size_t index = 0; index < listed.size(); ++index) {
        read.push_back(assert_finite_number(listed[index], "durations[" + index_text(index) + "]"));
      }
      opts.durations = std::move(read);
    }
    const json::Value* above = opt_null_default(asked, "counterpointAbove");
    if (above != nullptr) {
      opts.counterpointAbove = js::truthy(*above);
    }
    int kind = static_cast<int>(*species);
    // The rhythm is resolved before any note is read: one it cannot read is reported over notes
    // nobody looks at.
    SpeciesDurations resolved =
        resolve_species_durations(counterpoint.size(), cantus_firmus.size(), kind, opts);
    if (resolved.problem) {
      return to_json(check_species(std::vector<NoteData>(cantus_firmus.size()),
                                   std::vector<NoteData>(counterpoint.size()), kind, KeyArg(mode),
                                   opts));
    }
    if (above != nullptr) {
      // Each note is first read by spelledInterval, which names the lower note `a`, against the
      // cantus-firmus notes it sounds with, in time order.
      for (const SpeciesEntryPair& pair :
           species_entry_pairs(cantus_firmus.size(), resolved.durations)) {
        const json::Value& note = counterpoint[pair.note];
        const json::Value& against = cantus_firmus[pair.against];
        read_note(*opts.counterpointAbove ? against : note, "a");
        read_note(*opts.counterpointAbove ? note : against, "b");
      }
    }
    if (above == nullptr) {
      // Otherwise each line is first read for its mean pitch, the counterpoint's first, note by
      // note as noteToMidi reads it.
      for (const json::Array* line : {&counterpoint, &cantus_firmus}) {
        for (const json::Value& note : *line) {
          note_to_midi(read_note(note, "note"));
        }
      }
    }
    std::vector<NoteData> written = read_line(counterpoint);
    std::vector<NoteData> given = read_line(cantus_firmus);
    return to_json(check_species(given, written, kind, KeyArg(mode), opts));
  });
}

}  // namespace

void register_t3() {
  register_voicing();
  register_partwriting();
}

}  // namespace cantus::ops
