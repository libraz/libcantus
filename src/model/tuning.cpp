#include "cantus/model/tuning.h"

#include "cantus/core/validation.h"
#include "js/number.h"

namespace cantus {

Tuning Tuning::of(const TuningTable& table) {
  // Every field is read off the table before edo() is handed it: a missing one must not take
  // the library's default.
  assert_finite_number(table.divisions, "tuning table.divisions");
  assert_finite_number(table.refFreq, "tuning table.refFreq");
  assert_finite_number(table.refStep, "tuning table.refStep");
  return Tuning(cantus::edo(table.divisions, table.refFreq, table.refStep));
}

Tuning Tuning::edo(int divisions, double ref_freq, double ref_step) {
  return Tuning(cantus::edo(divisions, ref_freq, ref_step));
}

Tuning Tuning::twelve_tet() { return of(TWELVE_TET); }

Tuning Tuning::from_data(const TuningTable& data) { return of(data); }

Tuning Tuning::from_json(const TuningTable& data) { return of(data); }

double Tuning::ratio_to_cents(double numerator, double denominator) {
  return cantus::ratio_to_cents(numerator, denominator);
}

double Tuning::cents_to_ratio(double cents) { return cantus::cents_to_ratio(cents); }

double Tuning::cents_between_freq(double a, double b) { return cantus::cents_between_freq(a, b); }

double Tuning::just_deviation_cents(int semitone_class) {
  return cantus::just_deviation_cents(semitone_class);
}

double Tuning::frequency_of(const NoteArg& note, const std::optional<TuningTable>& tuning) const {
  return cantus::frequency_of(note_to_midi(to_note_data(note)), tuning.value_or(table_));
}

double Tuning::frequency_of_step(double step, const std::optional<TuningTable>& tuning) const {
  return cantus::frequency_of(step, tuning.value_or(table_));
}

double Tuning::nearest_step(double freq, const std::optional<TuningTable>& tuning) const {
  return cantus::nearest_step(freq, tuning.value_or(table_));
}

double Tuning::step_of(double freq, const std::optional<TuningTable>& tuning) const {
  return cantus::step_of(freq, tuning.value_or(table_));
}

double Tuning::cents_from_nearest_step(double freq,
                                       const std::optional<TuningTable>& tuning) const {
  return cantus::cents_from_nearest_step(freq, tuning.value_or(table_));
}

double Tuning::cents_of_steps(double steps, const std::optional<TuningTable>& tuning) const {
  return cantus::cents_of_steps(steps, tuning.value_or(table_));
}

double Tuning::steps_of_cents(double cents, const std::optional<TuningTable>& tuning) const {
  return cantus::steps_of_cents(cents, tuning.value_or(table_));
}

bool Tuning::equals(const Tuning& other) const noexcept {
  return table_.refStep == other.table_.refStep && table_.refFreq == other.table_.refFreq &&
         table_.divisions == other.table_.divisions;
}

std::string Tuning::to_string() const {
  return js::to_string(table_.divisions) + "-EDO (step " + js::to_string(table_.refStep) + " = " +
         js::to_string(table_.refFreq) + " Hz)";
}

}  // namespace cantus
