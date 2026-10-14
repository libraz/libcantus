// The bass lick dictionary of ts/src/generate/bass/licks-data.ts.

#include "generate/bass/licks_data.h"

#include <any>
#include <array>
#include <string_view>

#include "cantus/core/validation.h"
#include "cantus/generate/drums.h"
#include "core/validation/validation.h"
#include "generate/bass/limits.gen.h"
#include "generate/drums/internal.h"

namespace cantus {

namespace {

/** A generated lick note, with its names still as text. */
struct LickNoteRecord {
  double degree;
  double step;
  double velocity;
  std::optional<double> alter;
  std::optional<double> lengthSteps;
  std::optional<std::string_view> articulation;
};

/** A generated BASS_LICKS entry, with its names still as text. */
struct LickRecord {
  std::string_view id;
  std::string_view genre;
  double difficulty;
  std::vector<std::string_view> articulations;
  SignatureSlot ts;
  GeneratedList<double> tempoRange;
  struct {
    double lengthSteps;
    std::vector<LickNoteRecord> notes;
  } material;
  struct {
    std::string_view basis;
    std::string_view note;
  } provenance;
  GeneratedList<std::string_view> sections;
  GeneratedList<std::string_view> fitsOver;
};

std::vector<BassLick> make_bass_licks() {
  static const std::vector<LickRecord> rows =
#include "generate/bass/bass_licks.gen.inc"
      ;
  std::vector<BassLick> out;
  for (const LickRecord& row : rows) {
    BassLick entry;
    entry.id = std::string(row.id);
    entry.genre = *parse_genre(row.genre);
    entry.difficulty = row.difficulty;
    for (std::string_view name : row.articulations) {
      entry.articulations.push_back(*parse_articulation(name));
    }
    entry.ts = row.ts.value;
    if (row.tempoRange.value) {
      const std::vector<double>& band = *row.tempoRange.value;
      entry.tempoRange = std::array<double, 2>{band[0], band[1]};
    }
    entry.material.lengthSteps = row.material.lengthSteps;
    for (const LickNoteRecord& record : row.material.notes) {
      LickNote note;
      note.degree = record.degree;
      note.step = record.step;
      note.velocity = record.velocity;
      note.alter = record.alter;
      note.lengthSteps = record.lengthSteps;
      if (record.articulation) {
        note.articulation = *parse_articulation(*record.articulation);
      }
      entry.material.notes.push_back(note);
    }
    entry.provenance.basis = *parse_provenance_basis(row.provenance.basis);
    entry.provenance.note = std::string(row.provenance.note);
    if (row.sections.value) {
      entry.sections.emplace();
      for (std::string_view name : *row.sections.value) {
        entry.sections->push_back(*parse_section(name));
      }
    }
    if (row.fitsOver.value) {
      entry.fitsOver.emplace();
      for (std::string_view name : *row.fitsOver.value) {
        entry.fitsOver->push_back(*parse_chord_quality(name));
      }
    }
    out.push_back(std::move(entry));
  }
  return out;
}

}  // namespace

const std::vector<BassLick> BASS_LICKS = make_bass_licks();

bool is_lick_material(const std::any& material) {
  return std::any_cast<LickMaterial>(&material) != nullptr;
}

void assert_lick_material(const LickMaterial& material, std::string_view label) {
  for (std::size_t index = 0; index < material.notes.size(); ++index) {
    const LickNote& note = material.notes[index];
    std::string name = std::string(label) + " notes[" + index_text(index) + "]";
    assert_degree(note.degree, name + ".degree");
    assert_finite_number(note.step, name + ".step");
    assert_finite_number(note.velocity, name + ".velocity");
    if (note.alter) {
      assert_integer(*note.alter, name + ".alter");
    }
    if (note.lengthSteps) {
      assert_finite_number(*note.lengthSteps, name + ".lengthSteps");
    }
  }
}

}  // namespace cantus
