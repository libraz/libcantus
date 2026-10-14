// Op adapters of analyze/voice, analyze/melody.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_a1c.h), in the TS order and with the TS names, then calls the typed
// function. Notes a result carries over from its input are the input's own wire values, with the
// fields the caller put on them.

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "analyze/melody/contour.h"
#include "analyze/melody/graph.h"
#include "analyze/melody/internal.h"
#include "analyze/melody/motifs.h"
#include "analyze/melody/relation.h"
#include "analyze/melody/similarity.h"
#include "analyze/voice/voice.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1a.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_t2.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** A copy of the wire notes of an ordered line, in the order the line reads them. */
json::Array wire_line(const json::Array& wire, const std::vector<NoteEvent>& typed) {
  json::Array out;
  for (std::size_t index : ordered_indices(typed)) {
    out.push_back(wire[index]);
  }
  return out;
}

/** `assertNoteEvents` then `orderedNotes` over a wire phrase; the typed line and its wire notes. */
struct PhraseLine {
  std::vector<NoteEvent> typed;
  std::vector<NoteEvent> ordered;
};

PhraseLine read_ordered(const json::Value& notes, std::string_view name,
                        const json::Value& budget) {
  PhraseLine line;
  line.typed = assert_note_events(notes, name, line_options(budget));
  for (std::size_t index : ordered_indices(line.typed)) {
    line.ordered.push_back(line.typed[index]);
  }
  return line;
}

//--------------------------------------------------------------------------------------------
// analyze/melody

/** Replace the typed `notes` of a motif by the wire notes it was read from. */
void carry_notes(json::Value& motif, const json::Array& ordered_wire, const MotifData& typed) {
  if (typed.occurrences.empty()) {
    return;
  }
  std::size_t first = typed.occurrences.front().noteIndex;
  json::Array notes;
  for (std::size_t k = 0; k < typed.notes.size(); ++k) {
    notes.push_back(ordered_wire[first + k]);
  }
  motif.as_object().set("notes", json::Value(std::move(notes)));
}

void register_melody() {
  def("$const:MELODIC_CONTOUR_SHAPES", [](Args&) -> json::Value {
    std::vector<std::string_view> names;
    for (MelodicContourShape shape : {MelodicContourShape::kArch, MelodicContourShape::kAscending,
                                      MelodicContourShape::kDescending, MelodicContourShape::kWave,
                                      MelodicContourShape::kStatic}) {
      names.push_back(to_string(shape));
    }
    return to_json(names);
  });
  def("$const:MOTIF_RELATION_KINDS", [](Args&) -> json::Value {
    std::vector<std::string_view> names;
    for (MotifRelationKind kind :
         {MotifRelationKind::kRepetition, MotifRelationKind::kTransposition,
          MotifRelationKind::kTonalTransposition, MotifRelationKind::kInversion,
          MotifRelationKind::kRetrograde, MotifRelationKind::kRetrogradeInversion,
          MotifRelationKind::kAugmentation, MotifRelationKind::kDiminution}) {
      names.push_back(to_string(kind));
    }
    return to_json(names);
  });
  def("melodicContour", [](Args& a) -> json::Value {
    PhraseLine line = read_ordered(read_phrase_notes(a[0]), "contour notes", undefined_value());
    return to_json(contour_of(line.ordered));
  });
  def("compareMelodies", [](Args& a) -> json::Value {
    PhraseLine left = read_ordered(read_phrase_notes(a[0]), "melody a", undefined_value());
    PhraseLine right = read_ordered(read_phrase_notes(a[1]), "melody b", undefined_value());
    return to_json(compare_ordered(left.ordered, right.ordered));
  });
  def("melodicSimilarity", [](Args& a) -> json::Value {
    PhraseLine left = read_ordered(read_phrase_notes(a[0]), "melody a", undefined_value());
    PhraseLine right = read_ordered(read_phrase_notes(a[1]), "melody b", undefined_value());
    return to_json(compare_ordered(left.ordered, right.ordered).similarity);
  });
  def("extractMotifs", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[1], "opts");
    auto pick = [&](std::string_view key, double fallback) {
      const json::Value* given = opt_null_default(asked, key);
      return given != nullptr ? *given : json::Value(fallback);
    };
    double min_notes = assert_integer(pick("minNotes", MIN_CELL_NOTES), "motif minNotes", 2, 64);
    double max_notes = assert_integer(pick("maxNotes", MAX_CELL_NOTES), "motif maxNotes", 2, 64);
    if (max_notes < min_notes) {
      throw InvalidInputError("motif maxNotes must be at least minNotes " +
                              js::to_string(min_notes) + "; received " + js::to_string(max_notes));
    }
    double min_occurrences =
        assert_integer(pick("minOccurrences", MIN_OCCURRENCES), "motif minOccurrences", 2);
    const json::Value& budget = get(asked, "budget");
    PhraseLine line = read_ordered(a[0], "melody notes", budget);
    ExtractMotifsOptions typed;
    typed.minNotes = min_notes;
    typed.maxNotes = max_notes;
    typed.minOccurrences = min_occurrences;
    if (const json::Value* given = field(asked, "budget")) {
      typed.budget = number_of(*given);
    }
    std::vector<MotifData> motifs = extract_motifs(line.typed, typed);
    json::Array ordered_wire = wire_line(a[0].as_array(), line.typed);
    json::Value out = to_json(motifs);
    for (std::size_t i = 0; i < motifs.size(); ++i) {
      carry_notes(out.as_array()[i], ordered_wire, motifs[i]);
    }
    return out;
  });
  def("motifFromNotes", [](Args& a) -> json::Value {
    PhraseLine line = read_ordered(a[0], "motif notes", undefined_value());
    MotifData motif = motif_of_line(line.ordered);
    json::Value out = to_json(motif);
    json::Array ordered_wire = wire_line(a[0].as_array(), line.typed);
    // The single statement starts on the first note of the line.
    if (motif.occurrences.empty()) {
      return out;
    }
    carry_notes(out, ordered_wire, motif);
    return out;
  });
  def("relateMotifs", [](Args& a) -> json::Value {
    // The key is resolved before either motif is looked at.
    std::optional<ResolvedKey> key;
    if (!a.undefined(2)) {
      key = resolve_key(read_key_arg(a[2]));
    }
    const json::Array& model = assert_array(get(assert_record(a[0], "a"), "notes"), "a.notes");
    const json::Array& answer = assert_array(get(assert_record(a[1], "b"), "notes"), "b.notes");
    KeySource source = [&] { return *key; };
    return to_json(relate_lines(read_line(model), read_line(answer), key ? &source : nullptr));
  });
  def("motifGraph", [](Args& a) -> json::Value {
    const json::Value& asked = assert_options(a[2], "opts");
    const json::Value* given = opt_null_default(asked, "variationThreshold");
    double variation_threshold =
        assert_range(given != nullptr ? *given : json::Value(DEFAULT_VARIATION_THRESHOLD), 0, 1,
                     "motif graph variationThreshold");
    const json::Value& budget = get(asked, "budget");
    PhraseLine line = read_ordered(a[0], "line", budget);
    const json::Array& motifs = assert_array(a[1], "motifs");
    std::vector<GraphNodeInfo> infos;
    for (std::size_t mi = 0; mi < motifs.size(); ++mi) {
      std::string motif_name = "motifs[" + index_text(mi) + "]";
      const json::Value& motif = assert_record(motifs[mi], motif_name);
      const json::Array& notes = assert_array(get(motif, "notes"), motif_name + ".notes");
      const json::Array& occurrences =
          assert_array(get(motif, "occurrences"), motif_name + ".occurrences");
      for (std::size_t oi = 0; oi < occurrences.size(); ++oi) {
        std::string occurrence_name = motif_name + ".occurrences[" + index_text(oi) + "]";
        const json::Value& occurrence = assert_record(occurrences[oi], occurrence_name);
        const json::Value& index = get(occurrence, "noteIndex");
        std::optional<double> note_index =
            js::type_of(index) == "number" ? number_of(index) : std::nullopt;
        double start = js::to_number(get(occurrence, "startBeat"));
        bool on_line = note_index && std::floor(*note_index) == *note_index &&
                       !std::isinf(*note_index) && *note_index >= 0 &&
                       *note_index + static_cast<double>(notes.size()) <=
                           static_cast<double>(line.ordered.size()) &&
                       *note_index < static_cast<double>(line.ordered.size()) &&
                       std::fabs(line.ordered[static_cast<std::size_t>(*note_index)].startBeat -
                                 start) <= BEAT_EPS;
        if (!on_line) {
          throw InvalidInputError("motif occurrence " + occurrence_name +
                                  " does not lie on the line");
        }
        GraphNodeInfo info;
        info.node = MotifGraphNode{mi, oi, start, js::to_number(get(occurrence, "endBeat"))};
        auto first = static_cast<std::ptrdiff_t>(*note_index);
        std::vector<NoteEvent> statement(
            line.ordered.begin() + first,
            line.ordered.begin() + first + static_cast<std::ptrdiff_t>(notes.size()));
        info.data = motif_from_notes(statement);
        infos.push_back(std::move(info));
      }
    }
    const json::Value* key = field(asked, "key");
    KeySource source = [key] { return resolve_key(read_key_arg(*key)); };
    MotifGraph graph = graph_of_nodes(std::move(infos), key != nullptr ? &source : nullptr,
                                      number_of(budget), variation_threshold);
    json::Value out = to_json(graph);
    // A node reports the beats its occurrence wrote, as it wrote them.
    json::Array nodes;
    for (const MotifGraphNode& typed : graph.nodes) {
      const json::Value& written =
          get(motifs[typed.motif], "occurrences").as_array()[typed.occurrence];
      json::Object node;
      node.set("motif", static_cast<double>(typed.motif));
      node.set("occurrence", static_cast<double>(typed.occurrence));
      node.set("startBeat", get(written, "startBeat"));
      if (!is_undefined(get(written, "endBeat"))) {
        node.set("endBeat", get(written, "endBeat"));
      }
      nodes.push_back(json::Value(std::move(node)));
    }
    out.as_object().set("nodes", json::Value(std::move(nodes)));
    return out;
  });
}

//--------------------------------------------------------------------------------------------
// analyze/voice

void register_voice() {
  def("toVoiceNotes", [](Args& a) -> json::Value {
    NoteEventAssertOptions options;
    options.allowNonPositiveDuration = true;
    std::vector<NoteEvent> events = assert_note_events(a[0], "voice notes", options);
    json::Array out;
    for (std::size_t index = 0; index < events.size(); ++index) {
      json::Value note = a[0].as_array()[index];
      note.as_object().set("id", static_cast<double>(index));
      note.as_object().set("originalIndex", static_cast<double>(index));
      out.push_back(std::move(note));
    }
    return json::Value(std::move(out));
  });
  def("analyzeVoice", [](Args& a) -> json::Value {
    std::vector<NoteEvent> events =
        assert_note_events(a[0], "voice notes", line_options(undefined_value()));
    const json::Array& wire = a[0].as_array();
    if (!is_chord_function(a[1])) {
      assert_function(a[1], "chordAtBeat");
    }
    const bool default_others = a.undefined(3);
    if (!default_others) {
      assert_function(a[3], "otherVoicesAtBeat");
    }
    // The key is read once, here, unless it is the function that answers per beat.
    KeyAtBeat key_at = read_key_context(a, 2);
    VoiceHost host;
    host.key_at = key_at;
    if (js::type_of(a[1]) == "function") {
      Callback callback = a.callback(1);
      host.chord_at = [callback](double beat) {
        return read_host_chord(callback(json::Array{json::Value(beat)}));
      };
    } else {
      const json::Value& listed = get(a[1], "segments");
      if (!listed.is_array()) {
        throw InvalidInputError("timeline.segments must be an array; received " +
                                js::type_of(listed));
      }
      const json::Array& segments = listed.as_array();
      host.chord_at = [&segments](double beat) {
        return read_host_chord(timeline_chord_at(segments, beat));
      };
    }
    if (default_others) {
      host.others_at = [](double) { return std::vector<OtherVoice>{}; };
    } else {
      Callback callback = a.callback(3);
      host.others_at = [callback](double beat) {
        json::Value others = callback(json::Array{json::Value(beat)});
        if (!others.is_array()) {
          throw js::TypeError(others.is_null() || is_undefined(others)
                                  ? "Cannot read properties of " +
                                        std::string(others.is_null() ? "null" : "undefined") +
                                        " (reading 'some')"
                                  : "others.some is not a function");
        }
        std::vector<OtherVoice> voices;
        for (const json::Value& other : others.as_array()) {
          // `ov.pitch` is read where a rule asks for it, and fails for an entry that is no object.
          auto read = [other]() -> json::Value {
            if (other.is_null() || is_undefined(other)) {
              throw js::TypeError(std::string("Cannot read properties of ") +
                                  (other.is_null() ? "null" : "undefined") + " (reading 'pitch')");
            }
            return get(other, "pitch");
          };
          OtherVoice voice;
          voice.raw_pitch = [read] {
            json::Value pitch = read();
            // `Math.min` reads it as a number, which a bigint is not.
            return js::to_math_number(pitch);
          };
          voice.pitch_of = [read] { return read_pitch(read()); };
          voices.push_back(std::move(voice));
        }
        return voices;
      };
    }
    std::vector<VoiceNote> voice;
    for (std::size_t i = 0; i < events.size(); ++i) {
      VoiceNote note;
      static_cast<NoteEvent&>(note) = events[i];
      const json::Value& id = get(wire[i], "id");
      if (js::type_of(id) == "number") {
        note.id = number_of(id);
      }
      const json::Value& original = get(wire[i], "originalIndex");
      if (!is_undefined(original)) {
        note.originalIndex = 0;
      }
      voice.push_back(std::move(note));
    }
    json::Value out = to_json(analyze_voice_over(voice, host));
    // The id and the original index are reported as the caller wrote them.
    for (std::size_t i = 0; i < voice.size(); ++i) {
      json::Object& note = out.as_array()[i].as_object();
      const json::Value& id = get(wire[i], "id");
      if (!(id.is_null() || is_undefined(id)) && js::type_of(id) != "number") {
        note.set("noteId", id);
      }
      const json::Value& original = get(wire[i], "originalIndex");
      if (!is_undefined(original)) {
        note.set("originalIndex", original);
      }
    }
    return out;
  });
}

}  // namespace

void register_a1c() {
  register_melody();
  register_voice();
}

}  // namespace cantus::ops
