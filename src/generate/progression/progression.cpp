// The chord-progression generator of ts/src/generate/progression/index.ts.

#include "generate/progression/progression.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>

#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "generate/progression/limits.gen.h"
#include "js/number.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

constexpr std::string_view kStyleNames[] =
#include "generate/progression/prog_styles.gen.inc"
    ;
static_assert(sizeof(kStyleNames) / sizeof(kStyleNames[0]) == PROG_STYLES.size(),
              "PROG_STYLES and ProgStyle disagree");

/** A generated borrowed-degree row: the name and the code. */
struct BorrowedDegreeRow {
  std::string_view name;
  int degree;
};

/** A generated borrowed-offset row: the degree code, as the object key, and its semitones. */
struct BorrowedOffsetRow {
  std::string_view degree;
  int offset;
};

/** A generated PRESETS entry, with its names still as text. */
struct PresetRecord {
  std::string_view id;
  std::string_view name;
  std::vector<int> degrees;
  std::string_view functional;
  std::vector<std::string_view> styles;
};

const std::vector<BorrowedDegreeRow> kBorrowedDegrees =
#include "generate/progression/borrowed_degrees.gen.inc"
    ;

const std::vector<BorrowedOffsetRow> kBorrowedOffsets =
#include "generate/progression/borrowed_offset.gen.inc"
    ;

int borrowed_code(std::string_view name) {
  for (const BorrowedDegreeRow& row : kBorrowedDegrees) {
    if (row.name == name) {
      return row.degree;
    }
  }
  return 0;
}

std::vector<ProgressionPreset> make_presets() {
  static const std::vector<PresetRecord> rows =
#include "generate/progression/presets.gen.inc"
      ;
  std::vector<ProgressionPreset> out;
  for (const PresetRecord& row : rows) {
    ProgressionPreset preset;
    preset.id = std::string(row.id);
    preset.name = std::string(row.name);
    preset.degrees = row.degrees;
    preset.functional = *parse_prog_function(row.functional);
    for (std::string_view style : row.styles) {
      preset.styles.push_back(*parse_prog_style(style));
    }
    out.push_back(std::move(preset));
  }
  return out;
}

/** Chromatic semitone offset from the tonic for a borrowed degree (`BORROWED_OFFSET[degree]`). */
int borrowed_offset(int degree) {
  std::string key = js::to_string(degree);
  for (const BorrowedOffsetRow& row : kBorrowedOffsets) {
    if (row.degree == key) {
      return row.offset;
    }
  }
  return 0;
}

/** Root pitch class of a scale degree in the given key, including borrowed degrees. */
int degree_to_root_pc(int degree, const KeyScale& key) {
  if (degree >= 1 && degree <= 7) {
    // Degrees are read in the key's heptatonic frame, as the numerals are.
    std::vector<int> tones = scale_tones_in_degree_order(heptatonic_frame_of(key));
    return static_cast<std::size_t>(degree - 1) < tones.size()
               ? tones[static_cast<std::size_t>(degree - 1)]
               : key.rootPc % 12;
  }
  int offset = borrowed_offset(degree);
  return (((key.rootPc % 12) + offset) % 12 + 12) % 12;
}

/** Diatonic (or borrowed) triad quality of a degree in the given key. */
ChordQuality auto_quality(int degree, const KeyScale& key, bool harmonic_dominant) {
  if (degree >= 1 && degree <= 7) {
    // A cadence-oriented progression needs a leading tone in minor too; a mode keeps its own fifth
    // degree.
    if (harmonic_dominant && cadences_through_raised_seventh(key) && degree == 5) {
      return ChordQuality::kMaj;
    }
    return diatonic_triad(degree, heptatonic_frame_of(key)).quality;
  }
  if (degree == 14) {
    return ChordQuality::kDim;
  }
  if (degree == 12) {
    return ChordQuality::kMin;
  }
  return ChordQuality::kMaj;
}

/** One resolved step of a preset cycle. */
struct CycleStep {
  std::optional<int> degree;
  int rootPc = 0;
  ChordQuality quality = ChordQuality::kMaj;
};

/** Resolve a preset's degrees against a key, one step per degree. */
std::vector<CycleStep> resolve_cycle(const std::vector<int>& degrees, const KeyScale& key,
                                     const std::optional<ChordQuality>& ext,
                                     bool harmonic_dominant) {
  std::vector<CycleStep> steps;
  for (int degree : degrees) {
    CycleStep step;
    step.rootPc = degree_to_root_pc(degree, key);
    step.quality = ext ? *ext : auto_quality(degree, key, harmonic_dominant);
    if (degree >= 1 && degree <= 7) {
      step.degree = degree;
    }
    steps.push_back(step);
  }
  // The fallback carries no degree at all: it is on none of the degrees one to seven.
  if (steps.empty()) {
    steps.push_back(CycleStep{std::nullopt, degree_to_root_pc(1, key), ChordQuality::kMaj});
  }
  return steps;
}

/** The pitch classes of the degrees this key can make a local tonic. */
std::set<int> tonicizable_root_pcs(const KeyScale& key) {
  std::set<int> out;
  for (const TonicizableDegree& degree : tonicizable_degrees(key)) {
    out.insert(degree.rootPc);
  }
  return out;
}

/** Whether the chord a secondary dominant would resolve to can stand as a local tonic. */
bool can_be_tonicized(const ChordSpan& span, const std::set<int>& tonicizable) {
  int root = static_cast<int>(span.rootPc);
  if (tonicizable.count(root) == 0) {
    return false;
  }
  std::optional<int> fifth = fifth_pc_of(make_chord(span.rootPc, span.quality));
  return fifth && *fifth == (root + 7) % 12;
}

}  // namespace

const TimeSignature kProgressionDefaultTs =
#include "generate/progression/default_ts.gen.inc"
    ;

const BorrowedDegrees BORROWED_DEGREES = {borrowed_code("bVI"),  borrowed_code("bVII"),
                                          borrowed_code("bIII"), borrowed_code("iv"),
                                          borrowed_code("bII"),  borrowed_code("sharpIV")};

std::string_view to_string(ProgStyle style) { return kStyleNames[static_cast<std::size_t>(style)]; }

std::optional<ProgStyle> parse_prog_style(std::string_view name) {
  for (ProgStyle style : PROG_STYLES) {
    if (to_string(style) == name) {
      return style;
    }
  }
  return std::nullopt;
}

std::string_view to_string(ProgFunction function) {
  switch (function) {
    case ProgFunction::kLoop:
      return "loop";
    case ProgFunction::kTensionBuild:
      return "tensionBuild";
    case ProgFunction::kCadenceStrong:
      return "cadenceStrong";
    case ProgFunction::kStable:
      return "stable";
  }
  return "loop";
}

std::optional<ProgFunction> parse_prog_function(std::string_view name) {
  for (ProgFunction function : {ProgFunction::kLoop, ProgFunction::kTensionBuild,
                                ProgFunction::kCadenceStrong, ProgFunction::kStable}) {
    if (to_string(function) == name) {
      return function;
    }
  }
  return std::nullopt;
}

std::vector<std::string_view> prog_style_names() {
  return std::vector<std::string_view>(std::begin(kStyleNames), std::end(kStyleNames));
}

const std::vector<ProgressionPreset>& builtin_presets() {
  static const std::vector<ProgressionPreset> presets = make_presets();
  return presets;
}

bool is_borrowed_degree(double degree) {
  return std::any_of(kBorrowedDegrees.begin(), kBorrowedDegrees.end(),
                     [degree](const BorrowedDegreeRow& row) { return row.degree == degree; });
}

std::vector<ProgressionPreset> progressions() { return builtin_presets(); }

std::vector<ProgressionPreset> progressions_by_style(ProgStyle style) {
  std::vector<ProgressionPreset> out;
  for (const ProgressionPreset& preset : builtin_presets()) {
    if (std::find(preset.styles.begin(), preset.styles.end(), style) != preset.styles.end()) {
      out.push_back(preset);
    }
  }
  return out;
}

ProgressionPreset preset_for(const std::optional<ProgStyle>& style, const std::string& named,
                             const ResolvedContext& ctx) {
  // A style no preset claims is a caller error, exactly as an unknown presetId is.
  std::vector<const ProgressionPreset*> pool;
  if (style) {
    for (const ProgressionPreset& preset : builtin_presets()) {
      if (std::find(preset.styles.begin(), preset.styles.end(), *style) != preset.styles.end()) {
        pool.push_back(&preset);
      }
    }
  }
  if (pool.empty()) {
    throw InvalidInputError("Unknown progression style: " + named);
  }
  std::int64_t index =
      ctx.part("progression")
          .range(0, static_cast<std::int64_t>(pool.size()) - 1, {std::string("preset")});
  return *pool[static_cast<std::size_t>(index)];
}

ProgressionPreset pick_progression_preset(ProgStyle style, const GenerationContextInput& ctx) {
  ResolvedContext resolved = resolve_context(ctx);
  return preset_for(style, std::string(to_string(style)), resolved);
}

std::vector<ChordSpan> generate_progression_with(const ProgressionPlan& plan,
                                                 const ResolvedContext& ctx) {
  std::vector<CycleStep> cycle =
      resolve_cycle(plan.degrees, plan.key, plan.ext, plan.cadenceStrong);
  // One chord per bar of the meter the caller counts in.
  std::vector<ChordSpan> chords;
  for (double bar = 0; bar < plan.bars; bar += 1) {
    const CycleStep& step = cycle[static_cast<std::size_t>(bar) % cycle.size()];
    ChordSpan chord;
    chord.rootPc = step.rootPc;
    chord.quality = step.quality;
    chord.startBeat = bar * plan.barBeats;
    if (step.degree) {
      chord.degree = *step.degree;
    }
    chords.push_back(chord);
  }

  double harmonic = ctx.harmonic.value_or(PROGRESSION_DEFAULT_HARMONIC);
  if (harmonic > 0) {
    int tonic_pc = ((plan.key.rootPc % 12) + 12) % 12;
    std::set<int> tonicizable = tonicizable_root_pcs(plan.key);
    Draw draw = ctx.part("progression");
    int tonic_statements = static_cast<int>(
        std::count_if(chords.begin(), chords.end(),
                      [tonic_pc](const ChordSpan& chord) { return chord.rootPc == tonic_pc; }));
    for (std::size_t i = 0; i + 1 < chords.size(); ++i) {
      const ChordSpan cur = chords[i];
      const ChordSpan next = chords[i + 1];
      int next_root = static_cast<int>(next.rootPc);
      int dom_root = (next_root + 7) % 12;
      bool targets_tonic = (next_root - tonic_pc + 12) % 12 == 0;
      bool is_last_tonic_statement = cur.rootPc == tonic_pc && tonic_statements <= 1;
      Chord dominant_chord = make_chord(dom_root, ChordQuality::kDom7);
      bool already_secondary =
          cur.rootPc == dom_root && sounds_dominant_seventh(make_chord(cur.rootPc, cur.quality));
      // A dominant seventh the key already contains is a native chord of it, not an applied one.
      bool is_native_dominant = is_diatonic_chord(dominant_chord, plan.key);
      // A secondary dominant inserted at i-1 resolves onto this chord; replacing it here would
      // orphan that dominant.
      bool is_resolution_target = i > 0 && chords[i - 1].secondaryDominant.value_or(false) == true;
      bool takes_no_dominant = !can_be_tonicized(next, tonicizable);
      if (targets_tonic || is_last_tonic_statement || already_secondary || is_resolution_target ||
          takes_no_dominant || is_native_dominant) {
        continue;
      }
      if (draw.prob(harmonic, {std::string("reharmonize"), static_cast<double>(i)})) {
        if (cur.rootPc == tonic_pc) {
          tonic_statements -= 1;
        }
        ChordSpan replaced;
        replaced.rootPc = dom_root;
        replaced.quality = ChordQuality::kDom7;
        replaced.startBeat = cur.startBeat;
        replaced.secondaryDominant = true;
        chords[i] = replaced;
      }
    }
  }
  return chords;
}

std::vector<ChordSpan> generate_progression(const ProgressionOptions& opts) {
  assert_positive_int(opts.bars, "progression bars");
  assert_generation_budget(opts.bars, "progression chords");
  // The key is resolved once, here at the boundary, so a tonic contradicting its scale is refused.
  ProgressionPlan plan;
  plan.key = resolve_key(opts.key).scale;
  ResolvedContext ctx = resolve_context(opts.ctx);
  std::optional<ProgressionPreset> preset;
  if (opts.preset) {
    if (opts.preset->degrees.empty()) {
      throw InvalidInputError("progression preset must name at least one degree");
    }
    ProgressionPreset custom;
    for (std::size_t index = 0; index < opts.preset->degrees.size(); ++index) {
      int degree = opts.preset->degrees[index];
      assert_degree(degree, "progression preset degrees[" + index_text(index) + "]");
      bool supported = (degree >= 1 && degree <= 7) || is_borrowed_degree(degree);
      if (!supported) {
        throw InvalidInputError("progression preset degrees[" + index_text(index) +
                                "] is not a supported progression degree; received " +
                                js::to_string(degree));
      }
      custom.degrees.push_back(degree);
    }
    custom.functional = opts.preset->functional.value_or(ProgFunction::kLoop);
    preset = custom;
  }
  if (!preset && opts.presetId) {
    for (const ProgressionPreset& candidate : builtin_presets()) {
      if (candidate.id == *opts.presetId) {
        preset = candidate;
      }
    }
    if (!preset) {
      throw InvalidInputError("Unknown progression preset: " + *opts.presetId);
    }
  }
  if (!preset) {
    preset = preset_for(opts.style, std::string(to_string(opts.style)), ctx);
  }
  plan.ext = opts.ext;
  plan.degrees = preset->degrees;
  plan.cadenceStrong = preset->functional == ProgFunction::kCadenceStrong;
  // One chord per bar of the meter the caller counts in.
  plan.barBeats = beats_per_bar(opts.ts.value_or(MeterArg(kProgressionDefaultTs)));
  plan.bars = opts.bars;
  return generate_progression_with(plan, ctx);
}

}  // namespace cantus
