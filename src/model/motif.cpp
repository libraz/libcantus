#include "cantus/model/motif.h"

#include <utility>

#include "cantus/core/validation.h"
#include "generate/motif/motif.h"
#include "model/shared.h"

namespace cantus {

namespace {

/** Defensive copy of one note, carrying only the fields a motif note holds (`copyNote`). */
NoteEvent copy_motif_note(const NoteEvent& note) {
  NoteEvent copy;
  copy.pitch = note.pitch;
  copy.startBeat = without_negative_zero(note.startBeat);
  copy.durationBeat = without_negative_zero(note.durationBeat);
  return copy;
}

/** Defensive copy of a cell, its notes checked as a whole before they are copied (`copyCell`). */
MotifCell copy_cell(const MotifCell& cell) {
  MotifCell copy;
  for (const NoteEvent& note : assert_note_events(cell.notes, "motif notes")) {
    copy.notes.push_back(copy_motif_note(note));
  }
  return copy;
}

}  // namespace

Motif::Motif(const MotifCell& cell) : cell_(copy_cell(cell)) {}

Motif Motif::generate(const MotifGenerateOptions& opts) {
  MotifOptions options(opts.key, opts.bars);
  if (opts.chord) {
    options.chord = ChordArg(to_chord_data(*opts.chord));
  }
  options.ts = opts.ts;
  options.contour = opts.contour;
  options.jitter = opts.jitter;
  options.ctx = opts.ctx;
  return Motif(generate_motif(options));
}

Motif Motif::from_notes(const std::vector<NoteEvent>& notes) { return Motif(MotifCell{notes}); }

Motif Motif::from_data(const MotifCell& cell) { return Motif(cell); }

Motif Motif::from_json(const MotifCell& cell) { return Motif(cell); }

double Motif::total_beats() const { return cell_span(cell_.notes); }

Motif Motif::transform(MotifTransform kind, std::optional<double> amount,
                       const std::optional<KeyArg>& key) const {
  return Motif(transform_motif(cell_, kind, amount, key));
}

Motif Motif::develop(const ChordTimeline& timeline, const KeyArg& key, int bars,
                     const MeterArg& ts) const {
  return Motif(develop_motif(cell_, timeline, key, bars, ts));
}

Motif Motif::develop(const Timeline& timeline, const KeyArg& key, int bars,
                     const MeterArg& ts) const {
  return develop(timeline.chord_timeline(), key, bars, ts);
}

Nullable<MotifRelation> Motif::relate_to(const Motif& other,
                                         const std::optional<KeyArg>& key) const {
  return relate_motifs(motif_from_notes(cell_.notes), motif_from_notes(other.notes()), key);
}

double Motif::similarity_to(const Motif& other) const {
  return melodic_similarity(MelodicPhraseArg(cell_.notes), MelodicPhraseArg(other.notes()));
}

Score Motif::to_score(const ScoreOptions& opts) const {
  return Score::of(motif_to_note_events(cell_), opts);
}

bool Motif::equals(const Motif& other) const {
  const std::vector<NoteEvent>& theirs = other.notes();
  if (cell_.notes.size() != theirs.size()) {
    return false;
  }
  for (std::size_t index = 0; index < theirs.size(); ++index) {
    const NoteEvent& note = cell_.notes[index];
    if (note.pitch != theirs[index].pitch || note.startBeat != theirs[index].startBeat ||
        note.durationBeat != theirs[index].durationBeat) {
      return false;
    }
  }
  return true;
}

}  // namespace cantus
