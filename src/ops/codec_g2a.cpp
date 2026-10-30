#include "ops/codec_g2a.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "core/instrument/articulation.h"
#include "core/validation/validation.h"
#include "generate/bass/internal.h"
#include "js/format.h"
#include "js/number.h"
#include "js/sort.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1a.h"
#include "ops/validate.h"

namespace cantus::ops {

void write_fields(const BassLick& v, FieldWriter& w) {
  w.field("id", v.id);
  w.field("genre", v.genre);
  w.field("difficulty", v.difficulty);
  w.field("articulations", v.articulations);
  w.field("ts", v.ts);
  w.field("fitsOver", v.fitsOver);
  if (v.tempoRange) {
    w.field("tempoRange", std::vector<double>{(*v.tempoRange)[0], (*v.tempoRange)[1]});
  }
  w.field("material", v.material);
  w.field("provenance", v.provenance);
  w.field("sections", v.sections);
}

BassPlacement read_bass_placement(const json::Array& placement) {
  // The chords are read into their plain form once, in placement order.
  std::vector<BassSegment> segments;
  std::vector<LickQuality> qualities;
  std::vector<double> keys;
  for (const json::Value& segment : placement) {
    ChordData chord = read_chord_like(property_of(segment, "chord"));
    const json::Value& quality = get(chord.wire, "quality");
    LickQuality read_quality;
    read_quality.absent = is_undefined(quality);
    std::optional<ChordQuality> named = known_chord_quality(quality);
    read_quality.foreign = !read_quality.absent && !named;
    if (!named) {
      read_quality.unknown = js::template_string(quality);
    }
    qualities.push_back(std::move(read_quality));
    BassSegment read;
    std::optional<double> start = number_of(get(segment, "startBeat"));
    std::optional<double> end = number_of(get(segment, "endBeat"));
    read.startBeat = start.value_or(std::nan(""));
    read.endBeat = end.value_or(std::nan(""));
    read.chord = std::move(chord.chord);
    segments.push_back(std::move(read));
    keys.push_back(placement.size() > 1 ? js::to_number(get(segment, "startBeat")) : 0);
  }
  // `sort((a, b) => a.startBeat - b.startBeat)` over the raw start beats.
  std::vector<std::size_t> order(segments.size());
  std::iota(order.begin(), order.end(), 0);
  js::array_sort(order, [&keys](std::size_t a, std::size_t b) { return keys[a] - keys[b]; });
  std::vector<BassSegment> sorted;
  std::vector<LickQuality> sorted_qualities;
  for (std::size_t at : order) {
    sorted.push_back(std::move(segments[at]));
    sorted_qualities.push_back(std::move(qualities[at]));
  }
  for (std::size_t index = 0; index < sorted.size(); ++index) {
    const json::Value& wire = placement[order[index]];
    std::string label = "segments[" + index_text(index) + "]";
    assert_range(get(wire, "startBeat"), 0, kMaxSafeInteger, label + ".startBeat");
    assert_range(get(wire, "endBeat"), 0, kMaxSafeInteger, label + ".endBeat");
    assert_bass_segment_at(sorted, index);
  }
  return BassPlacement{std::move(sorted), std::move(sorted_qualities)};
}

bool wire_is_lick_material(const json::Value& material) {
  return is_js_object(material) && js::type_of(get(material, "lengthSteps")) == "number" &&
         get(material, "notes").is_array();
}

std::vector<Vocabulary<std::any>> read_lick_vocabulary(const json::Array& entries) {
  std::vector<Vocabulary<std::any>> out;
  for (std::size_t index = 0; index < entries.size(); ++index) {
    const json::Value& entry = entries[index];
    const json::Value& material = get(entry, "material");
    if (!wire_is_lick_material(material)) {
      continue;
    }
    std::string label = "lick vocabulary[" + index_text(out.size()) + "]";
    LickMaterial shape;
    shape.lengthSteps = *number_of(get(material, "lengthSteps"));
    const json::Array& notes = get(material, "notes").as_array();
    for (std::size_t at = 0; at < notes.size(); ++at) {
      std::string name = label + " notes[" + index_text(at) + "]";
      const json::Value& record = assert_record(notes[at], name);
      LickNote note;
      note.degree = assert_degree(get(record, "degree"), name + ".degree");
      note.step = assert_finite_number(get(record, "step"), name + ".step");
      note.velocity = assert_finite_number(get(record, "velocity"), name + ".velocity");
      const json::Value& alter = get(record, "alter");
      if (!is_undefined(alter)) {
        note.alter = assert_integer(alter, name + ".alter");
      }
      const json::Value& length = get(record, "lengthSteps");
      if (!is_undefined(length)) {
        note.lengthSteps = assert_finite_number(length, name + ".lengthSteps");
      }
      const json::Value& articulation = get(record, "articulation");
      if (!is_undefined(articulation)) {
        note.articulation = parse_articulation(
            assert_one_of(articulation, articulation_names(), name + ".articulation"));
      }
      for (std::string_view field : {"voice", "limb"}) {
        const json::Value& value = get(record, field);
        if (is_undefined(value)) {
          continue;
        }
        if (!value.is_string()) {
          throw InvalidInputError(name + "." + std::string(field) + " must be a string; received " +
                                  describe_rejected(value));
        }
        (field == "voice" ? note.voice : note.limb) = value.as_string();
      }
      shape.notes.push_back(std::move(note));
    }
    Vocabulary<std::any> typed = read_vocabulary_header(entry, index);
    typed.material = std::move(shape);
    out.push_back(std::move(typed));
  }
  return out;
}

void read_array_like(const json::Value& value, std::vector<json::Value>& elements,
                     json::Value& length) {
  if (value.is_array()) {
    elements.assign(value.as_array().begin(), value.as_array().end());
    length = json::Value(static_cast<double>(elements.size()));
  } else if (value.is_string()) {
    js::for_each_utf16_unit(value.as_string(), [&elements](char16_t unit) {
      elements.emplace_back(js::from_utf16(std::u16string_view(&unit, 1)));
    });
    length = json::Value(static_cast<double>(elements.size()));
  } else if (js::type_of(value) == "object") {
    length = get(value, "length");
    std::optional<double> count = number_of(length);
    for (double index = 0; count && index < *count && index < 2e6; index += 1) {
      elements.push_back(get(value, js::to_string(index)));
    }
  } else {
    length = undefined_value();
  }
}

std::optional<InstrumentProfile> read_named_stringed(const json::Value& named) {
  if (is_undefined(named)) {
    return std::nullopt;
  }
  const json::Value& kind = property_of(named, "kind");
  if (!js::strict_equals(kind, json::Value("stringed"))) {
    return std::nullopt;
  }
  return read_instrument_profile(named, "instrument");
}

}  // namespace cantus::ops
