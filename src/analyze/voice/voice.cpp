// Label every note of a voice with its theory roles: ts/src/analyze/voice/index.ts.

#include "analyze/voice/voice.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <string>

#include "analyze/adjacency.h"
#include "cantus/core/errors.h"
#include "cantus/core/interval.h"
#include "cantus/core/limits.h"
#include "cantus/core/pitch.h"
#include "cantus/core/validation.h"
#include "cantus/theory/counterpoint.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** A key and the number it stands for. */
struct NamedInt {
  std::string_view name;
  int value;
};

/**
 * The extension each interval class above the root forms: a flat, natural or raised ninth to 9,
 * an eleventh to 11, and a flat or natural thirteenth to 13 (`TENSION_DEGREE_BY_INTERVAL`).
 */
constexpr NamedInt kTensionDegreeByInterval[] =
#include "analyze/voice/tension_degree_by_interval.gen.inc"
    ;

/**
 * The interval classes forming an extension every chord takes: the natural ninth, eleventh and
 * thirteenth (`NATURAL_TENSION_INTERVAL_LIST`).
 */
constexpr int kNaturalTensionIntervals[] =
#include "analyze/voice/natural_tension_interval_list.gen.inc"
    ;

constexpr std::array<std::string_view, 5> kSuspensionNames = {"sus4-3", "sus6-5", "sus7-6",
                                                              "sus9-8", "sus2-3"};
constexpr std::array<std::string_view, 11> kKindNames = {
    "chordTone",    "tension",      "avoid",  "passing",         "neighbor",   "suspension",
    "appoggiatura", "anticipation", "escape", "needsResolution", "leadingTone"};

/**
 * The extension an interval class above the root names, or nullopt when it names none
 * (`tensionDegree`): a raised ninth is not the thirteenth a catch-all would name it.
 */
std::optional<int> tension_degree(double ic) {
  std::string key = js::to_string(ic);
  for (const NamedInt& row : kTensionDegreeByInterval) {
    if (row.name == key) {
      return row.value;
    }
  }
  return std::nullopt;
}

bool is_natural_tension_interval(double ic) {
  return std::find(std::begin(kNaturalTensionIntervals), std::end(kNaturalTensionIntervals), ic) !=
         std::end(kNaturalTensionIntervals);
}

bool includes(const std::vector<double>& values, double value) {
  return std::find(values.begin(), values.end(), value) != values.end();
}

/** Whether two pitches are a step apart (`isStep`). */
bool is_step(double a, double b) {
  double d = std::fabs(a - b);
  return d == 1 || d == 2;
}

/**
 * Interval class of a pitch above the actual sounding bass (`intervalAboveBass`): the lowest
 * pitch among the other sounding voices when one lies below the note, else the chord's bass.
 */
double interval_above_bass(double pitch, const std::vector<OtherVoice>& others,
                           const Chord& chord) {
  double bass = std::numeric_limits<double>::infinity();
  for (const OtherVoice& other : others) {
    bass = js::min(bass, other.raw_pitch());
  }
  if (std::isfinite(bass) && bass < pitch) {
    return js::floor_mod(pitch - bass, 12);
  }
  double ref = chord.bassPc ? *chord.bassPc : chord.rootPc;
  return js::floor_mod(pitch_class_of(pitch) - pitch_class_of(ref), 12);
}

/** The figure a suspended interval class names, from its first interval alone (`suspendedFigure`).
 */
std::optional<SuspensionFigure> suspended_figure(double ic, double delta) {
  if (delta > 0) {
    // Resolving upward is the 2-3 only from a second above the bass.
    if (ic == 1 || ic == 2) {
      return SuspensionFigure::kSus2_3;
    }
    return std::nullopt;
  }
  if (ic == 1 || ic == 2) {
    return SuspensionFigure::kSus9_8;
  }
  if (ic == 10 || ic == 11) {
    return SuspensionFigure::kSus7_6;
  }
  if (ic == 5 || ic == 6) {
    return SuspensionFigure::kSus4_3;
  }
  if (ic == 8 || ic == 9) {
    return SuspensionFigure::kSus6_5;
  }
  // Any other interval above the bass is a downward-resolving dissonance with no standard figure.
  return std::nullopt;
}

/** The interval classes above the bass each figure resolves to (`SUSPENSION_RESOLUTIONS`). */
std::vector<double> suspension_resolutions(SuspensionFigure figure) {
  switch (figure) {
    case SuspensionFigure::kSus4_3:
      return {3, 4};
    case SuspensionFigure::kSus6_5:
      return {7};
    case SuspensionFigure::kSus7_6:
      return {8, 9};
    case SuspensionFigure::kSus9_8:
      return {0};
    case SuspensionFigure::kSus2_3:
      return {3, 4};
  }
  return {};
}

/**
 * Classify a suspension figure from the interval class above the sounding bass, the resolution
 * direction and the interval class the resolution lands on above the same bass
 * (`suspensionType`): a figure names both intervals.
 */
std::optional<SuspensionFigure> suspension_type(double ic, double delta, double resolved_ic) {
  std::optional<SuspensionFigure> figure = suspended_figure(ic, delta);
  if (!figure) {
    return std::nullopt;
  }
  std::vector<double> targets = suspension_resolutions(*figure);
  if (std::find(targets.begin(), targets.end(), resolved_ic) == targets.end()) {
    return std::nullopt;
  }
  return figure;
}

/**
 * Whether a pitch clashes with the chord sounding under it, as a solo line is heard against its
 * harmony (`clashesWithChord`): a dissonance above the bass, the fourth included, or a second,
 * seventh or tritone against any chord tone.
 */
bool clashes_with_chord(double pitch, const Chord& chord) {
  if (!is_consonant_interval(interval_above_bass(pitch, {}, chord), true)) {
    return true;
  }
  std::vector<double> tones;
  for (double interval : chord.intervals) {
    tones.push_back(chord.rootPc + interval);
  }
  if (chord.bassPc) {
    tones.push_back(*chord.bassPc);
  }
  return std::any_of(tones.begin(), tones.end(), [&](double tone) {
    return !is_consonant_interval(js::floor_mod(pitch_class_of(pitch) - tone, 12), false);
  });
}

/**
 * The nearest chord member to a pitch, searched outward from it and downward first at equal
 * distance, within `max_distance` semitones (`nearestChordTone`).
 */
std::optional<double> nearest_chord_tone(double pitch, const Chord& chord, int max_distance) {
  for (int delta = 1; delta <= max_distance; ++delta) {
    if (is_chord_member(pitch - delta, chord)) {
      return pitch - delta;
    }
    if (is_chord_member(pitch + delta, chord)) {
      return pitch + delta;
    }
  }
  return std::nullopt;
}

/** The refusal of a chord whose quality no table has, where TS asserts the chord. */
void require_known_quality(const VoiceChord& chord) {
  if (chord.unknown_quality) {
    throw InvalidInputError(*chord.unknown_quality);
  }
}

/** `intervalAboveRoot` as the voice analysis asks it: the chord is asserted first. */
int interval_above_root_of(double pitch, const VoiceChord& chord) {
  require_known_quality(chord);
  return interval_above_root(pitch, chord.chord);
}

/**
 * A chord with the bass it is written over among its own tones (`asSounded`): a slash chord states
 * a bass its stack of thirds does not reach.
 */
Chord as_sounded(const VoiceChord& chord) {
  if (!chord.chord.bassPc) {
    return chord.chord;
  }
  Chord sounded = chord.chord;
  sounded.intervals.push_back(interval_above_root_of(*chord.chord.bassPc, chord));
  return sounded;
}

/** Build a short rationale from a note's primary label (`describe`). */
std::string describe(const std::vector<TheoryLabel>& labels) {
  if (labels.empty()) {
    return "Unclassified note";
  }
  const TheoryLabel& primary = labels.front();
  switch (primary.kind) {
    case TheoryLabelKind::kChordTone:
      return "Chord " + std::string(to_string(*primary.role));
    case TheoryLabelKind::kTension:
      return js::to_string(*primary.degree) + "th tension";
    case TheoryLabelKind::kAvoid:
      return "Avoid note";
    case TheoryLabelKind::kPassing:
      return "Passing tone between chord tones";
    case TheoryLabelKind::kNeighbor:
      return "Neighbor tone";
    case TheoryLabelKind::kSuspension:
      return "Suspension (" + std::string(to_string(*primary.type)) + ")";
    case TheoryLabelKind::kAppoggiatura:
      return "Appoggiatura leaning on the harmony, resolving by step";
    case TheoryLabelKind::kAnticipation:
      return "Anticipation of the next chord";
    case TheoryLabelKind::kEscape:
      return "Escape tone";
    case TheoryLabelKind::kNeedsResolution:
      return "Unresolved dissonance";
    case TheoryLabelKind::kLeadingTone:
      return "Leading tone resolving to the tonic";
  }
  return {};
}

TheoryLabel label_of(TheoryLabelKind kind) {
  TheoryLabel label;
  label.kind = kind;
  return label;
}

TheoryLabel resolving_label(TheoryLabelKind kind, double resolve_to) {
  TheoryLabel label = label_of(kind);
  label.resolveTo = resolve_to;
  return label;
}

/** Whether a (possibly absent) chord has the pitch among its tones (`isChordMember`). */
bool member_of(double pitch, const std::optional<VoiceChord>& chord) {
  return chord ? is_chord_member(pitch, chord->chord) : false;
}

}  // namespace

std::string_view to_string(SuspensionFigure figure) {
  return kSuspensionNames[static_cast<std::size_t>(figure)];
}

std::string_view to_string(TheoryLabelKind kind) {
  return kKindNames[static_cast<std::size_t>(kind)];
}

KeyAtBeat key_scale_at(const KeyContext& key) {
  if (const KeyAtBeat* at_beat = std::get_if<KeyAtBeat>(&key.value())) {
    return *at_beat;
  }
  KeyScale scale = to_key_scale(std::get<KeyArg>(key.value()));
  return [scale](double) { return scale; };
}

std::vector<IdentifiedVoiceNote> to_voice_notes(const std::vector<NoteEvent>& events) {
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  assert_note_events(events, "voice notes", options);
  std::vector<IdentifiedVoiceNote> out;
  for (std::size_t index = 0; index < events.size(); ++index) {
    IdentifiedVoiceNote note;
    static_cast<NoteEvent&>(note) = events[index];
    note.id = static_cast<double>(index);
    note.originalIndex = static_cast<double>(index);
    out.push_back(std::move(note));
  }
  return out;
}

std::vector<AnalyzedNote> analyze_voice_over(const std::vector<VoiceNote>& voice,
                                             const VoiceHost& host) {
  std::vector<AnalyzedNote> result;
  // Melodic neighbours are read along the notes that sound: a zero-length note has none and is
  // no one's.
  std::vector<std::size_t> sounding;
  for (std::size_t i = 0; i < voice.size(); ++i) {
    // The drop_silent_notes() predicate, read in place rather than on a copy of the voice.
    if (voice[i].durationBeat > 0) {
      sounding.push_back(i);
    }
  }
  std::vector<std::optional<std::size_t>> line(voice.size());
  for (std::size_t position = 0; position < sounding.size(); ++position) {
    line[sounding[position]] = position;
  }
  for (std::size_t i = 0; i < voice.size(); ++i) {
    const VoiceNote& note = voice[i];
    const VoiceNote* prev_note = nullptr;
    const VoiceNote* next_note = nullptr;
    if (line[i]) {
      std::size_t position = *line[i];
      if (position > 0) {
        prev_note = &voice[sounding[position - 1]];
      }
      if (position + 1 < sounding.size()) {
        next_note = &voice[sounding[position + 1]];
      }
    }
    // A neighboring note sharing this note's onset is a simultaneous cluster member, not a melodic
    // predecessor/successor.
    const VoiceNote* prev =
        prev_note != nullptr && !same_instant(prev_note->startBeat, note.startBeat) &&
                adjacent(prev_note->startBeat + prev_note->durationBeat, note.startBeat)
            ? prev_note
            : nullptr;
    const VoiceNote* next =
        next_note != nullptr && !same_instant(next_note->startBeat, note.startBeat) &&
                adjacent(note.startBeat + note.durationBeat, next_note->startBeat)
            ? next_note
            : nullptr;
    std::optional<VoiceChord> chord = host.chord_at(note.startBeat);
    std::vector<TheoryLabel> labels;
    bool member = member_of(note.pitch, chord);
    bool handled = false;
    double pitch = note.pitch;

    if (chord && member) {
      Nullable<ChordToneRole> role = chord_tone_role(pitch, chord->chord);
      std::optional<int> degree;
      if (!role) {
        degree = tension_degree(interval_above_root_of(pitch, *chord));
      }
      if (role) {
        TheoryLabel label = label_of(TheoryLabelKind::kChordTone);
        label.role = *role;
        labels.push_back(label);
        handled = true;
      } else if (degree) {
        TheoryLabel label = label_of(TheoryLabelKind::kTension);
        label.degree = *degree;
        labels.push_back(label);
        handled = true;
      } else {
        // A slash bass the chord's own template does not contain falls between two readings: the
        // membership test counts the bass, the role test reads the template. It is read against
        // the chord as it sounds.
        Nullable<ChordToneRole> bass_role = chord_tone_role(pitch, as_sounded(*chord));
        if (bass_role) {
          TheoryLabel label = label_of(TheoryLabelKind::kChordTone);
          label.role = *bass_role;
          labels.push_back(label);
          handled = true;
        }
      }
    }

    if (!handled && chord && prev && next) {
      std::optional<VoiceChord> prev_chord = host.chord_at(prev->startBeat);
      bool prepared = prev->pitch == note.pitch && member_of(prev->pitch, prev_chord);
      bool resolves = is_step(next->pitch, pitch);
      std::vector<OtherVoice> others = host.others_at(note.startBeat);
      // A solo line has no other voice to clash with, so the chord it is heard against stands in.
      bool vertically_dissonant =
          !others.empty()
              ? std::any_of(others.begin(), others.end(),
                            [&](const OtherVoice& other) {
                              return creates_vertical_dissonance(pitch, other.pitch_of(), true);
                            })
              : clashes_with_chord(pitch, chord->chord);
      if (prepared && vertically_dissonant && resolves) {
        double ic = interval_above_bass(pitch, others, chord->chord);
        double resolved_ic = interval_above_bass(next->pitch, others, chord->chord);
        std::optional<SuspensionFigure> type =
            suspension_type(ic, next->pitch - pitch, resolved_ic);
        if (type) {
          TheoryLabel label = resolving_label(TheoryLabelKind::kSuspension, next->pitch);
          label.type = *type;
          labels.push_back(label);
          handled = true;
        }
      }
    }

    if (!handled && chord && prev && next) {
      bool prev_member = member_of(prev->pitch, host.chord_at(prev->startBeat));
      bool next_member = member_of(next->pitch, host.chord_at(next->startBeat));
      bool up = pitch - prev->pitch > 0;
      bool cont_into = next->pitch - pitch > 0;
      bool same_dir = pitch != prev->pitch && next->pitch != pitch && up == cont_into;
      if (prev_member && next_member && !member && is_step(pitch, prev->pitch) &&
          is_step(next->pitch, pitch) && same_dir) {
        labels.push_back(label_of(TheoryLabelKind::kPassing));
        handled = true;
      }
    }

    if (!handled && chord && prev && next && !member && prev->pitch == next->pitch &&
        member_of(prev->pitch, host.chord_at(prev->startBeat)) && is_step(pitch, prev->pitch)) {
      labels.push_back(label_of(TheoryLabelKind::kNeighbor));
      handled = true;
    }

    if (!handled && chord && next && !member && note.pitch == next->pitch) {
      std::optional<VoiceChord> next_chord = host.chord_at(next->startBeat);
      if (member_of(next->pitch, next_chord)) {
        labels.push_back(label_of(TheoryLabelKind::kAnticipation));
        handled = true;
      }
    }

    // The appoggiatura and the escape tone are each other's mirror: one leans in by leap and gives
    // way by step, the other steps out of the harmony and leaves by leap.
    if (!handled && chord && prev && next && !member) {
      bool prev_member = member_of(prev->pitch, host.chord_at(prev->startBeat));
      bool next_member = member_of(next->pitch, host.chord_at(next->startBeat));
      bool leap_from_prev = std::fabs(pitch - prev->pitch) >= LEAP_SEMITONES;
      bool step_to_next = is_step(next->pitch, pitch);
      bool opposite = (pitch - prev->pitch > 0) != (next->pitch - pitch > 0);
      if (prev_member && next_member && leap_from_prev && step_to_next && opposite) {
        labels.push_back(resolving_label(TheoryLabelKind::kAppoggiatura, next->pitch));
        handled = true;
      }
    }

    if (!handled && chord && prev && next && !member) {
      bool prev_member = member_of(prev->pitch, host.chord_at(prev->startBeat));
      bool next_member = member_of(next->pitch, host.chord_at(next->startBeat));
      bool step_from_prev = is_step(pitch, prev->pitch);
      bool leap_to_next = std::fabs(next->pitch - pitch) >= LEAP_SEMITONES;
      bool opposite = (pitch - prev->pitch > 0) != (next->pitch - pitch > 0);
      if (prev_member && next_member && step_from_prev && leap_to_next && opposite) {
        labels.push_back(label_of(TheoryLabelKind::kEscape));
        handled = true;
      }
    }

    if (!handled && chord && !member) {
      double ic = interval_above_root_of(pitch, *chord);
      // Which extension a note forms is a matter of its interval above the root, so an altered
      // ninth is heard as one whether or not the chord symbol writes it. An alteration is an
      // alteration of a seventh chord's upper structure, though, so where the chord states no
      // seventh a chromatic note is the dissonance it sounds like.
      std::optional<int> degree = tension_degree(ic);
      const std::vector<double>& intervals = chord->chord.intervals;
      bool colours = is_natural_tension_interval(ic) ||
                     std::any_of(intervals.begin(), intervals.end(),
                                 [](double interval) { return interval == 10 || interval == 11; });
      bool avoid = (ic == 5 && includes(intervals, 4) && !includes(intervals, 5)) ||
                   (ic == 11 && includes(intervals, 4) && includes(intervals, 10));
      if (avoid) {
        labels.push_back(label_of(TheoryLabelKind::kAvoid));
        std::optional<double> resolve_to = nearest_chord_tone(pitch, chord->chord, STEP_RESOLUTION);
        if (resolve_to) {
          labels.push_back(resolving_label(TheoryLabelKind::kNeedsResolution, *resolve_to));
        }
      } else if (degree && colours) {
        TheoryLabel label = label_of(TheoryLabelKind::kTension);
        label.degree = *degree;
        labels.push_back(label);
      } else {
        // Every note sounding against a chord is classified, so this branch labels the dissonance
        // whether or not it has a stepwise exit.
        std::optional<double> resolve_to =
            nearest_chord_tone(pitch, chord->chord, NEAREST_CHORD_TONE_REACH);
        labels.push_back(resolve_to
                             ? resolving_label(TheoryLabelKind::kNeedsResolution, *resolve_to)
                             : label_of(TheoryLabelKind::kAvoid));
      }
    }

    // A leading tone is only one because of the tonic it arrives on, so the key is read at the
    // beat of that arrival rather than at this note's own beat.
    if (next && is_leading_tone_resolution(pitch, next->pitch, host.key_at(next->startBeat))) {
      labels.push_back(resolving_label(TheoryLabelKind::kLeadingTone, next->pitch));
    }

    AnalyzedNote analyzed;
    analyzed.noteId = note.id ? *note.id : static_cast<double>(i);
    analyzed.pitch = note.pitch;
    analyzed.startBeat = note.startBeat;
    analyzed.durationBeat = note.durationBeat;
    analyzed.rationale = describe(labels);
    analyzed.labels = std::move(labels);
    if (note.originalIndex) {
      analyzed.originalIndex = *note.originalIndex;
    }
    result.push_back(std::move(analyzed));
  }
  return result;
}

std::vector<AnalyzedNote> analyze_voice(
    const std::vector<VoiceNote>& voice,
    const std::function<Nullable<Chord>(double)>& chord_at_beat, const KeyContext& key,
    const std::function<std::vector<VoiceSnapshot>(double)>& other_voices_at_beat) {
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  std::vector<NoteEvent> events(voice.begin(), voice.end());
  assert_note_events(events, "voice notes", options);
  VoiceHost host;
  host.chord_at = [&](double beat) -> std::optional<VoiceChord> {
    Nullable<Chord> chord = chord_at_beat(beat);
    if (!chord) {
      return std::nullopt;
    }
    return VoiceChord{*chord, std::nullopt};
  };
  host.others_at = [&](double beat) {
    std::vector<OtherVoice> others;
    if (other_voices_at_beat) {
      for (const VoiceSnapshot& other : other_voices_at_beat(beat)) {
        double pitch = other.pitch;
        others.push_back(OtherVoice{[pitch] { return pitch; }, [pitch] { return pitch; }});
      }
    }
    return others;
  };
  host.key_at = key_scale_at(key);
  return analyze_voice_over(voice, host);
}

}  // namespace cantus
