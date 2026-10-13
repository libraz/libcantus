import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import {
  type Chord,
  chordFromSpec,
  chordPitchClasses,
  chordQualities,
  displacedThirds,
  makeChord,
} from '../src/theory/chord/index.js';
import {
  availableTensions,
  avoidNotes,
  chordScaleReport,
  chordScales,
  scaleMatchesChord,
  scalesForChanges,
} from '../src/theory/chordscale/index.js';
import { NAMED_SCALES, scaleByName, WORLD_SCALES } from '../src/theory/scale/index.js';
import { parseChordSymbol } from '../src/theory/symbol/index.js';

/**
 * The named-scale masks keyed by plain string: a chord-scale match names its
 * scale as text, so the lookups here are made by a name the table may not hold.
 */
const SCALE_MASKS: ReadonlyMap<string, number> = new Map(Object.entries(NAMED_SCALES));

/** Pitch-class set of a named scale rooted on `rootPc`. */
function scalePitchClasses(name: string, rootPc: number): Set<number> {
  const mask = SCALE_MASKS.get(name);
  const pcs = new Set<number>();
  if (mask === undefined) {
    return pcs;
  }
  for (let n = 0; n < 12; n += 1) {
    if (((mask >> n) & 1) === 1) {
      pcs.add((rootPc + n) % 12);
    }
  }
  return pcs;
}

/** Number of tones in a named scale. */
function scaleSize(name: string): number {
  return scalePitchClasses(name, 0).size;
}

/** Every built-in chord quality on every root: the whole chord vocabulary. */
function everyChord(): Chord[] {
  const chords: Chord[] = [];
  for (const quality of chordQualities()) {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      chords.push(makeChord(rootPc, quality));
    }
  }
  return chords;
}

const SCALE_NAMES = Object.keys(NAMED_SCALES);

/**
 * Whether the chord-scale rules read this pair at all. A scale that does not
 * contain the chord has neither avoid notes nor tensions over it; the altered
 * scale is the documented exception, read over an ordinary dominant seventh
 * whose perfect fifth it does not contain.
 */
function analysed(chord: Chord, name: string): boolean {
  const mask = SCALE_MASKS.get(name) ?? 0;
  return (
    scaleMatchesChord(chordPitchClasses(chord), mask, chord.rootPc) ||
    (chord.quality === 'dom7' && name === 'altered')
  );
}

/** The seven church modes, the conventional answer whenever one of them fits. */
const CHURCH_MODES = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];

describe('scaleMatchesChord', () => {
  it('accepts a scale that contains every chord tone', () => {
    // Cmaj7 = {0, 4, 7, 11}; C ionian = {0,2,4,5,7,9,11}.
    expect(scaleMatchesChord([0, 4, 7, 11], 0b101010110101, 0)).toBe(true);
  });

  it('rejects a scale missing a chord tone', () => {
    // C mixolydian {0,2,4,5,7,9,10} has b7 (10), not the maj7 (11) of Cmaj7.
    const mixolydian = 0b011010110101;
    expect(scaleMatchesChord([0, 4, 7, 11], mixolydian, 0)).toBe(false);
  });
});

describe('chordScales', () => {
  it('fits ionian and lydian over Cmaj7', () => {
    const names = chordScales(makeChord(0, 'maj7')).map((m) => m.name);
    expect(names).toContain('ionian');
    expect(names).toContain('lydian');
    expect(names).not.toContain('chromatic');
  });

  it('roots every match on the chord root', () => {
    for (const match of chordScales(makeChord(5, 'maj7'))) {
      expect(match.rootPc).toBe(5);
    }
  });

  it('fits mixolydian over C7', () => {
    const names = chordScales(makeChord(0, 'dom7')).map((m) => m.name);
    expect(names).toContain('mixolydian');
  });

  it('ranks a tighter-fitting scale before a looser one', () => {
    // C6 = {0,4,7,9}. Major pentatonic {0,2,4,7,9} adds one tone; ionian adds
    // three, so the pentatonic must rank first.
    const names = chordScales(makeChord(0, '6')).map((m) => m.name);
    const pentaIndex = names.indexOf('majorPentatonic');
    const ionianIndex = names.indexOf('ionian');
    expect(pentaIndex).toBeGreaterThanOrEqual(0);
    expect(ionianIndex).toBeGreaterThanOrEqual(0);
    expect(pentaIndex).toBeLessThan(ionianIndex);
  });

  it('names a bright mode, not the alphabetically first one, for a mode-neutral chord', () => {
    // C5 states no third, so every mode containing C and G fits equally well.
    // Alphabetical order answered aeolian, calling a minor mode the best fit
    // for a chord that is not minor.
    const names = chordScales(makeChord(0, '5')).map((m) => m.name);
    expect(names[0]).toBe('ionian');
    expect(names.indexOf('ionian')).toBeLessThan(names.indexOf('aeolian'));
    const sus = chordScales(makeChord(0, 'sus4')).map((m) => m.name);
    expect(sus.indexOf('mixolydian')).toBeLessThan(sus.indexOf('aeolian'));
  });

  it('names the melodic-minor mode of an altered dominant instead of falling back', () => {
    // 7b13 = {0,4,7,8,10}, which is mixolydian b13 — the scale a player would
    // name. A chromatic fallback here reads as an answer while being none.
    expect(chordScales(makeChord(0, '7b13'))[0]?.name).toBe('mixolydianB13');
    expect(chordScales(makeChord(0, '7#11'))[0]?.name).toBe('lydianDominant');
    expect(chordScales(makeChord(0, '7alt')).map((m) => m.name)).toContain('altered');
    expect(chordScales(makeChord(0, 'm7b5')).map((m) => m.name)).toContain('locrianNatural2');
  });

  it('prefers idiomatic whole-tone and locrian choices over a tighter generic fit', () => {
    expect(chordScales(makeChord(0, 'aug'))[0]?.name).toBe('wholeTone');
    expect(chordScales(makeChord(0, 'm7b5'))[0]?.name).toBe('locrian');
  });

  it('names the diminished scale, not its dominant rotation, over a diminished seventh', () => {
    // Both octatonic rotations contain C°7 equally well. The half-whole one
    // puts every non-chord tone a semitone above a chord tone, so choosing it
    // answers "what can be played over C°7" with "nothing".
    const report = chordScaleReport(makeChord(0, 'dim7'), 1);
    expect(report[0]?.name).toBe('octatonicWholeHalf');
    expect(report[0]?.tensions.length).toBeGreaterThan(0);
  });

  it('names the melodic minor over a minor-major seventh', () => {
    const report = chordScaleReport(makeChord(0, 'minMaj7'), 1);
    expect(report[0]?.name).toBe('melodicMinor');
    expect(report[0]?.tensions.length).toBeGreaterThan(0);
  });

  it('never answers with the empty-handed rotation of an equally sized scale', () => {
    // A church mode stays the conventional first choice even when a rarer scale
    // of the same size offers more colour — mixolydian over a thirteenth chord,
    // ionian over a major thirteenth. Anywhere else, a first choice that leaves
    // nothing playable while an equally sized candidate does is the ranking
    // falling through to alphabetical order.
    const failures: string[] = [];
    for (const chord of everyChord()) {
      const report = chordScaleReport(chord);
      const first = report[0];
      if (first === undefined || first.tensions.length > 0 || CHURCH_MODES.includes(first.name)) {
        continue;
      }
      const playable = report.find(
        (entry) => scaleSize(entry.name) === scaleSize(first.name) && entry.tensions.length > 0,
      );
      if (playable !== undefined) {
        failures.push(`${chord.quality}@${chord.rootPc}: ${first.name} over ${playable.name}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('falls back to the chromatic scale when nothing else contains the chord', () => {
    // augMaj7 = {0,4,8,11}; no named heptatonic/symmetric scale is a superset.
    const matches = chordScales(makeChord(0, 'augMaj7'));
    expect(matches).toEqual([{ name: 'chromatic', rootPc: 0 }]);
  });

  it('reports each pitch-class set once, under its modal name', () => {
    for (const quality of ['maj', 'min', 'maj7', 'min7'] as const) {
      const names = chordScales(makeChord(0, quality)).map((m) => m.name);
      expect(new Set(names).size).toBe(names.length);
      // major/ionian and naturalMinor/aeolian share a mask; only the modal
      // alias may appear.
      expect(names).not.toContain('major');
      expect(names).not.toContain('naturalMinor');
      const masks = names.map((name) => SCALE_MASKS.get(name));
      expect(new Set(masks).size).toBe(masks.length);
    }
  });

  it('keeps the modal aliases available for minor chords', () => {
    expect(chordScales(makeChord(9, 'min')).map((m) => m.name)).toContain('aeolian');
  });

  it('ranks heptatonic modes above pentatonics for a bare triad', () => {
    const names = chordScales(makeChord(0, 'maj')).map((m) => m.name);
    const ionianIndex = names.indexOf('ionian');
    const pentaIndex = names.indexOf('majorPentatonic');
    expect(ionianIndex).toBeGreaterThanOrEqual(0);
    expect(pentaIndex).toBeGreaterThanOrEqual(0);
    expect(ionianIndex).toBeLessThan(pentaIndex);
  });
});

describe('avoidNotes', () => {
  it('flags F as an avoid note for Cmaj7 in ionian', () => {
    // F (5) sits a semitone above the chord third E (4).
    expect(avoidNotes(makeChord(0, 'maj7'), 'ionian')).toEqual([5]);
  });

  it('reports no avoid notes for Cmaj7 in lydian', () => {
    // Lydian raises the fourth to F# (6), removing the clash with E.
    expect(avoidNotes(makeChord(0, 'maj7'), 'lydian')).toEqual([]);
  });

  it('flags F as an avoid note for C7 in mixolydian', () => {
    expect(avoidNotes(makeChord(0, 'dom7'), 'mixolydian')).toEqual([5]);
  });

  it('flags a major third below the suspended fourth as an avoid note', () => {
    expect(avoidNotes(makeChord(0, '7sus4'), 'mixolydian')).toContain(4);
  });

  it('returns [] when the scale does not contain the chord', () => {
    expect(avoidNotes(makeChord(0, 'maj7'), 'mixolydian')).toEqual([]);
  });

  it('rejects an unknown scale name rather than answering []', () => {
    // An empty result already means "no avoid notes here"; returning it for a
    // typo would make a misspelled scale look like a clean one.
    expect(() => avoidNotes(makeChord(0, 'maj7'), 'notAScale')).toThrow(RangeError);
  });
});

describe('availableTensions', () => {
  it('excludes chord tones and avoid notes for Cmaj7 in ionian', () => {
    // Scale {0,2,4,5,7,9,11}; chord {0,4,7,11}; avoid {5} -> tensions {2,9}.
    const tensions = availableTensions(makeChord(0, 'maj7'), 'ionian');
    expect(tensions).toEqual([2, 9]);
    expect(tensions).not.toContain(5);
    expect(tensions).not.toContain(0);
  });

  it('includes the #11 for Cmaj7 in lydian', () => {
    // Lydian has no avoid note, so 2 (9), 6 (#11), 9 (13) are all available.
    expect(availableTensions(makeChord(0, 'maj7'), 'lydian')).toEqual([2, 6, 9]);
  });

  it('returns the 9 and 13 for C7 in mixolydian', () => {
    expect(availableTensions(makeChord(0, 'dom7'), 'mixolydian')).toEqual([2, 9]);
  });

  it('offers altered colors over a conventional dominant seventh', () => {
    const chord = makeChord(7, 'dom7');
    expect(chordScales(chord).map((match) => match.name)).toContain('altered');
    expect(availableTensions(chord, 'altered')).toEqual([1, 3, 8, 10]);
  });

  it('does not offer a suspended chord its conflicting major third', () => {
    expect(availableTensions(makeChord(0, '7sus4'), 'mixolydian')).not.toContain(4);
  });

  it('returns [] when the scale does not contain the chord', () => {
    expect(availableTensions(makeChord(0, 'maj7'), 'mixolydian')).toEqual([]);
  });
});

describe('harmonic and melodic avoid notes', () => {
  it('lets a line pass through the fourth over Cmaj7 that a voicing may not sound', () => {
    expect(avoidNotes(makeChord(0, 'maj7'), 'ionian', { use: 'harmonic' })).toEqual([5]);
    expect(avoidNotes(makeChord(0, 'maj7'), 'ionian', { use: 'melodic' })).toEqual([]);
  });

  it('keeps the semitone above the root out of a line as well as a voicing', () => {
    // Eb over Dm7b5 is the semitone above the root, which no melodic figure
    // resolves; both uses report it.
    const chord = makeChord(2, 'm7b5');
    expect(avoidNotes(chord, 'locrian', { use: 'harmonic' })).toEqual([3]);
    expect(avoidNotes(chord, 'locrian', { use: 'melodic' })).toEqual([3]);
  });

  it('defaults to the harmonic reading', () => {
    expect(avoidNotes(makeChord(0, 'maj7'), 'ionian')).toEqual(
      avoidNotes(makeChord(0, 'maj7'), 'ionian', { use: 'harmonic' }),
    );
  });

  it('partitions every scale over every chord into avoid, passing and tensions', () => {
    // The whole chord vocabulary against the whole scale vocabulary: the
    // melodic reading is a subset of the harmonic one, tensions never overlap
    // the harmonic avoid notes, and together they account for exactly the scale
    // tones the chord does not state.
    const failures: string[] = [];
    for (const chord of everyChord()) {
      const chordPcs = new Set(chordPitchClasses(chord));
      for (const name of SCALE_NAMES) {
        const where = `${chord.quality}@${chord.rootPc}/${name}`;
        const harmonic = avoidNotes(chord, name);
        const melodic = avoidNotes(chord, name, { use: 'melodic' });
        const tensions = availableTensions(chord, name);
        if (melodic.some((pc) => !harmonic.includes(pc))) {
          failures.push(`${where}: melodic avoid is not a subset of harmonic`);
        }
        if (tensions.some((pc) => harmonic.includes(pc))) {
          failures.push(`${where}: a tension is also an avoid note`);
        }
        const scaleTones = [...scalePitchClasses(name, chord.rootPc)].filter(
          (pc) => !chordPcs.has(pc),
        );
        const union = [...new Set([...harmonic, ...tensions])].sort((a, b) => a - b);
        const expected = analysed(chord, name) ? scaleTones.sort((a, b) => a - b) : [];
        if (union.join() !== expected.join()) {
          failures.push(`${where}: ${union.join()} does not cover ${expected.join()}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('offers a dominant its minor-key colours only when it resolves to minor', () => {
    // G7 read on its own has no tension in the scale of C harmonic minor: the
    // b9, the 11 and the b13 each sit a semitone above a chord tone. Heard as
    // the dominant of C minor, the b9 and b13 are the key's own tones.
    const dominant = makeChord(7, 'dom7');
    expect(availableTensions(dominant, 'phrygianDominant')).toEqual([]);
    // The natural eleventh stays an avoid note; only the b9, #9 and b13 turn.
    expect(
      availableTensions(dominant, 'phrygianDominant', { resolvesTo: makeChord(0, 'min') }),
    ).toEqual([3, 8]);
    expect(
      availableTensions(dominant, 'phrygianDominant', { resolvesTo: makeChord(0, 'maj') }),
    ).toEqual([]);
    expect(
      availableTensions(dominant, 'phrygianDominant', { resolvesTo: makeChord(2, 'min') }),
    ).toEqual([]);
  });

  it('leaves a chord that is not a dominant seventh unchanged by resolvesTo', () => {
    const chord = makeChord(0, 'maj7');
    expect(availableTensions(chord, 'ionian', { resolvesTo: makeChord(5, 'min') })).toEqual(
      availableTensions(chord, 'ionian'),
    );
  });
});

describe('suspended chords', () => {
  /** The one suspension, under every name a chart writes it with. */
  const suspensions: [string, Chord][] = [
    ['Csus4', makeChord(0, 'sus4')],
    ['C7sus4', makeChord(0, '7sus4')],
    ['C11', makeChord(0, '11')],
    ['C9sus4', parseChordSymbol('C9sus4')],
    [
      'Csus4(add9)',
      chordFromSpec({ rootPc: 0, base: 'sus4', alterations: [], additions: [9], omissions: [] }),
    ],
  ];

  it.each(suspensions)('%s keeps the major third out of its tensions', (_name, chord) => {
    // The third is the one tone that undoes the suspension, whichever alias
    // built the chord: `9sus4` parses to the quality `11`, and the eleventh
    // chord states the suspension by omitting its third.
    expect(avoidNotes(chord, 'mixolydian')).toContain(4);
    expect(availableTensions(chord, 'mixolydian')).not.toContain(4);
  });

  it('reports the displaced third the same way for every suspension in the vocabulary', () => {
    // Structural, not a list of quality names: the subject is every chord the
    // library reads as suspending its third, whichever tone stands there. It
    // used to be every chord sounding a fourth, which quietly left the whole
    // `sus2` family out of the sweep — and the `sus2` family was where the rule
    // was wrong.
    const failures: string[] = [];
    let swept = 0;
    for (const chord of everyChord()) {
      const displaced = displacedThirds(chord);
      if (displaced.length === 0) {
        continue;
      }
      swept += 1;
      // Both thirds, not one: a suspension does not say which it displaced.
      for (const third of displaced) {
        for (const name of SCALE_NAMES) {
          const tensions = availableTensions(chord, name);
          const avoid = avoidNotes(chord, name);
          const inScale = scalePitchClasses(name, chord.rootPc).has(third);
          if (tensions.includes(third)) {
            failures.push(`${chord.quality}@${chord.rootPc}/${name}: third offered as a tension`);
          }
          if (inScale && analysed(chord, name) && !avoid.includes(third)) {
            failures.push(`${chord.quality}@${chord.rootPc}/${name}: third not avoided`);
          }
        }
      }
    }
    // The sweep has to have found suspensions, and both families of them.
    expect(swept).toBeGreaterThan(0);
    expect(displacedThirds(makeChord(0, 'sus2'))).toHaveLength(2);
    expect(displacedThirds(makeChord(0, 'sus4'))).toHaveLength(2);
    expect(failures).toEqual([]);
  });

  it('avoids the third a second suspends away from, not the flat ninth', () => {
    // The displaced third was computed as a semitone below the suspended tone,
    // which is the major third only for a `sus4`; over a `sus2` it named the
    // root's own flat ninth, a pitch class no major scale even carries, so
    // nothing was avoided and the third was offered as a free colour.
    expect(avoidNotes(makeChord(0, 'sus2'), 'ionian')).toEqual([4]);
    expect(availableTensions(makeChord(0, 'sus2'), 'ionian')).not.toContain(4);
  });

  it('leaves a chord that states its own third alone', () => {
    // The rule reads the tones, so a chord with a third keeps the plain
    // semitone-above rule and nothing else.
    expect(avoidNotes(makeChord(0, 'dom7'), 'mixolydian')).toEqual([5]);
    expect(displacedThirds(makeChord(0, 'dom7'))).toEqual([]);
  });
});

describe('chordScaleReport', () => {
  it('combines matches with their avoid notes and tensions', () => {
    const report = chordScaleReport(makeChord(0, 'maj7'));
    const ionian = report.find((entry) => entry.name === 'ionian');
    expect(ionian).toBeDefined();
    expect(ionian?.rootPc).toBe(0);
    // F may not be sounded against Cmaj7, but a line may pass through it, so it
    // is reported as passing rather than as an avoid note.
    expect(ionian?.avoid).toEqual([]);
    expect(ionian?.passing).toEqual([5]);
    expect(ionian?.tensions).toEqual([2, 9]);
  });

  it('splits the non-chord scale tones three ways without losing one', () => {
    const failures: string[] = [];
    for (const chord of everyChord()) {
      const chordPcs = new Set(chordPitchClasses(chord));
      for (const entry of chordScaleReport(chord)) {
        const where = `${chord.quality}@${chord.rootPc}/${entry.name}`;
        const harmonic = avoidNotes(chord, entry.name);
        const split = [...entry.avoid, ...entry.passing].sort((a, b) => a - b);
        if (split.join() !== harmonic.join()) {
          failures.push(`${where}: avoid + passing is not the harmonic reading`);
        }
        if (entry.avoid.some((pc) => entry.passing.includes(pc))) {
          failures.push(`${where}: a tone is both avoided and passing`);
        }
        const covered = [...split, ...entry.tensions].sort((a, b) => a - b);
        const scaleTones = [...scalePitchClasses(entry.name, chord.rootPc)]
          .filter((pc) => !chordPcs.has(pc))
          .sort((a, b) => a - b);
        if (analysed(chord, entry.name) && covered.join() !== scaleTones.join()) {
          failures.push(`${where}: the entry does not account for every scale tone`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('honors the limit argument', () => {
    const report = chordScaleReport(makeChord(0, 'maj7'), 1);
    expect(report).toHaveLength(1);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid report limit (%s)', (limit) => {
    expect(() => chordScaleReport(makeChord(0, 'maj7'), limit)).toThrow(RangeError);
  });

  it('reports the chromatic fallback for an unsupported chord', () => {
    const report = chordScaleReport(makeChord(0, 'augMaj7'));
    expect(report).toHaveLength(1);
    expect(report[0]?.name).toBe('chromatic');
  });

  it('reports an unknown scale name the same way scaleByName does', () => {
    expect(() => avoidNotes(makeChord(0, 'maj7'), 'not-a-scale')).toThrow(RangeError);
    expect(() => availableTensions(makeChord(0, 'maj7'), 'not-a-scale')).toThrow(RangeError);
    expect(() => scaleByName('not-a-scale', 0)).toThrow(RangeError);
  });
});

describe('scalesForChanges', () => {
  it('picks scales from the same collection for a ii-V-I in C', () => {
    const chords = [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')];
    const choices = scalesForChanges(chords);
    expect(choices).toHaveLength(3);
    expect(choices[0]?.scale.name).toBe('dorian');
    expect(choices[1]?.scale.name).toBe('mixolydian');
    expect(choices[2]?.scale.name).toBe('ionian');

    const first = choices[0]?.scale ?? { name: '', rootPc: 0 };
    const collection = scalePitchClasses(first.name, first.rootPc);
    for (const choice of choices) {
      const pcs = scalePitchClasses(choice.scale.name, choice.scale.rootPc);
      expect(pcs).toEqual(collection);
    }
  });

  it('returns the best-fit scale for a single chord', () => {
    const chord = makeChord(0, 'maj7');
    const choices = scalesForChanges([chord]);
    expect(choices).toEqual([{ chord, scale: chordScales(chord)[0] }]);
  });

  it('returns [] for an empty input', () => {
    expect(scalesForChanges([])).toEqual([]);
  });

  it('returns one choice per chord, rooted on each chord root', () => {
    const chords = [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')];
    const choices = scalesForChanges(chords);
    expect(choices).toHaveLength(chords.length);
    choices.forEach((choice, i) => {
      expect(choice.chord).toBe(chords[i]);
      expect(choice.scale.rootPc).toBe(chords[i]?.rootPc);
    });
  });
});

describe('chord-scale acceptance domain', () => {
  it('rejects a world scale, which chord-scale theory does not rank', () => {
    // A raga offered as the scale over a chord would read as an answer while
    // being a category error, so the two per-scale questions accept exactly
    // what `chordScales` is able to propose.
    for (const name of Object.keys(WORLD_SCALES)) {
      expect(() => avoidNotes(makeChord(0, 'min7'), name)).toThrow(InvalidInputError);
      expect(() => availableTensions(makeChord(0, 'min7'), name)).toThrow(InvalidInputError);
    }
  });

  it('rejects an alias of a world scale too', () => {
    expect(() => avoidNotes(makeChord(0, 'min7'), 'okinawan')).toThrow(InvalidInputError);
    expect(() => availableTensions(makeChord(0, 'min7'), 'hicaz')).toThrow(InvalidInputError);
  });

  it('accepts every scale chordScales can propose', () => {
    const chord = makeChord(0, 'min7');
    for (const name of Object.keys(NAMED_SCALES)) {
      expect(() => avoidNotes(chord, name)).not.toThrow();
      expect(() => availableTensions(chord, name)).not.toThrow();
    }
    for (const match of chordScales(chord)) {
      expect(() => avoidNotes(chord, match.name)).not.toThrow();
      expect(() => availableTensions(chord, match.name)).not.toThrow();
    }
  });
});
