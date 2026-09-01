import { describe, expect, it } from 'vitest';
import type { KeyRegion } from '../src/analyze/keys/index.js';
import {
  attachPivots,
  detectModulations,
  keyTimelineFromNotes,
  prevailingKeyOf,
} from '../src/analyze/keys/index.js';
import { analyzeTimeline, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { MeterMap } from '../src/core/meter/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import { formatNote } from '../src/core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../src/core/types.js';
import type { Chord, ChordQuality, ChordSegment } from '../src/theory/chord/index.js';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
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

/**
 * Thirteen bars of C major with three bars of Db7 Gb Db7 in the middle: a
 * three-bar tonicization far enough round the circle of fifths that the search
 * reports it as a key area of its own unless told how short a key area may be.
 */
const TONICIZATION_CHORDS: readonly ChordSegment[] = [
  seg(0, 0, 'maj'), // C
  seg(4, 5, 'maj'), // F
  seg(8, 7, 'dom7'), // G7
  seg(12, 0, 'maj'), // C
  seg(16, 1, 'dom7'), // Db7
  seg(20, 6, 'maj'), // Gb
  seg(24, 1, 'dom7'), // Db7
  seg(28, 5, 'maj'), // F
  seg(32, 7, 'dom7'), // G7
  seg(36, 0, 'maj'), // C
  seg(40, 5, 'maj'), // F
  seg(44, 7, 'dom7'), // G7
  seg(48, 0, 'maj'), // C
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
 * what key it is in. Both score confidence the same way, but they weigh
 * different evidence for it — one the notes, the other the chords named over
 * them — so it is left out of the comparison.
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

describe('keyTimelineFromNotes and the meter', () => {
  /**
   * Two bars of 4/4 then two of 3/4, one triad per bar: C, F, G, C. The bar
   * lines fall at 0, 4, 8 and 11, so the last two downbeats are exactly the
   * beats a reading stuck in 4/4 would call weak.
   */
  const CHANGING: MeterMap = [
    { startBeat: 0, ts: parseTimeSignature('4/4') },
    { startBeat: 8, ts: parseTimeSignature('3/4') },
  ];

  /** A triad sounding across one bar. */
  function triad(root: number, startBeat: number, durationBeat: number): NoteEvent[] {
    return [root, root + 4, root + 7].map((pitch) => ({ pitch, startBeat, durationBeat }));
  }

  const CHANGING_PIECE: NoteEvent[] = [
    ...triad(60, 0, 4), // C
    ...triad(65, 4, 4), // F
    ...triad(67, 8, 3), // G
    ...triad(60, 11, 3), // C
  ];

  it('reads a piece that changes metre in the metre it is in', () => {
    const regions = keyTimelineFromNotes(CHANGING_PIECE, { meters: CHANGING });
    expect(keyNames(regions)).toEqual(['C major']);
    expectWellFormed(regions, { contiguous: true, span: [0, 14] });
    // Every onset after the change is a downbeat of its own bar, so each one
    // carries the accent bonus a downbeat earns. Reading the same notes in 4/4
    // throughout puts those accents on beats 8 and 12 instead — the second of
    // which no note starts on — so the two readings weigh the music
    // differently even though they agree on the key.
    const asCommon = keyTimelineFromNotes(CHANGING_PIECE, { ts: parseTimeSignature('4/4') });
    expect(regions[0]?.confidence).not.toBe(asCommon[0]?.confidence);
  });

  it('rejects naming the meter twice', () => {
    expect(() =>
      keyTimelineFromNotes(CHANGING_PIECE, { ts: parseTimeSignature('4/4'), meters: CHANGING }),
    ).toThrow(InvalidInputError);
    expect(() =>
      detectModulations(C_TO_G_CHORDS, { ts: parseTimeSignature('4/4'), meters: CHANGING }),
    ).toThrow(InvalidInputError);
  });

  it('reads the notes of a pickup instead of dropping them', () => {
    // Two bars outlining C E G, a quarter note per beat. The outline alone is
    // as much an E minor statement as a C major one, and the weight it puts on
    // E is enough to settle it as E minor.
    const body: NoteEvent[] = [60, 64, 67, 64, 60, 64, 67, 64].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    // An F natural upbeat: foreign to E minor, diatonic to C major, and the
    // only tone in the piece that tells the two apart. It sounds before the
    // first downbeat, so it is written at a negative beat.
    const pickup: NoteEvent = { pitch: 65, startBeat: -1, durationBeat: 1 };
    const withPickup = keyTimelineFromNotes([pickup, ...body]);
    const withoutPickup = keyTimelineFromNotes(body);
    // The grid runs back a whole bar to reach the upbeat, but the region is
    // reported from the upbeat itself: the three beats before it hold no music,
    // so naming them as part of a key area would invent a bar the piece has not
    // got. The pickup is still inside the span rather than left outside it.
    expect(withPickup[0]?.startBeat).toBe(-1);
    expectWellFormed(withPickup, { contiguous: true, span: [-1, 8] });
    // One upbeat note against eight in the body, and it changes the answer —
    // which it can only do if the pickup was analyzed at all.
    expect(keyNames(withPickup)).toEqual(['C major']);
    expect(keyNames(withoutPickup)).toEqual(['E minor']);
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
    expect(() => detectModulations(C_TO_G_CHORDS, { minKeyBeats: 0 })).toThrow(InvalidInputError);
    expect(() => detectModulations(C_TO_G_CHORDS, { totalBeats: -1 })).toThrow(InvalidInputError);
  });

  it('reports no region shorter than minKeyBeats', () => {
    // C major with three bars of Db7 Gb Db7 dropped into the middle: far enough
    // round the circle of fifths, and cadential enough, to be worth reporting as
    // its own key area — but only three bars of one.
    const regions = detectModulations(TONICIZATION_CHORDS);
    expect(keyNames(regions)).toEqual(['C major', 'Gb major', 'C major']);
    expect(regions[1] && regions[1].endBeat - regions[1].startBeat).toBe(12);
    expectWellFormed(regions, { contiguous: true, span: [0, 52] });

    // Four bars is the shortest key area the caller will accept, so the three
    // bars are heard as a tonicization inside C rather than as a key of their
    // own. Nothing else about the input changed.
    const merged = detectModulations(TONICIZATION_CHORDS, { minKeyBeats: 16 });
    expect(keyNames(merged)).toEqual(['C major']);
    expectWellFormed(merged, { contiguous: true, span: [0, 52] });
    for (const region of merged) {
      expect(region.endBeat - region.startBeat).toBeGreaterThanOrEqual(16);
    }
  });

  it('ends the span where totalBeats says, not where the chords stop', () => {
    // Half the phrase: the chords past the end are outside the analyzed span, so
    // no region reaches them.
    const clipped = detectModulations(ALL_C_CHORDS, { totalBeats: 18 });
    expect(keyNames(clipped)).toEqual(['C major']);
    expectWellFormed(clipped, { contiguous: true, span: [0, 18] });

    // Past the last chord: silence changes no key, so the last region holds to
    // the end of the span the caller named.
    const held = detectModulations(ALL_C_CHORDS, { totalBeats: 64 });
    expect(keyNames(held)).toEqual(['C major']);
    expectWellFormed(held, { contiguous: true, span: [0, 64] });

    // A span ending before the first chord leaves nothing to read.
    expect(detectModulations(ALL_C_CHORDS, { totalBeats: 0 })).toEqual([]);
  });

  it('reads the same keys whatever key profile is named', () => {
    // The chord path settles which key holds by the part each chord plays in
    // it, never by weighing pitch classes, so the profile cannot move a region
    // or rename a key. It does score the confidence — that is the one statistic
    // every entry point reports — so only the regions themselves are pinned.
    const base = detectModulations(C_TO_G_CHORDS);
    expect(detectModulations(C_TO_G_CHORDS, { profile: 'krumhansl' })).toEqual(base);
    const temperley = detectModulations(C_TO_G_CHORDS, { profile: 'temperley' });
    expect(keyNames(temperley)).toEqual(keyNames(base));
    expect(temperley.map((region) => [region.startBeat, region.endBeat])).toEqual(
      base.map((region) => [region.startBeat, region.endBeat]),
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

describe('detectModulations names the pivot from the triad the chord is heard as', () => {
  /** The C-to-G fixture with the chord running into the boundary replaced. */
  function withBoundaryChord(chord: Chord): ChordSegment[] {
    return C_TO_G_CHORDS.map((segment, i) =>
      i === 5 ? { startBeat: 20, endBeat: 24, chord } : segment,
    );
  }

  /**
   * The C major triad written every way a chart writes one over it. Only tones
   * both keys already contain: a chord bringing in a pitch foreign to the key
   * being left is evidence about where the boundary falls, and moves it.
   */
  const OVER_A_MAJOR_TRIAD: ChordQuality[] = [
    'maj',
    'maj7',
    'dom7',
    '6',
    'maj9',
    '6/9',
    'maj13',
    'add9',
    '7#9',
  ];

  for (const quality of OVER_A_MAJOR_TRIAD) {
    it(`pivots on the triad under a C${quality}`, () => {
      // The candidates are triads by contract, and the chord that turns a
      // modulation is heard as one whatever is played over it: a seventh, a
      // sixth or a tension does not narrow the ground the two keys share.
      const regions = detectModulations(withBoundaryChord(makeChord(0, quality)));
      expect(keyNames(regions)).toEqual(['C major', 'G major']);
      expect(regions[1]?.startBeat).toBe(24);
      const pivot = regions[1]?.pivot;
      expect(pivot?.chord.rootPc).toBe(0);
      expect(pivot?.chord.quality).toBe('maj');
      expect(pivot?.romanFrom).toBe('I');
      expect(pivot?.romanTo).toBe('IV');
    });
  }

  for (const bassPc of [4, 7]) {
    it(`pivots on the triad under an inversion with bass ${bassPc}`, () => {
      // A pivot is a sonority, not a voicing: the same triad in first or second
      // inversion turns the same modulation.
      const regions = detectModulations(withBoundaryChord(makeChord(0, 'maj', bassPc)));
      expect(regions[1]?.pivot?.romanFrom).toBe('I');
      expect(regions[1]?.pivot?.romanTo).toBe('IV');
    });
  }

  for (const quality of ['sus4', 'sus2', '5'] as const) {
    it(`names no pivot when the boundary chord is a C${quality}`, () => {
      // The third is replaced rather than played, so there is no triad to hear
      // the chord as and nothing for the two keys to have in common.
      const regions = detectModulations(withBoundaryChord(makeChord(0, quality)));
      expect(regions[1]).not.toHaveProperty('pivot');
    });
  }

  it('attaches a pivot to exactly the chords sounding the candidate triad', () => {
    // The boundary is fixed and every quality in the vocabulary is tried over
    // the same root, so the rule is read off the whole vocabulary rather than
    // from a handful of examples: the pivot is attached when the chord sounds
    // the candidate's own third and fifth, and never otherwise.
    for (const quality of chordQualities()) {
      const chord = makeChord(0, quality);
      const regions = attachPivots(
        [
          { startBeat: 0, endBeat: 24, key: majorKey(0), confidence: 1 },
          { startBeat: 24, endBeat: 32, key: majorKey(7), confidence: 1 },
        ],
        [{ startBeat: 20, endBeat: 24, chord }],
      );
      // C major is I of C and IV of G; the candidate is its triad, so the chord
      // matches exactly when it sounds a major third and a perfect fifth.
      const soundsTheTriad = chord.intervals.includes(4) && chord.intervals.includes(7);
      expect(regions[1]?.pivot !== undefined, quality).toBe(soundsTheTriad);
    }
  });
});

describe('KeyRegion.confidence is one statistic across the entry points', () => {
  it('reports the same confidence for the same music read either way', () => {
    // The chord path used to average how well each chord belonged to the key,
    // which pegs a diatonic phrase at exactly 1 and cannot be compared with the
    // correlation the note path reports. Both now correlate the span's
    // pitch-class distribution against the profile, and a correlation is
    // scale-free, so the two paths agree on the same four bars.
    // Bar-long block triads, so the chords name exactly what the notes sound
    // and the two paths are weighing the same distribution.
    const notes = [
      ...bar(0, 60, [64, 67]), // C  C E G
      ...bar(4, 53, [57, 60]), // F  F A C
      ...bar(8, 55, [59, 62, 65]), // G7 G B D F
      ...bar(12, 60, [64, 67]), // C  C E G
    ];
    const { timeline } = chordTimelineFromNotes(notes, { key: majorKey(0) });
    const fromChords = detectModulations(timeline.segments);
    const fromNotes = keyTimelineFromNotes(notes);
    expect(fromChords).toHaveLength(1);
    expect(fromNotes).toHaveLength(1);
    expect(fromChords[0]?.confidence).toBeCloseTo(fromNotes[0]?.confidence ?? 0, 6);
    // A real correlation, not the ceiling the chord-membership average sat on.
    expect(fromChords[0]?.confidence).toBeLessThan(1);
    expect(fromChords[0]?.confidence).toBeGreaterThan(0.8);
  });

  it('scores a diatonic phrase below a ceiling on the chord path', () => {
    // Eight bars that never leave C major. Every chord belongs to the key, so
    // the old average was 1 for all of them; a correlation still reports how
    // much of the key's profile the music actually traced.
    const regions = detectModulations(ALL_C_CHORDS);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.confidence).toBeLessThan(1);
    expect(regions[0]?.confidence).toBeGreaterThan(0);
  });

  it('measures the confidence against the profile that was named', () => {
    // The profile is what the correlation is taken against, so naming another
    // one moves the number even though it cannot move a region.
    const krumhansl = detectModulations(C_TO_G_CHORDS, { profile: 'krumhansl' });
    const temperley = detectModulations(C_TO_G_CHORDS, { profile: 'temperley' });
    expect(temperley.map((region) => region.confidence)).not.toEqual(
      krumhansl.map((region) => region.confidence),
    );
  });
});

describe('a rest is not a modulation', () => {
  /** C major, a bar of silence, C major again; the span runs to beat 28. */
  const GAPPED = [
    ...bar(0, 36, [60, 64, 67]),
    ...bar(4, 36, [60, 64, 67]),
    ...bar(8, 36, [60, 64, 67]),
    ...bar(16, 36, [60, 64, 67]),
    ...bar(20, 36, [60, 64, 67]),
    ...bar(24, 36, [60, 64, 67]),
  ];

  it('holds one region across a rest, and reports the same span as the note path', () => {
    // The chord path takes its slots from the chords, and a rest yields no
    // chord segment, so the two runs of C used to be reported as two regions
    // with the second carrying `modulation: 'same'` — a modulation from a key
    // to itself. A region is the maximal span of one key, so this is one.
    const { timeline } = chordTimelineFromNotes(GAPPED, { key: majorKey(0), totalBeats: 28 });
    expect(timeline.segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [0, 12],
      [16, 28],
    ]);
    const fromChords = detectModulations(timeline.segments, { totalBeats: 28 });
    expect(fromChords).toHaveLength(1);
    expect(keyNames(fromChords)).toEqual(['C major']);
    expectWellFormed(fromChords, { contiguous: true, span: [0, 28] });
    expect(fromChords.filter((region) => region.modulation !== undefined)).toEqual([]);
    expect(shapeOf(fromChords)).toEqual(shapeOf(keyTimelineFromNotes(GAPPED, { totalBeats: 28 })));
  });

  it('never reports a region as a modulation to the key it already was in', () => {
    // `'same'` is the relation a key stands in to itself, and consecutive
    // regions never share a key, so it can never be the reason for a boundary.
    const inputs: KeyRegion[][] = [
      detectModulations(C_TO_G_CHORDS),
      detectModulations(ALL_C_CHORDS),
      detectModulations(TONICIZATION_CHORDS),
      keyTimelineFromNotes([...cPhrase(0), ...gPhrase(16)]),
      keyTimelineFromNotes([...cPhrase(0), ...aMinorPhrase(16)]),
    ];
    for (const regions of inputs) {
      expect(regions.map((region) => region.modulation)).not.toContain('same');
      // Two consecutive regions in one key would be the same thing said twice.
      regions.forEach((region, i) => {
        const previous = regions[i - 1];
        if (previous !== undefined) {
          expect(keyName(region.key)).not.toBe(keyName(previous.key));
        }
      });
    }
  });
});

describe('the note path reads each note once per slot it sounds in', () => {
  /** A piece of `bars` bars: a block triad plus four eighths over it. */
  function piece(bars: number): NoteEvent[] {
    const notes: NoteEvent[] = [];
    const degrees = [0, 5, 7, 2];
    for (let index = 0; index < bars; index += 1) {
      const root = 48 + (degrees[index % degrees.length] ?? 0);
      for (const pitch of [root, root + 4, root + 7]) {
        notes.push({ pitch, startBeat: index * 4, durationBeat: 4 });
      }
      for (let eighth = 0; eighth < 4; eighth += 1) {
        notes.push({
          pitch: root + 12 + ((index + eighth) % 8),
          startBeat: index * 4 + eighth,
          durationBeat: 1,
        });
      }
    }
    return notes;
  }

  /**
   * How many times the analysis looks at a note, counted rather than timed:
   * the work is what the fix is about, and a clock also measures the machine.
   */
  function readsOf(bars: number): number {
    let reads = 0;
    const notes = piece(bars).map(({ startBeat, ...rest }) =>
      Object.defineProperty({ ...rest } as NoteEvent, 'startBeat', {
        enumerable: true,
        get: () => {
          reads += 1;
          return startBeat;
        },
      }),
    );
    keyTimelineFromNotes(notes, { budget: 1e9 });
    return reads;
  }

  it('grows with the length of the piece rather than with its square', () => {
    // Every slot used to be weighed against the whole note list, so the total
    // work was the note count times the slot count and both grow with the
    // piece. Twice the music may cost twice the reads; it may not cost four
    // times them.
    const small = readsOf(100);
    const large = readsOf(200);
    expect(large).toBeLessThan(small * 3);
  });

  it('reports the same regions it did when every slot rescanned every note', () => {
    // Grouping the notes changes which notes each slot is weighed against from
    // "all of them" to "the ones overlapping it", and a note contributes only
    // where it overlaps, so the histogram is the same one.
    expect(shapeOf(keyTimelineFromNotes([...cPhrase(0), ...gPhrase(16)]))).toEqual([
      { startBeat: 0, endBeat: 16, key: 'C major', modulation: undefined },
      { startBeat: 16, endBeat: 32, key: 'G major', modulation: 'dominant' },
    ]);
  });
});

describe('the timeline entry points take the note arrays the library hands out', () => {
  it('accepts a readonly array without a copy or a cast', () => {
    // `ArrangementTrack.notes` and `TrackEdit.notes` are readonly, and none of
    // these entry points modifies what it is given, so a caller must be able to
    // pass one straight on. This is a compile-time claim as much as a runtime
    // one: the assignment below is what would fail.
    const notes: readonly NoteEvent[] = Object.freeze(cPhrase(0));
    expect(keyTimelineFromNotes(notes)).toHaveLength(1);
    expect(chordTimelineFromNotes(notes).timeline.segments.length).toBeGreaterThan(0);
    expect(analyzeTimeline(notes).result.timeline.segments.length).toBeGreaterThan(0);
  });
});

describe('a region owns the key it reports', () => {
  /** Every field of a region except the key object's identity. */
  function readingOf(regions: readonly KeyRegion[]): unknown[] {
    return regions.map((region) => ({
      startBeat: region.startBeat,
      endBeat: region.endBeat,
      key: keyName(region.key),
      confidence: region.confidence,
      modulation: region.modulation,
      pivot:
        region.pivot === undefined
          ? undefined
          : `${region.pivot.romanFrom}=${region.pivot.romanTo}`,
    }));
  }

  it('gives the note path a key per region that no later call shares', () => {
    // The candidate table is built once for the process and the search's
    // distances are precomputed from it, so a region handed the table's own key
    // would let a caller writing to it rewrite what every later search reports.
    const notes = [...cPhrase(0), ...gPhrase(16)];
    const regions = keyTimelineFromNotes(notes);
    expect(regions).toHaveLength(2);
    expect(regions[0]?.key).not.toBe(regions[1]?.key);
    const reading = readingOf(regions);
    for (const region of regions) {
      region.key.rootPc = 11;
      region.key.modeMask12 = NATURAL_MINOR_MASK;
    }
    // Neither the other regions of the same run nor a second call moved.
    expect(readingOf(keyTimelineFromNotes(notes))).toEqual(reading);
  });

  it('gives the chord path the same', () => {
    const regions = detectModulations(C_TO_G_CHORDS);
    expect(regions).toHaveLength(2);
    expect(regions[0]?.key).not.toBe(regions[1]?.key);
    const reading = readingOf(regions);
    for (const region of regions) {
      region.key.rootPc = 11;
      region.key.modeMask12 = NATURAL_MINOR_MASK;
    }
    expect(readingOf(detectModulations(C_TO_G_CHORDS))).toEqual(reading);
  });

  it('keeps the keys a timeline analysis ran against out of the candidate table', () => {
    const notes = [...cPhrase(0), ...gPhrase(16)];
    const first = analyzeTimeline(notes).result;
    const chords = first.timeline.segments.map((segment) => segment.chord.rootPc);
    for (const region of first.keys) {
      region.key.rootPc = 11;
      region.key.modeMask12 = NATURAL_MINOR_MASK;
    }
    const second = analyzeTimeline(notes).result;
    expect(keyNames(second.keys)).toEqual(['C major', 'G major']);
    expect(second.timeline.segments.map((segment) => segment.chord.rootPc)).toEqual(chords);
  });
});
