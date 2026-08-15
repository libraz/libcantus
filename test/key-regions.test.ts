import { describe, expect, it } from 'vitest';
import type { KeyRegion } from '../src/analyze/keys/index.js';
import {
  detectModulations,
  keyTimelineFromNotes,
  prevailingKeyOf,
} from '../src/analyze/keys/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { formatNote } from '../src/core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../src/core/types.js';
import type { ChordQuality, ChordSegment } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import {
  MAJOR_MASK,
  majorKey,
  minorKey,
  NATURAL_MINOR_MASK,
  spelledKeyOf,
} from '../src/theory/scale/index.js';

/** One bar of 4/4: a bass note under an upper voicing, all sounding together. */
function bar(startBeat: number, bass: number, upper: number[]): NoteEvent[] {
  return [bass, ...upper].map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
}

/**
 * Four bars of C major: I IV V7 I. The B and the F of the G7 are the tritone
 * that names C, and no pitch outside the C major collection sounds.
 */
function cPhrase(at: number): NoteEvent[] {
  return [
    ...bar(at + 0, 36, [60, 64, 67]), // C   C E G
    ...bar(at + 4, 41, [65, 69, 72]), // F   F A C
    ...bar(at + 8, 43, [67, 71, 74, 77]), // G7  G B D F
    ...bar(at + 12, 36, [60, 64, 67]), // C   C E G
  ];
}

/**
 * The same four bars a fifth higher: I IV V7 I in G major. F# is the only tone
 * outside C major, and it is exactly the tone that separates the two keys.
 */
function gPhrase(at: number): NoteEvent[] {
  return [
    ...bar(at + 0, 43, [67, 71, 74]), // G   G B D
    ...bar(at + 4, 48, [72, 76, 79]), // C   C E G
    ...bar(at + 8, 50, [74, 78, 81, 84]), // D7  D F# A C
    ...bar(at + 12, 43, [67, 71, 74]), // G   G B D
  ];
}

/**
 * Four bars of A minor: i iv V7 i. G# is the raised leading tone, the only tone
 * outside the C major collection and the one that says A minor rather than C.
 */
function aMinorPhrase(at: number): NoteEvent[] {
  return [
    ...bar(at + 0, 45, [57, 60, 64]), // Am  A C E
    ...bar(at + 4, 50, [62, 65, 69]), // Dm  D F A
    ...bar(at + 8, 52, [64, 68, 71, 74]), // E7  E G# B D
    ...bar(at + 12, 45, [57, 60, 64]), // Am  A C E
  ];
}

/** One bar-long chord segment in 4/4. */
function seg(startBeat: number, rootPc: number, quality: ChordQuality): ChordSegment {
  return { startBeat, endBeat: startBeat + 4, chord: makeChord(rootPc, quality) };
}

/** C: I IV V7 I, then G: I IV V7 I — the same music as the note fixtures. */
const C_TO_G_CHORDS: readonly ChordSegment[] = [
  seg(0, 0, 'maj'), // C
  seg(4, 5, 'maj'), // F
  seg(8, 7, 'dom7'), // G7
  seg(12, 0, 'maj'), // C
  seg(16, 7, 'maj'), // G
  seg(20, 0, 'maj'), // C
  seg(24, 2, 'dom7'), // D7
  seg(28, 7, 'maj'), // G
];

/** C: I IV V7 I twice over — eight bars that never leave C major. */
const ALL_C_CHORDS: readonly ChordSegment[] = [
  seg(0, 0, 'maj'),
  seg(4, 5, 'maj'),
  seg(8, 7, 'dom7'),
  seg(12, 0, 'maj'),
  seg(16, 0, 'maj'),
  seg(20, 5, 'maj'),
  seg(24, 7, 'dom7'),
  seg(28, 0, 'maj'),
];

/** Name a key the way it is read aloud, e.g. `'A minor'`. */
function keyName(key: KeyScale | null): string {
  if (key === null) {
    return 'none';
  }
  const mode =
    key.modeMask12 === NATURAL_MINOR_MASK
      ? 'minor'
      : key.modeMask12 === MAJOR_MASK
        ? 'major'
        : `mask ${key.modeMask12}`;
  return `${formatNote(spelledKeyOf(key).tonic)} ${mode}`;
}

/** Every region's key, in time order. */
function keyNames(regions: readonly KeyRegion[]): string[] {
  return regions.map((region) => keyName(region.key));
}

/**
 * The part of a region the two entry points must agree on: where it runs and
 * what key it is in. Confidence is scored differently on each path — one
 * correlates pitch-class weight, the other counts chord membership — so it is
 * left out of the comparison.
 */
function shapeOf(regions: readonly KeyRegion[]): unknown[] {
  return regions.map((region) => ({
    startBeat: region.startBeat,
    endBeat: region.endBeat,
    key: keyName(region.key),
    modulation: region.modulation,
  }));
}

/**
 * Check the shape every region must have whatever the input was: a positive
 * span, a confidence that is a real number in [0, 1], and a key built from an
 * integral root and mask. Regions must run forwards without overlapping; when
 * `contiguous` is set they must also leave no gap, which is what the note path
 * guarantees by tiling the span in fixed slots.
 */
function expectWellFormed(
  regions: readonly KeyRegion[],
  opts: { contiguous?: boolean; span?: [number, number] } = {},
): void {
  regions.forEach((region, i) => {
    const at = `region ${i}`;
    expect(Number.isFinite(region.startBeat), at).toBe(true);
    expect(Number.isFinite(region.endBeat), at).toBe(true);
    expect(region.endBeat, at).toBeGreaterThan(region.startBeat);
    expect(Number.isFinite(region.confidence), at).toBe(true);
    expect(region.confidence, at).toBeGreaterThanOrEqual(0);
    expect(region.confidence, at).toBeLessThanOrEqual(1);
    expect(Number.isInteger(region.key.rootPc), at).toBe(true);
    expect(Number.isInteger(region.key.modeMask12), at).toBe(true);
    const previous = regions[i - 1];
    if (previous !== undefined) {
      expect(region.startBeat, at).toBeGreaterThanOrEqual(previous.endBeat);
      if (opts.contiguous === true) {
        expect(region.startBeat, at).toBe(previous.endBeat);
      }
    }
  });
  // The first region is the point of reference, so it has nothing to relate to.
  if (regions.length > 0) {
    expect(regions[0]).not.toHaveProperty('modulation');
  }
  if (opts.span !== undefined && regions.length > 0) {
    expect(regions[0]?.startBeat).toBe(opts.span[0]);
    expect(regions[regions.length - 1]?.endBeat).toBe(opts.span[1]);
  }
}

describe('keyTimelineFromNotes', () => {
  it('reports one region for a phrase that never leaves its key', () => {
    // Four bars of C: I IV V7 I. Every pitch belongs to C major and the V7 - I
    // closes it, so there is no second key for the search to prefer anywhere.
    const regions = keyTimelineFromNotes(cPhrase(0));
    expect(regions).toHaveLength(1);
    expect(keyNames(regions)).toEqual(['C major']);
    expectWellFormed(regions, { contiguous: true, span: [0, 16] });
    // The distribution is the C major profile's own shape, so the correlation
    // is near its ceiling; anything below this would mean the profiles no
    // longer recognize a plain tonic phrase.
    expect(regions[0]?.confidence).toBeGreaterThan(0.9);
  });

  it('reports a move to the dominant as one modulation', () => {
    // C: I IV V7 I then the same phrase a fifth higher, I IV V7 I in G. The
    // only tone separating the two keys is the F# of the second phrase's D7,
    // so nothing before that chord names G outright — but the second phrase's
    // collection as a whole already leans to G, which is the evidence this
    // path weighs.
    const regions = keyTimelineFromNotes([...cPhrase(0), ...gPhrase(16)]);
    expect(regions).toHaveLength(2);
    expect(keyNames(regions)).toEqual(['C major', 'G major']);
    expect(regions[1]?.modulation).toBe('dominant');
    expectWellFormed(regions, { contiguous: true, span: [0, 32] });
    // The change is dated at the phrase boundary. The bar before it is the
    // resolution of the first phrase's own V7 - I, so the old key holds through
    // it: this path weighs the whole pitch collection, and that cadence's F
    // natural is evidence against G that the following G triad does not
    // outweigh. The chord path, which sees chord identities rather than pitch
    // classes, dates the same modulation later; see the cross-path test.
    expect(regions[1]?.startBeat).toBe(16);
  });

  it('reports a move to the relative minor as one modulation', () => {
    // C: I IV V7 I then a: i iv V7 i. The two keys share a signature, so the
    // only pitch evidence for the change is the G# of the E7 and the weight
    // that lands on A rather than on C.
    const regions = keyTimelineFromNotes([...cPhrase(0), ...aMinorPhrase(16)]);
    expect(regions).toHaveLength(2);
    expect(keyNames(regions)).toEqual(['C major', 'A minor']);
    expect(regions[1]?.modulation).toBe('relative');
    // Membership cannot date this modulation the way it dates a move to the
    // dominant: the two keys hold the same seven tones apart from the leading
    // note, so every chord of bars five and six is diatonic to both. What moves
    // is the weight — A, D and E carry the bars where C, F and G carried them —
    // and it moves at the head of the second phrase, so the boundary is beat 16.
    expect(regions[1]?.startBeat).toBe(16);
    expectWellFormed(regions, { contiguous: true, span: [0, 32] });
  });

  it('does not split a phrase that is merely repeated', () => {
    // The same four bars of C twice. Nothing changes, so neither should the key.
    const regions = keyTimelineFromNotes([...cPhrase(0), ...cPhrase(16)]);
    expect(regions).toHaveLength(1);
    expect(keyNames(regions)).toEqual(['C major']);
    expectWellFormed(regions, { contiguous: true, span: [0, 32] });
  });

  it('does not read a passing chromatic bar as a modulation', () => {
    // Eight bars of C with the fifth bar replaced by an F# major triad. F# is
    // six steps around the circle of fifths from C, so hearing that one bar as
    // its own key would mean paying the most expensive modulation twice to
    // explain a quarter of the music, against seven bars that all say C.
    const notes = [
      ...cPhrase(0),
      ...bar(16, 42, [66, 70, 73]), // F#  F# A# C#
      ...cPhrase(16).filter((note) => note.startBeat >= 20),
    ];
    const regions = keyTimelineFromNotes(notes);
    expect(regions).toHaveLength(1);
    expect(keyNames(regions)).toEqual(['C major']);
    expectWellFormed(regions, { contiguous: true, span: [0, 32] });
  });

  it('never names a pivot, even when it reports a modulation', () => {
    // Raw notes do not say which chord sounded at the boundary, and a pivot is
    // a chord read in two keys at once, so this path leaves the field unset.
    const regions = keyTimelineFromNotes([...cPhrase(0), ...gPhrase(16)]);
    expect(regions.length).toBeGreaterThan(1);
    for (const region of regions) {
      expect(region).not.toHaveProperty('pivot');
    }
  });

  it('returns the same regions for the same notes', () => {
    const notes = [...cPhrase(0), ...gPhrase(16)];
    expect(keyTimelineFromNotes(notes)).toEqual(keyTimelineFromNotes(notes));
  });

  it('returns nothing when nothing sounds', () => {
    expect(keyTimelineFromNotes([])).toEqual([]);
    // Notes of no length are accepted but sound for no time, so there is still
    // no music to read a key from.
    expect(keyTimelineFromNotes([{ pitch: 60, startBeat: 0, durationBeat: 0 }])).toEqual([]);
    // An explicitly empty span leaves no slot to fill.
    expect(keyTimelineFromNotes(cPhrase(0), { totalBeats: 0 })).toEqual([]);
  });

  const degenerate: { name: string; notes: NoteEvent[]; span: [number, number] }[] = [
    {
      name: 'a single note',
      notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }],
      span: [0, 4],
    },
    {
      name: 'a semitone dyad',
      notes: [
        { pitch: 60, startBeat: 0, durationBeat: 4 },
        { pitch: 61, startBeat: 0, durationBeat: 4 },
      ],
      span: [0, 4],
    },
    {
      name: 'a chromatic cluster',
      notes: Array.from({ length: 12 }, (_, i) => ({
        pitch: 60 + i,
        startBeat: 0,
        durationBeat: 4,
      })),
      span: [0, 4],
    },
    {
      name: 'one note repeated',
      notes: [0, 4, 8, 12].map((startBeat) => ({ pitch: 60, startBeat, durationBeat: 4 })),
      span: [0, 16],
    },
  ];

  for (const fixture of degenerate) {
    it(`reports well-formed regions for ${fixture.name}`, () => {
      // None of these states a key, and a perfectly even distribution has no
      // correlation to any profile at all; whatever key comes back, the regions
      // must still tile the span and carry a real confidence.
      const regions = keyTimelineFromNotes(fixture.notes);
      expect(regions.length).toBeGreaterThan(0);
      expectWellFormed(regions, { contiguous: true, span: fixture.span });
    });
  }
});

describe('keyTimelineFromNotes options', () => {
  it('treats expectedKeyBeats as a prior on how long a key holds', () => {
    const notes = [...cPhrase(0), ...gPhrase(16)];
    // The default expectation is four bars, half the span, so eight bars have
    // room for two key areas and the modulation is reported.
    expect(keyTimelineFromNotes(notes)).toHaveLength(2);
    // Expecting a key to hold for far longer than the whole span makes one
    // modulation cost more evidence than the span contains, so the same music
    // collapses into a single region. Which key survives is genuinely
    // ambiguous — seven of the eight bars fit C major and seven fit G major —
    // so only the collapse is asserted.
    const collapsed = keyTimelineFromNotes(notes, { expectedKeyBeats: 1000 });
    expect(collapsed).toHaveLength(1);
    expectWellFormed(collapsed, { contiguous: true, span: [0, 32] });
  });

  it('rejects a key length that is not positive', () => {
    const notes = cPhrase(0);
    expect(() => keyTimelineFromNotes(notes, { expectedKeyBeats: 0 })).toThrow(InvalidInputError);
    expect(() => keyTimelineFromNotes(notes, { expectedKeyBeats: -4 })).toThrow(InvalidInputError);
    expect(() => keyTimelineFromNotes(notes, { minKeyBeats: 0 })).toThrow(InvalidInputError);
    expect(() => keyTimelineFromNotes(notes, { minKeyBeats: -1 })).toThrow(InvalidInputError);
    expect(() => keyTimelineFromNotes(notes, { expectedKeyBeats: Number.NaN })).toThrow(
      InvalidInputError,
    );
  });
});

describe('detectModulations', () => {
  it('names the pivot chord of a move to the dominant', () => {
    // C F G7 C | G C D7 G. The change of key is heard where the harmony stops
    // fitting the old key, not at the bar line the phrases are written across:
    // the G of bar five is V of C almost as readily as it is the tonic of G,
    // and the C of bar six is the tonic of C far more readily than it is IV of
    // G, so both bars still argue for C. The first chord C major cannot explain
    // is the D7 of bar seven, whose F# is foreign to C and which G major reads
    // as its own dominant seventh. The boundary therefore falls on that chord,
    // and the pivot is the C major triad that runs into it: I in the key being
    // left, IV in the key entered.
    const regions = detectModulations(C_TO_G_CHORDS);
    expect(regions).toHaveLength(2);
    expect(keyNames(regions)).toEqual(['C major', 'G major']);
    expect(regions[1]?.modulation).toBe('dominant');
    expect(regions[1]?.startBeat).toBe(24);
    expectWellFormed(regions, { contiguous: true, span: [0, 32] });
    const pivot = regions[1]?.pivot;
    expect(pivot).toBeDefined();
    expect(pivot?.chord.rootPc).toBe(0);
    expect(pivot?.chord.quality).toBe('maj');
    expect(pivot?.romanFrom).toBe('I');
    expect(pivot?.romanTo).toBe('IV');
  });

  it('reads the same music as the note path, but dates the change later', () => {
    // The chords here are the ones the note fixture spells out, bar for bar, so
    // the two paths are analyzing the same eight bars. They agree on what
    // happens — C major moving to its dominant, one modulation — and differ on
    // when, because they weigh different evidence.
    //
    // The chord path waits for the D7 of bar seven, the first chord C major
    // cannot contain: bars five and six are a G triad and a C triad, which read
    // as V and I of C as readily as I and IV of G, so no chord before the D7
    // requires G major at all. The note path turns at the phrase boundary two
    // bars earlier, because it hears the notes rather than the chord names and
    // the second phrase's pitch collection leans to G from its first bar.
    // Neither is the other's error — they weigh different evidence, and pinning
    // both is what would show either one moving.
    const fromNotes = keyTimelineFromNotes([...cPhrase(0), ...gPhrase(16)]);
    const fromChords = detectModulations(C_TO_G_CHORDS);
    expect(keyNames(fromChords)).toEqual(keyNames(fromNotes));
    expect(fromChords.map((region) => region.modulation)).toEqual(
      fromNotes.map((region) => region.modulation),
    );
    expect(shapeOf(fromChords)).toEqual([
      { startBeat: 0, endBeat: 24, key: 'C major', modulation: undefined },
      { startBeat: 24, endBeat: 32, key: 'G major', modulation: 'dominant' },
    ]);
    expect(shapeOf(fromNotes)).toEqual([
      { startBeat: 0, endBeat: 16, key: 'C major', modulation: undefined },
      { startBeat: 16, endBeat: 32, key: 'G major', modulation: 'dominant' },
    ]);
  });

  it('reports one region for chords that stay in one key', () => {
    // C F G7 C twice. Every chord is diatonic to C and two of them are its
    // dominant seventh, which no other key can claim.
    const regions = detectModulations(ALL_C_CHORDS);
    expect(regions).toHaveLength(1);
    expect(keyNames(regions)).toEqual(['C major']);
    expectWellFormed(regions, { contiguous: true, span: [0, 32] });
    expect(regions[0]).not.toHaveProperty('pivot');
  });

  it('reads a chord timeline inferred from notes', () => {
    // The chord path is meant to be fed a timeline, so the same four bars of C
    // are analyzed through the detector rather than through hand-built chords.
    const { timeline } = chordTimelineFromNotes(cPhrase(0));
    const regions = detectModulations(timeline.segments);
    expect(keyNames(regions)).toEqual(['C major']);
    expectWellFormed(regions);
  });

  it('does not depend on the order the segments are given in', () => {
    const shuffled = [...C_TO_G_CHORDS].reverse();
    expect(detectModulations(shuffled)).toEqual(detectModulations(C_TO_G_CHORDS));
  });

  it('returns the same regions for the same chords', () => {
    expect(detectModulations(C_TO_G_CHORDS)).toEqual(detectModulations(C_TO_G_CHORDS));
  });

  it('returns nothing when there are no chords to read', () => {
    expect(detectModulations([])).toEqual([]);
    // A segment of no length carries no evidence and is dropped, which leaves
    // the same empty input.
    expect(detectModulations([{ startBeat: 4, endBeat: 4, chord: makeChord(0, 'maj') }])).toEqual(
      [],
    );
  });

  it('rejects a key length that is not positive', () => {
    expect(() => detectModulations(C_TO_G_CHORDS, { expectedKeyBeats: 0 })).toThrow(
      InvalidInputError,
    );
    expect(() => detectModulations(C_TO_G_CHORDS, { expectedKeyBeats: -4 })).toThrow(
      InvalidInputError,
    );
  });
});

describe('prevailingKeyOf', () => {
  /** A region of the given span and key; confidence is irrelevant to the sum. */
  function region(startBeat: number, endBeat: number, key: KeyScale): KeyRegion {
    return { startBeat, endBeat, key, confidence: 1 };
  }

  it('has no answer when there are no regions', () => {
    expect(prevailingKeyOf([])).toBeNull();
  });

  it('answers with the longest-held key rather than the first', () => {
    // One bar of C against four bars of G: the piece opens in C but lives in G.
    const key = prevailingKeyOf([region(0, 4, majorKey(0)), region(4, 20, majorKey(7))]);
    expect(keyName(key)).toBe('G major');
  });

  it('sums a key returned to across the digression that interrupts it', () => {
    // C for two bars, G for three, C again for two. Neither stretch of C is as
    // long as the stretch of G, so a search for the single longest region would
    // answer G; the eight beats before and the eight after are the same key,
    // and sixteen beats of C outweigh twelve of G.
    const key = prevailingKeyOf([
      region(0, 8, majorKey(0)),
      region(8, 20, majorKey(7)),
      region(20, 28, majorKey(0)),
    ]);
    expect(keyName(key)).toBe('C major');
  });

  it('keeps the key established first when two are held equally long', () => {
    const key = prevailingKeyOf([region(0, 8, majorKey(0)), region(8, 16, minorKey(9))]);
    expect(keyName(key)).toBe('C major');
  });

  it('answers for the regions the analyzers actually return', () => {
    const regions = keyTimelineFromNotes([...cPhrase(0), ...cPhrase(16)]);
    expect(keyName(prevailingKeyOf(regions))).toBe('C major');
  });
});
