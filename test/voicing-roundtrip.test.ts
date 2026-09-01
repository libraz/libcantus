/**
 * The generator marked by its own checker.
 *
 * Every rule exercised here is one the library states twice — once as a penalty
 * the voicing search weighs, once as a violation `checkPartWriting` reports —
 * and the two statements have to agree. So the sweep below writes a progression
 * with `voiceProgression`, spells the result with `spellVoicing`, and marks it
 * with `checkPartWriting`: what the generator hands out has to pass the exercise
 * the library would mark it against.
 */

import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import type { Chord } from '../src/theory/chord/index.js';
import type { PartWritingViolation } from '../src/theory/partwriting/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';
import { parseChordSymbol } from '../src/theory/symbol/index.js';
import { SATB_RANGES, voiceProgression } from '../src/theory/voicing/index.js';
import {
  augmentedMelodicCount,
  DEFAULT_MAX_SPACING,
  enumerateVoicings,
  structuralPenalty,
  structuralTables,
  violationCount,
} from '../src/theory/voicing/internal.js';
import { spellingTable } from '../src/theory/voicing/tendency.js';

const C_MAJOR = majorKey(0);
const C_MINOR = minorKey(0);

/** One graded progression: what was written, and what the checker made of it. */
type Marked = {
  chords: Chord[];
  voiced: number[][];
  violations: PartWritingViolation[];
};

/** Voice a progression, spell what came out, and mark it. */
function roundTrip(symbols: readonly string[], key: KeyScale): Marked {
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

/** The violations of one of the given kinds, described for a failure message. */
function only(marked: Marked, kinds: readonly PartWritingViolation['kind'][]): string {
  return describeAll(marked.violations.filter((found) => kinds.includes(found.kind)));
}

/**
 * Whether another voicing of the chord would have avoided the augmented interval
 * the search wrote, without breaking a heavier rule in its place.
 *
 * This is the invariant itself rather than a count: an augmented interval may
 * survive where every alternative commits a parallel perfect or drops a chord
 * tone — the bass takes the chord's own bass pitch class, so a move like Ab to B
 * spells an augmented second at every octave open to it — but never where a
 * clean candidate was available for the same price.
 */
function couldHaveAvoidedIt(marked: Marked, step: number, key: KeyScale): boolean {
  const prev = marked.voiced[step - 1] as number[];
  const chosen = marked.voiced[step] as number[];
  const prevChord = marked.chords[step - 1] as Chord;
  const chord = marked.chords[step] as Chord;
  const spelling = { from: spellingTable(key, prevChord), to: spellingTable(key, chord) };
  const structure = structuralTables(chord, key);
  const voices = chosen.length;
  const chosenViolations = violationCount(prev, 0, chosen, 0, voices);
  const chosenStructure = structuralPenalty(structure, chosen, 0, voices);
  const candidates = enumerateVoicings(
    chord,
    SATB_RANGES.map((range) => ({ ...range })),
    DEFAULT_MAX_SPACING,
  );
  const { pitches } = candidates;
  for (let candidate = 0; candidate < candidates.count; candidate += 1) {
    const offset = candidate * candidates.voices;
    if (augmentedMelodicCount(spelling, prev, 0, pitches, offset, candidates.voices) > 0) {
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

/** Every progression of the sweep, with the key it is written in. */
const SWEEP: readonly { symbols: readonly string[]; key: KeyScale; name: string }[] = [
  ...MINOR_PROGRESSIONS.map((symbols) => ({
    symbols,
    key: C_MINOR,
    name: `${symbols.join('-')} in C minor`,
  })),
  ...MAJOR_PROGRESSIONS.map((symbols) => ({
    symbols,
    key: C_MAJOR,
    name: `${symbols.join('-')} in C major`,
  })),
];

describe('the generator marked by its own checker', () => {
  for (const { symbols, key, name } of SWEEP) {
    it(`writes no parallel or hidden perfect in ${name}`, () => {
      expect(
        only(roundTrip(symbols, key), ['parallelFifth', 'parallelOctave', 'hiddenPerfect']),
      ).toBe('');
    });

    it(`writes no augmented interval another voicing would have avoided in ${name}`, () => {
      const marked = roundTrip(symbols, key);
      const avoidable = marked.violations
        .filter((found) => found.kind === 'augmentedMelodicInterval')
        .filter((found) => couldHaveAvoidedIt(marked, found.toIndex, key));
      expect(describeAll(avoidable)).toBe('');
    });

    it(`leaves no tendency tone unresolved in ${name}`, () => {
      expect(only(roundTrip(symbols, key), ['unresolvedSeventh', 'unresolvedLeadingTone'])).toBe(
        '',
      );
    });

    it(`keeps its voices in order, in range and in hand in ${name}`, () => {
      expect(only(roundTrip(symbols, key), ['voiceCrossing', 'overlap', 'range', 'spacing'])).toBe(
        '',
      );
    });
  }

  it('writes the same voicings every time it is asked', () => {
    for (const { symbols, key } of SWEEP) {
      const chords = symbols.map((symbol) => parseChordSymbol(symbol));
      expect(voiceProgression(chords, { key })).toEqual(voiceProgression(chords, { key }));
    }
  });

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
      expect(
        only(roundTrip(symbols, C_MINOR), ['augmentedMelodicInterval']),
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
      expect(only(roundTrip(symbols, C_MAJOR), ['hiddenPerfect']), symbols.join('-')).toBe('');
    }
  });
});
