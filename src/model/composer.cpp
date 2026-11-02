#include "cantus/model/composer.h"

#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "cantus/model/instrument.h"
#include "js/math.h"
#include "model/shared.h"

namespace cantus {

namespace {

/** A copy of the dials, carrying only the ones the caller named (`copyComplexity`). */
Complexity copy_complexity(const Complexity& complexity) {
  Complexity copy;
  auto dial = [](const std::optional<double>& value, const char* name) -> std::optional<double> {
    if (!value) {
      return std::nullopt;
    }
    return assert_finite_number(*value, std::string("composer complexity ") + name);
  };
  copy.rhythmic = dial(complexity.rhythmic, "rhythmic");
  copy.harmonic = dial(complexity.harmonic, "harmonic");
  copy.ornament = dial(complexity.ornament, "ornament");
  copy.difficulty = dial(complexity.difficulty, "difficulty");
  return copy;
}

/** The instrument each part is written for, each one validated (`copyInstruments`). */
std::map<std::string, InstrumentProfile> copy_instruments(
    const std::map<std::string, InstrumentProfileArg>& instruments) {
  std::map<std::string, InstrumentProfile> copy;
  for (const auto& [part, profile] : instruments) {
    copy.emplace(part, Instrument::of(profile).data());
  }
  return copy;
}

/** The context half of a set of settings, as the generators read it (`contextOf`). */
GenerationContext context_of(const ComposerData& settings,
                             const std::shared_ptr<const PositionalDraw>& rng) {
  GenerationContext ctx;
  ctx.seed = settings.seed;
  ctx.algorithmVersion = settings.algorithmVersion;
  if (rng) {
    ctx.rng = *rng;
  }
  ctx.bpm = settings.bpm;
  if (settings.complexity) {
    ctx.complexity = copy_complexity(*settings.complexity);
  }
  ctx.instruments = settings.instruments;
  ctx.vocabulary = settings.vocabulary;
  return ctx;
}

/**
 * Where a harmonized span ends (`harmonizedSpan`): the melody's own end, and never before the
 * last chord has sounded for as long as the slot before it.
 */
double harmonized_span(double melody_end, const std::vector<ChordSpan>& chords, double bar_beats) {
  if (chords.empty()) {
    return melody_end;
  }
  const ChordSpan& last = chords.back();
  double slot =
      chords.size() < 2 ? bar_beats : last.startBeat - chords[chords.size() - 2].startBeat;
  return js::max(melody_end, last.startBeat + slot);
}

}  // namespace

Composer::Composer(const ComposerOptions& options) {
  ResolveMetersOptions meters;
  meters.meters = options.meters;
  settings_.meters = resolve_meters(meters, "composer meters");
  if (options.key) {
    settings_.key = resolve_key(*options.key);
  }
  settings_.bpm = options.bpm;
  if (options.complexity) {
    settings_.complexity = copy_complexity(*options.complexity);
  }
  if (options.instruments) {
    settings_.instruments = copy_instruments(*options.instruments);
  }
  settings_.vocabulary = options.vocabulary;
  if (options.rng) {
    // Carried by reference: a copy of a source would be a second stream.
    rng_ = std::make_shared<const PositionalDraw>(*options.rng);
  }
  // Resolved through the resolver every generator reads the settings through.
  GenerationContext ctx = context_of(settings_, rng_);
  ctx.seed = options.seed;
  ctx.algorithmVersion = options.algorithmVersion;
  ResolvedContext resolved = resolve_context(GenerationContextInput(ctx));
  settings_.seed = resolved.seed;
  settings_.algorithmVersion = resolved.algorithmVersion;
}

Composer Composer::of(const ComposerOptions& options) { return Composer(options); }

namespace {

/** The options a composer's plain data stands for. */
ComposerOptions options_of(const ComposerData& data) {
  ComposerOptions options;
  options.meters = MeterArg(data.meters);
  if (data.key) {
    options.key = KeyArg(*data.key);
  }
  options.bpm = data.bpm;
  options.seed = data.seed;
  options.algorithmVersion = data.algorithmVersion;
  options.complexity = data.complexity;
  if (data.instruments) {
    std::map<std::string, InstrumentProfileArg> instruments;
    for (const auto& [part, profile] : *data.instruments) {
      instruments.emplace(part, InstrumentProfileArg(profile));
    }
    options.instruments = std::move(instruments);
  }
  options.vocabulary = data.vocabulary;
  return options;
}

}  // namespace

Composer Composer::from_data(const ComposerData& data) { return Composer(options_of(data)); }

Composer Composer::from_json(const ComposerData& data) { return Composer(options_of(data)); }

Composer Composer::with(const ComposerOptions& patch) const {
  ComposerOptions options = options_of(settings_);
  lay_over(options.key, patch.key);
  lay_over(options.meters, patch.meters);
  lay_over(options.bpm, patch.bpm);
  lay_over(options.seed, patch.seed);
  lay_over(options.complexity, patch.complexity);
  lay_over(options.instruments, patch.instruments);
  lay_over(options.vocabulary, patch.vocabulary);
  lay_over(options.algorithmVersion, patch.algorithmVersion);
  Composer next(options);
  // The source is the same stream across the variation unless the patch names another.
  next.rng_ = patch.rng ? std::make_shared<const PositionalDraw>(*patch.rng) : rng_;
  return next;
}

Composer Composer::with_key(const KeyArg& key) const {
  ComposerOptions patch;
  patch.key = key;
  return with(patch);
}

Composer Composer::with_seed(std::uint32_t seed) const {
  ComposerOptions patch;
  patch.seed = seed;
  return with(patch);
}

Composer Composer::with_complexity(const Complexity& complexity) const {
  ComposerOptions patch;
  patch.complexity = complexity;
  return with(patch);
}

ResolvedKey Composer::require_key(const char* part) const {
  if (!settings_.key) {
    throw InvalidInputError(std::string("composer ") + part +
                            " needs a key for the part it writes; the composer names none — "
                            "give it one, or take the key harmonize reads off a melody and pass "
                            "it on with with({ key })");
  }
  return *settings_.key;
}

TimeSignature Composer::unchanging_meter(const char* part) const {
  if (settings_.meters.size() > 1) {
    throw InvalidInputError(std::string("composer ") + part +
                            " needs one meter for the whole part; the composer changes meter");
  }
  return meter_at(0, MeterArg(settings_.meters));
}

ScoreOptions Composer::score_options(const std::optional<ResolvedKey>& key) const {
  ScoreOptions opts;
  opts.meters = MeterArg(settings_.meters);
  if (settings_.bpm) {
    opts.tempo = ScoreTempoArg(*settings_.bpm);
  }
  if (key) {
    opts.key = KeyArg(*key);
  }
  return opts;
}

Timeline Composer::progression(const ComposerProgressionOptions& opts) const {
  ResolvedKey key = require_key("progression");
  TimeSignature ts = unchanging_meter("progression");
  ProgressionOptions options(KeyArg(key), opts.style, opts.bars);
  options.presetId = opts.presetId;
  options.preset = opts.preset;
  options.ext = opts.ext;
  options.ts = MeterArg(ts);
  options.ctx = GenerationContextInput(context());
  std::vector<ChordSpan> chords = generate_progression(options);
  return Timeline::from_chords(chords, opts.bars * beats_per_bar(MeterArg(ts)), KeyArg(key));
}

Score Composer::drums(const DrumsOptions& opts) const {
  DrumsOptions options = opts;
  options.ts = MeterArg(unchanging_meter("drums"));
  options.ctx = GenerationContextInput(context());
  std::vector<NoteEvent> notes;
  for (const DrumHit& hit : generate_drums(options)) {
    NoteEvent note;
    note.pitch = hit.pitch;
    note.startBeat = hit.startBeat;
    note.durationBeat = hit.durationBeat;
    note.velocity = static_cast<int>(hit.velocity);
    note.articulation = hit.articulation;
    notes.push_back(note);
  }
  return Score::of(notes, score_options());
}

Score Composer::bass(const BassSource& source, const BassLineSettings& opts) const {
  const std::vector<BassSegment>& segments = std::holds_alternative<Timeline>(source)
                                                 ? std::get<Timeline>(source).segments()
                                                 : std::get<std::vector<BassSegment>>(source);
  ResolvedKey key = require_key("bass");
  std::vector<BassSegmentArg> placed;
  for (const BassSegment& segment : segments) {
    placed.push_back(BassSegmentArg{segment.startBeat, segment.endBeat, ChordArg(segment.chord)});
  }
  BassLineOptions options(std::move(placed), KeyArg(key));
  options.style = opts.style;
  options.octave = opts.octave;
  if (opts.instrument) {
    options.instrument =
        InstrumentProfileArg(to_stringed_profile(*opts.instrument, "bass instrument"));
  }
  options.budget = opts.budget;
  options.ts = MeterArg(settings_.meters);
  options.ctx = GenerationContextInput(context());
  return Score::of(generate_bass_line(options), score_options(key));
}

Score Composer::counter_melody(const Score& melody, const CounterMelodySettings& opts) const {
  ResolvedKey key = require_key("counterMelody");
  CounterMelodyOptions options(melody.notes(), KeyArg(key));
  options.timeline = opts.timeline;
  options.chordAt = opts.chordAt;
  options.chordChangeBeats = opts.chordChangeBeats;
  options.register_ = opts.register_;
  options.rhythm = opts.rhythm;
  options.profile = opts.profile;
  options.weights = opts.weights;
  options.pitchLow = opts.pitchLow;
  options.pitchHigh = opts.pitchHigh;
  options.ts = MeterArg(settings_.meters);
  options.ctx = GenerationContextInput(context());
  return Score::of(generate_counter_melody(options), score_options(key));
}

HarmonizedMelody Composer::harmonize(const Score& melody,
                                     const ComposerHarmonizeOptions& opts) const {
  HarmonizeOptions options(melody.notes());
  options.harmonicRhythm = opts.harmonicRhythm;
  options.reharmonize = opts.reharmonize;
  options.placement = opts.placement;
  options.phraseEnds = opts.phraseEnds;
  options.budget = opts.budget;
  if (settings_.key) {
    options.key = KeyArg(*settings_.key);
  }
  options.ts = MeterArg(settings_.meters);
  options.ctx = GenerationContextInput(context());
  HarmonizeResult result = harmonize_melody(options);
  Score moved = melody.transpose(result.transposeSemitones);
  double last = result.chords.empty() ? 0 : result.chords.back().startBeat;
  double total = harmonized_span(moved.total_beats(), result.chords,
                                 beats_per_bar_at(last, MeterArg(settings_.meters)));
  return HarmonizedMelody{Timeline::from_chords(result.chords, total, KeyArg(result.key)),
                          Score::of(moved.notes(), score_options(result.key)),
                          result.transposeSemitones};
}

CompositionPlan Composer::plan(const ReferenceProfile& reference,
                               const CompositionPlanOptions& opts) const {
  GenerationContext ctx = context();
  if (ctx.rng) {
    throw InvalidInputError(
        "composer plan cannot record a caller-held rng; give the composer a seed instead");
  }
  CompositionPlanOptions options = opts;
  if (!options.key && settings_.key) {
    options.key = KeyArg(*settings_.key);
  }
  options.ctx = GenerationContextInput(ctx);
  return derive_composition_plan(reference, options);
}

Score Composer::melody(const CompositionPlan& plan, const MelodyOptions& opts) const {
  // Generated first: the generator is what validates the plan read below.
  std::vector<NoteEvent> notes = generate_melody(plan, opts);
  ScoreOptions score;
  score.meters = MeterArg(plan.meters);
  if (!plan.keys.empty()) {
    score.key = KeyArg(plan.keys.front());
  }
  if (settings_.bpm) {
    score.tempo = ScoreTempoArg(*settings_.bpm);
  }
  return Score::of(notes, score);
}

namespace {

bool same_profile(const InstrumentProfile& a, const InstrumentProfile& b) {
  if (a.index() != b.index()) {
    return false;
  }
  if (const auto* stringed = std::get_if<StringedProfile>(&a)) {
    const auto& theirs = std::get<StringedProfile>(b);
    return stringed->name == theirs.name && stringed->tuning == theirs.tuning &&
           stringed->frets == theirs.frets && stringed->maxStretch == theirs.maxStretch &&
           stringed->articulations == theirs.articulations &&
           stringed->polyphony == theirs.polyphony && stringed->fretless == theirs.fretless;
  }
  const auto& kit = std::get<PercussionProfile>(a);
  const auto& theirs = std::get<PercussionProfile>(b);
  return kit.name == theirs.name && kit.limbs == theirs.limbs && kit.reach == theirs.reach &&
         kit.overdub == theirs.overdub && kit.articulations == theirs.articulations &&
         kit.polyphony == theirs.polyphony;
}

bool same_meters(const MeterMap& a, const MeterMap& b) {
  if (a.size() != b.size()) {
    return false;
  }
  for (std::size_t i = 0; i < a.size(); ++i) {
    if (a[i].startBeat != b[i].startBeat || a[i].ts.numerator != b[i].ts.numerator ||
        a[i].ts.denominator != b[i].ts.denominator || a[i].ts.grouping != b[i].ts.grouping) {
      return false;
    }
  }
  return true;
}

/**
 * Two vocabulary entries by every field but the material, which a C++ value of unknown type
 * cannot be compared through; the materials only have to be of the same type.
 */
bool same_entry(const Vocabulary<std::any>& a, const Vocabulary<std::any>& b) {
  return a.id == b.id && a.genre == b.genre && a.material.type() == b.material.type() &&
         a.articulations == b.articulations && a.fitsOver == b.fitsOver &&
         a.sections == b.sections && a.tempoRange == b.tempoRange && a.difficulty == b.difficulty &&
         a.provenance.basis == b.provenance.basis && a.provenance.note == b.provenance.note &&
         (a.ts.has_value() == b.ts.has_value() &&
          (!a.ts || (a.ts->numerator == b.ts->numerator && a.ts->denominator == b.ts->denominator &&
                     a.ts->grouping == b.ts->grouping)));
}

bool same_key(const std::optional<ResolvedKey>& a, const std::optional<ResolvedKey>& b) {
  if (!a || !b) {
    return !a && !b;
  }
  return a->scale.rootPc == b->scale.rootPc && a->scale.modeMask12 == b->scale.modeMask12 &&
         a->tonic.letter == b->tonic.letter && a->tonic.alter == b->tonic.alter &&
         a->variant == b->variant;
}

bool same_complexity(const std::optional<Complexity>& a, const std::optional<Complexity>& b) {
  if (!a || !b) {
    return !a && !b;
  }
  return a->rhythmic == b->rhythmic && a->harmonic == b->harmonic && a->ornament == b->ornament &&
         a->difficulty == b->difficulty;
}

}  // namespace

bool Composer::equals(const Composer& other) const {
  const ComposerData& mine = settings_;
  const ComposerData& theirs = other.settings_;
  bool instruments = mine.instruments.has_value() == theirs.instruments.has_value();
  if (instruments && mine.instruments) {
    instruments = mine.instruments->size() == theirs.instruments->size();
    for (auto a = mine.instruments->begin(), b = theirs.instruments->begin();
         instruments && a != mine.instruments->end(); ++a, ++b) {
      instruments = a->first == b->first && same_profile(a->second, b->second);
    }
  }
  bool vocabulary = mine.vocabulary.has_value() == theirs.vocabulary.has_value();
  if (vocabulary && mine.vocabulary) {
    vocabulary = mine.vocabulary->size() == theirs.vocabulary->size();
    for (std::size_t i = 0; vocabulary && i < mine.vocabulary->size(); ++i) {
      vocabulary = same_entry((*mine.vocabulary)[i], (*theirs.vocabulary)[i]);
    }
  }
  // A source is compared by identity: the numbers it will hand out cannot be read from it.
  return same_meters(mine.meters, theirs.meters) && same_key(mine.key, theirs.key) &&
         mine.bpm == theirs.bpm && mine.seed == theirs.seed &&
         mine.algorithmVersion == theirs.algorithmVersion &&
         same_complexity(mine.complexity, theirs.complexity) && instruments && vocabulary &&
         rng_ == other.rng_;
}

GenerationContext Composer::context() const { return context_of(settings_, rng_); }

ComposerData Composer::data() const { return settings_; }

}  // namespace cantus
