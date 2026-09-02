/**
 * The generator marked by its own checker.
 *
 * Every rule exercised here is one the library states twice — once as a penalty
 * the voicing search weighs, once as a violation `checkPartWriting` reports —
 * and the two statements have to agree. So the sweep below writes a progression
 * with `voiceProgression`, spells the result with `spellVoicing`, and marks it
 * with `checkPartWriting`: what the generator hands out has to pass the exercise
 * the library would mark it against.
 *
 * The rules are walked from `PartWritingViolationKind` rather than from a list
 * written out here, so a rule added to the checker has to be given a verdict
 * before this file will compile, and cannot quietly go unswept.
 */

import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import type { Chord } from '../src/theory/chord/index.js';
import type {
  PartWritingViolation,
  PartWritingViolationKind,
} from '../src/theory/partwriting/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import type { SpelledKeyScale } from '../src/theory/scale/index.js';
import { majorKey, minorKey, resolveKey } from '../src/theory/scale/index.js';
import { parseChordSymbol } from '../src/theory/symbol/index.js';
import { SATB_RANGES, voiceProgression } from '../src/theory/voicing/index.js';
import {
  augmentedMelodicCount,
  CROSS_RELATION_PENALTY,
  crossRelationCount,
  DEFAULT_MAX_SPACING,
  enumerateVoicings,
  type MoveScoring,
  moveScoring,
  resolutionViolations,
  structuralPenalty,
  structuralTables,
  violationCount,
  violationWeight,
} from '../src/theory/voicing/internal.js';

const C_MAJOR = majorKey(0);
const C_MINOR = minorKey(0);

/** One graded progression: what was written, and what the checker made of it. */
type Marked = {
  chords: Chord[];
  voiced: number[][];
  violations: PartWritingViolation[];
};

/** Voice a progression, spell what came out, and mark it. */
function roundTrip(symbols: readonly string[], key: SpelledKeyScale): Marked {
  const chords = symbols.map((symbol) => parseChordSymbol(symbol));
  const voiced = voiceProgression(chords, { key });
  const spelled = voiced.map((pitches, index) =>
    spellVoicing(pitches, chords[index] as Chord, key),
  );
  return { chords, voiced, violations: checkPartWriting(spelled, chords, key) };
}

/** How a violation reads in a failure message. */
function describeAll(violations: readonly PartWritingViolation[]): string {
  return violations
    .map((found) => `${found.kind}@${found.fromIndex}->${found.toIndex} voices ${found.voices}`)
    .join(', ');
}

/**
 * What the sweep asks of each rule the checker can report.
 *
 * - `never`: the generator must not write one at all.
 * - `unavoidable`: one may stand, but only where no other voicing of the same
 *   chord would have spared it for the same price. Some contradictions cannot
 *   be voiced away — the bass takes the chord's own bass pitch class, so a
 *   lowered third meets the natural one wherever the voices are put — and the
 *   invariant is that the search never writes one it could have escaped.
 * - `species`: only `checkSpecies` raises it, since it describes a fault only a
 *   species exercise can commit, so a four-part progression must show none.
 */
type Verdict = 'never' | 'unavoidable' | 'species';

const WATCHED: Record<PartWritingViolationKind, Verdict> = {
  parallelFifth: 'never',
  parallelOctave: 'never',
  hiddenPerfect: 'never',
  crossRelation: 'unavoidable',
  voiceCrossing: 'never',
  overlap: 'never',
  spacing: 'never',
  range: 'never',
  unresolvedLeadingTone: 'never',
  unresolvedSeventh: 'never',
  augmentedMelodicInterval: 'unavoidable',
  wrongRhythmicRatio: 'species',
  unpreparedDissonance: 'species',
  unresolvedSuspension: 'species',
  illegalLeap: 'species',
  battuta: 'species',
  missingCadence: 'species',
  melodicShape: 'species',
};

/** Every rule under watch, read from the verdicts rather than listed again. */
const WATCHED_KINDS = Object.keys(WATCHED) as PartWritingViolationKind[];

/**
 * How many times one candidate voicing of the arriving chord breaks a rule the
 * search is supposed to weigh. Only the rules judged `unavoidable` need one:
 * the rest are asserted away entirely, so there is nothing to compare against.
 */
const OFFENCES: Partial<
  Record<
    PartWritingViolationKind,
    (
      scoring: MoveScoring,
      prev: readonly number[],
      pitches: ArrayLike<number>,
      offset: number,
      voices: number,
    ) => number
  >
> = {
  augmentedMelodicInterval: (scoring, prev, pitches, offset, voices) =>
    scoring.spelling === undefined
      ? 0
      : augmentedMelodicCount(scoring.spelling, prev, 0, pitches, offset, voices),
  crossRelation: (scoring, prev, pitches, offset, voices) =>
    scoring.spelling === undefined || scoring.crossRelation === undefined
      ? 0
      : crossRelationCount(
          scoring.spelling,
          scoring.crossRelation,
          prev,
          0,
          pitches,
          offset,
          voices,
        ),
};

/**
 * Whether another voicing of the chord would have broken the rule fewer times
 * than the one the search wrote, without breaking a heavier rule in its place.
 *
 * This is the invariant itself rather than a count: an augmented interval may
 * survive where every alternative commits a parallel perfect or drops a chord
 * tone — the bass takes the chord's own bass pitch class, so a move like Ab to B
 * spells an augmented second at every octave open to it — but never where a
 * cleaner candidate was available for the same price.
 */
function couldHaveAvoidedIt(
  marked: Marked,
  kind: PartWritingViolationKind,
  step: number,
  key: KeyScale,
): boolean {
  const offences = OFFENCES[kind];
  if (offences === undefined) {
    return true;
  }
  const prev = marked.voiced[step - 1] as number[];
  const chosen = marked.voiced[step] as number[];
  const chord = marked.chords[step] as Chord;
  const scoring = moveScoring(
    marked.chords[step - 1],
    chord,
    resolveKey(key),
    marked.chords[step + 1],
  );
  const voices = chosen.length;
  const chosenOffences = offences(scoring, prev, chosen, 0, voices);
  const chosenViolations = violationCount(prev, 0, chosen, 0, voices);
  const structure = structuralTables(chord, key);
  const chosenStructure = structuralPenalty(structure, chosen, 0, voices);
  const candidates = enumerateVoicings(
    chord,
    SATB_RANGES.map((range) => ({ ...range })),
    DEFAULT_MAX_SPACING,
  );
  const { pitches } = candidates;
  for (let candidate = 0; candidate < candidates.count; candidate += 1) {
    const offset = candidate * candidates.voices;
    if (offences(scoring, prev, pitches, offset, candidates.voices) >= chosenOffences) {
      continue;
    }
    if (violationCount(prev, 0, pitches, offset, candidates.voices) > chosenViolations) {
      continue;
    }
    if (structuralPenalty(structure, pitches, offset, candidates.voices) > chosenStructure) {
      continue;
    }
    return true;
  }
  return false;
}

/** The violations of one rule the generator has no answer for, described. */
function unanswered(marked: Marked, kind: PartWritingViolationKind, key: KeyScale): string {
  const found = marked.violations.filter((violation) => violation.kind === kind);
  return describeAll(
    WATCHED[kind] === 'unavoidable'
      ? found.filter((violation) => couldHaveAvoidedIt(marked, kind, violation.toIndex, key))
      : found,
  );
}

/** Common progressions in the minor, where the augmented second lies in wait. */
const MINOR_PROGRESSIONS: readonly (readonly string[])[] = [
  ['Ab', 'G'],
  ['Cm', 'Ab', 'Bdim', 'Cm'],
  ['Cm', 'Ab', 'G', 'Cm'],
  ['Cm', 'Fm', 'G', 'Cm'],
  ['Cm', 'G', 'Cm'],
  ['Fm', 'G7', 'Cm'],
  ['Cm', 'Eb', 'Ab', 'G'],
  ['Cm', 'Ddim', 'G7', 'Cm'],
  ['Ab', 'Bdim', 'Cm'],
  ['Cm', 'Fm', 'Bdim', 'Cm'],
];

/** Common progressions in the major, where the direct fifth lies in wait. */
const MAJOR_PROGRESSIONS: readonly (readonly string[])[] = [
  ['C', 'D7', 'G', 'C'],
  ['C', 'Em', 'F', 'G'],
  ['C', 'E7', 'Am'],
  ['C', 'F', 'G', 'C'],
  ['C', 'Am', 'F', 'G'],
  ['C', 'G7', 'C'],
  ['C', 'Dm7', 'G7', 'C'],
  ['F', 'G', 'Em', 'Am'],
  ['Am', 'Dm', 'G', 'C'],
  ['C', 'F', 'Dm', 'G7', 'C'],
];

/**
 * Progressions borrowing from outside the key, where one letter is written two
 * ways and the cross relation lies in wait.
 */
const CHROMATIC_PROGRESSIONS: readonly (readonly string[])[] = [
  ['C', 'Eb', 'C'],
  ['C', 'Ab', 'C'],
  ['C', 'Fm', 'C'],
  ['C', 'A7', 'Dm'],
  ['C', 'Bb', 'C'],
];

/** Every progression of the sweep, with the key it is written in. */
const SWEEP: readonly { symbols: readonly string[]; key: SpelledKeyScale; name: string }[] = [
  ...MINOR_PROGRESSIONS.map((symbols) => ({
    symbols,
    key: C_MINOR,
    name: `${symbols.join('-')} in C minor`,
  })),
  ...[...MAJOR_PROGRESSIONS, ...CHROMATIC_PROGRESSIONS].map((symbols) => ({
    symbols,
    key: C_MAJOR,
    name: `${symbols.join('-')} in C major`,
  })),
];

describe('the generator marked by its own checker', () => {
  for (const { symbols, key, name } of SWEEP) {
    it(`breaks no rule its own checker reports in ${name}`, () => {
      const marked = roundTrip(symbols, key);
      for (const kind of WATCHED_KINDS) {
        expect(unanswered(marked, kind, key), kind).toBe('');
      }
      for (const found of marked.violations) {
        expect(WATCHED_KINDS, 'every rule reported is one the sweep watches').toContain(found.kind);
      }
    });
  }

  it('voices every chord of every progression it sweeps', () => {
    // The sweep asserts absences, so what it asserts them about is checked to
    // exist: a progression that came back short would report as clean.
    expect(SWEEP.length).toBeGreaterThan(0);
    for (const { symbols, key, name } of SWEEP) {
      const marked = roundTrip(symbols, key);
      expect(marked.voiced, name).toHaveLength(symbols.length);
      for (const voicing of marked.voiced) {
        expect(voicing, name).toHaveLength(4);
      }
    }
  });

  it('marks an exercise that does break a rule', () => {
    // The absences above are only worth something if the checker they are read
    // through says anything at all, so it is handed an exercise written to
    // break a rule: the two voices move into consecutive fifths.
    const chords = ['C', 'Dm'].map((symbol) => parseChordSymbol(symbol));
    const spelled = [
      [48, 55, 64, 72],
      [50, 57, 65, 69],
    ].map((pitches, index) => spellVoicing(pitches, chords[index] as Chord, C_MAJOR));
    const marked = checkPartWriting(spelled, chords, C_MAJOR);
    expect(marked.map((found) => found.kind)).toContain('parallelFifth');
    for (const found of marked) {
      expect(WATCHED_KINDS).toContain(found.kind);
    }
    // Budgeted for catching a hang, not for stating a speed: the sweep voices
    // every chord of every progression, and a shared runner under coverage
    // takes several times what a machine to itself does.
  }, 180_000);

  it('writes the same voicings every time it is asked', () => {
    for (const { symbols, key } of SWEEP) {
      const chords = symbols.map((symbol) => parseChordSymbol(symbol));
      expect(voiceProgression(chords, { key })).toEqual(voiceProgression(chords, { key }));
    }
    // Twice the sweep above, so twice its budget.
  }, 360_000);

  it('still voices a chord whose every candidate writes an augmented interval', () => {
    // A single bass voice moving from the lowered submediant to the leading
    // tone, in a window holding one Ab and one B: the augmented second is the
    // only move either chord admits, so no candidate is clean and the search
    // has to return one anyway. Given a wider window the search escapes by
    // placing the Ab an octave up and falling a diminished seventh instead,
    // which is why the range is narrowed to the interval under test.
    const chords = ['Ab', 'Bdim'].map((symbol) => parseChordSymbol(symbol));
    const voiced = voiceProgression(chords, { key: C_MINOR, ranges: [{ min: 44, max: 48 }] });
    expect(voiced).toHaveLength(2);
    const spelled = voiced.map((pitches, index) =>
      spellVoicing(pitches, chords[index] as Chord, C_MINOR),
    );
    expect(checkPartWriting(spelled, chords, C_MINOR).map((found) => found.kind)).toContain(
      'augmentedMelodicInterval',
    );
  });

  it('avoids the augmented seconds that only a lookahead can escape', () => {
    // The ♭6 lands where the next chord's raised seventh has to be reached from,
    // and from that placement every voicing of the next chord either writes the
    // augmented second or commits a parallel perfect. The escape is a different
    // placement of the chord holding the ♭6, so the search only finds it by
    // weighing what the connection ahead of it will cost.
    for (const symbols of [
      ['Ab', 'G'],
      ['Cm', 'Ab', 'G', 'Cm'],
      ['Cm', 'Ab', 'Bdim', 'Cm'],
      ['Cm', 'Eb', 'Ab', 'G'],
    ]) {
      const marked = roundTrip(symbols, C_MINOR);
      expect(
        describeAll(marked.violations.filter((found) => found.kind === 'augmentedMelodicInterval')),
        symbols.join('-'),
      ).toBe('');
    }
  });

  it('keeps the direct fifth out of the progressions that used to buy one', () => {
    // The three the search wrote a hidden perfect into while the penalty was a
    // six-point nudge inside the voice-leading distance.
    for (const symbols of [
      ['C', 'D7', 'G', 'C'],
      ['C', 'Em', 'F', 'G'],
      ['C', 'E7', 'Am'],
    ]) {
      const marked = roundTrip(symbols, C_MAJOR);
      expect(
        describeAll(marked.violations.filter((found) => found.kind === 'hiddenPerfect')),
        symbols.join('-'),
      ).toBe('');
    }
  });
});

describe('the search and the checker read one rule apiece', () => {
  it('counts a seventh falling a diminished third as unresolved, as the checker does', () => {
    // Ab minor seventh onto a C major triad, written in Db major: the voice
    // holding the seventh moves Gb3 down to E3. Two semitones by ear, but three
    // letters on the page — a diminished third, which resolves nothing, and the
    // arriving chord does not hold the Gb either.
    const key = majorKey(1);
    const chords = ['Abm7', 'C'].map((symbol) => parseChordSymbol(symbol));
    const from = [44, 54, 59, 63];
    const to = [48, 52, 60, 67];
    const spelled = [from, to].map((pitches, index) =>
      spellVoicing(pitches, chords[index] as Chord, key),
    );
    const reported = checkPartWriting(spelled, chords, key).filter(
      (found) => found.kind === 'unresolvedSeventh',
    );
    const scoring = moveScoring(chords[0], chords[1] as Chord, resolveKey(key));
    expect(
      resolutionViolations(
        scoring.resolution as NonNullable<MoveScoring['resolution']>,
        scoring.spelling,
        from,
        0,
        to,
        0,
        4,
      ),
    ).toBe(reported.length);
    expect(reported).toHaveLength(1);
  });

  it('weighs a cross relation the checker would report', () => {
    // C major onto the borrowed Eb major: the alto holds E natural and the bass
    // strikes Eb, a contradiction the checker reports and the search therefore
    // has to be able to see.
    const chords = ['C', 'Eb'].map((symbol) => parseChordSymbol(symbol));
    const from = [48, 60, 64, 67];
    const to = [51, 58, 63, 67];
    const spelled = [from, to].map((pitches, index) =>
      spellVoicing(pitches, chords[index] as Chord, C_MAJOR),
    );
    expect(
      checkPartWriting(spelled, chords, C_MAJOR).filter((found) => found.kind === 'crossRelation'),
    ).toHaveLength(1);
    const scoring = moveScoring(chords[0], chords[1] as Chord, resolveKey(C_MAJOR));
    expect(violationWeight(scoring, from, 0, to, 0, 4)).toBe(CROSS_RELATION_PENALTY);
  });
});
