import { describe, expect, it } from 'vitest';
import { phrasesFromTimeline } from '../src/analyze/form/index.js';
import { detectCadence } from '../src/analyze/functional/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** Quarter notes from `at`, one per pitch. */
function quarters(pitches: number[], at: number): NoteEvent[] {
  return pitches.map((pitch, index) => ({
    pitch,
    startBeat: at + index,
    durationBeat: 1,
  }));
}

/**
 * Two four-bar phrases, each closing on the tonic: the shape a period has, and
 * the one a single cadence at the end under-reads. The first phrase reaches its
 * tonic over a rising line, so nothing but the phrasing asks for an arrival
 * there.
 */
const melody: NoteEvent[] = [
  ...quarters([60, 62, 64, 65], 0),
  ...quarters([67, 69, 67, 65], 4),
  ...quarters([64, 65, 67, 69], 8),
  ...quarters([65, 69, 72, 72], 12),
  ...quarters([72, 71, 69, 67], 16),
  ...quarters([65, 64, 62, 60], 20),
  ...quarters([62, 64, 65, 67], 24),
  ...quarters([71, 74, 72, 72], 28),
];

/** The chords sounding either side of `beat`, in the harmonized result. */
function around(chords: { rootPc: number; quality: string; startBeat: number }[], beat: number) {
  const arrival = chords.filter((chord) => chord.startBeat < beat).at(-1);
  const approach = chords.filter((chord) => chord.startBeat < (arrival?.startBeat ?? 0)).at(-1);
  return { approach, arrival };
}

describe('harmonizing a line with more than one phrase in it', () => {
  it('cadences at each phrase end the caller names', () => {
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      ts: { numerator: 4, denominator: 4 },
      phraseEnds: [16],
    });
    const { approach, arrival } = around(result.chords, 16);
    expect(approach).toBeDefined();
    // The phrase closes on the tonic, and the chord before it is one that
    // cadences onto the tonic rather than a chord the line merely passed
    // through.
    expect(arrival?.rootPc).toBe(0);
    const cadence = detectCadence(
      makeChord(approach?.rootPc ?? 0, 'maj'),
      makeChord(arrival?.rootPc ?? 0, 'maj'),
      cMajor,
    );
    expect(cadence.type).not.toBeNull();
    // The line still closes where it ends, whatever it did in the middle.
    expect(around(result.chords, 32).arrival?.rootPc).toBe(0);
  });

  it('is the phrasing that puts the arrival there', () => {
    // The same melody without the phrase ends holds one harmony across the
    // close: nothing in the notes alone asks for an arrival mid-line.
    const opts = { melody, key: cMajor, ts: { numerator: 4, denominator: 4 } };
    const plain = around(harmonizeMelody(opts).chords, 16);
    const phrased = around(harmonizeMelody({ ...opts, phraseEnds: [16] }).chords, 16);
    expect(phrased.arrival?.startBeat).not.toBe(plain.arrival?.startBeat);
  });

  it('takes the phrase ends the analysis reports, as the documentation says', () => {
    // The documented workflow: label the line, let the form layer find its
    // phrases, and hand their ends straight to the harmonizer.
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 7, quality: 'maj', startBeat: 8 },
        { rootPc: 0, quality: 'maj', startBeat: 12 },
        { rootPc: 5, quality: 'maj', startBeat: 16 },
        { rootPc: 7, quality: 'maj', startBeat: 24 },
        { rootPc: 0, quality: 'maj', startBeat: 28 },
      ],
      32,
    );
    const phrases = phrasesFromTimeline(timeline, melody, { key: cMajor });
    const phraseEnds = phrases.map((phrase) => phrase.endBeat);
    expect(phraseEnds.length).toBeGreaterThan(1);
    const result = harmonizeMelody({ melody, key: cMajor, phraseEnds });
    // Every named end is covered by a chord, and the last one closes the line.
    for (const end of phraseEnds) {
      expect(around(result.chords, end).arrival).toBeDefined();
    }
    expect(around(result.chords, phraseEnds.at(-1) ?? 32).arrival?.rootPc).toBe(0);
  });

  it('leaves a call that names no phrase ends exactly as it was', () => {
    const opts = { melody, key: cMajor, ts: { numerator: 4, denominator: 4 } };
    expect(harmonizeMelody({ ...opts, phraseEnds: [] })).toEqual(harmonizeMelody(opts));
  });

  it('rejects a phrase end that is not a number', () => {
    expect(() => harmonizeMelody({ melody, key: cMajor, phraseEnds: [Number.NaN] })).toThrowError();
  });
});

/** Scale steps of the major and natural minor scales, as semitones above the tonic. */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 11];

/** One quarter note per scale degree, from `at`, in the scale a key is built on. */
function degrees(steps: number[], tonic: number, at: number, path: number[]): NoteEvent[] {
  return path.map((degree, index) => ({
    pitch: 60 + tonic + 12 * Math.floor(degree / 7) + (steps[degree % 7] ?? 0),
    startBeat: at + index,
    durationBeat: 1,
  }));
}

/**
 * Eight antecedent/consequent pairs, in scale degrees, each antecedent coming to
 * rest on the tonic and each reaching it by a different approach: from below,
 * from above, by step, by leap, and over a line that never leaves the tonic
 * triad. What the harmonization of the close may rest on therefore differs from
 * shape to shape, which is what makes the sweep more than one melody tried
 * twelve times.
 */
const PERIODS: [number[], number[]][] = [
  [
    [0, 1, 2, 3, 4, 3, 2, 0],
    [2, 3, 4, 5, 6, 4, 1, 0],
  ],
  [
    [4, 3, 2, 1, 2, 3, 1, 0],
    [4, 5, 6, 7, 6, 4, 1, 0],
  ],
  [
    [0, 2, 4, 2, 3, 2, 1, 0],
    [1, 2, 3, 4, 5, 3, 1, 0],
  ],
  [
    [7, 6, 5, 4, 5, 4, 3, 7],
    [4, 3, 2, 3, 4, 2, 1, 0],
  ],
  [
    [0, 0, 2, 2, 4, 4, 2, 0],
    [4, 3, 5, 4, 2, 3, 1, 0],
  ],
  [
    [2, 1, 0, 1, 2, 4, 3, 0],
    [3, 4, 5, 4, 3, 2, 1, 0],
  ],
  [
    [0, 4, 3, 2, 1, 2, 3, 0],
    [5, 4, 3, 2, 4, 3, 1, 0],
  ],
  [
    [4, 4, 5, 4, 3, 2, 1, 0],
    [2, 3, 4, 5, 4, 2, 1, 0],
  ],
];

/** Every key of the sweep, as a tonic pitch class and the scale it is built on. */
const KEYS = Array.from({ length: 12 }, (_, tonic) => tonic).flatMap((tonic) => [
  { tonic, steps: MAJOR_STEPS, key: majorKey(tonic), name: `major ${tonic}` },
  { tonic, steps: MINOR_STEPS, key: minorKey(tonic), name: `minor ${tonic}` },
]);

describe('the close a named phrase end asks for', () => {
  // In 4/4 the default harmonic rhythm is half a bar, so the slot that closes a
  // phrase ending on beat 8 is the one running from beat 6 to it.
  const CLOSE_SLOT = 6;
  const PHRASE_END = 8;

  it.each(KEYS)(
    'puts a chord of its own under every phrase close, in $name',
    ({ tonic, steps, key }) => {
      for (const [antecedent, consequent] of PERIODS) {
        const period = [
          ...degrees(steps, tonic, 0, antecedent),
          ...degrees(steps, tonic, PHRASE_END, consequent),
        ];
        const result = harmonizeMelody({ melody: period, key, phraseEnds: [PHRASE_END] });
        const close = result.chords.find((chord) => chord.startBeat === CLOSE_SLOT);
        // The harmony moves into the close: a chord span begins where the
        // closing slot does, rather than the slot inheriting what was sounding.
        expect(close, `${antecedent.join('')} in ${key.rootPc}`).toBeDefined();
        // Every antecedent here comes to rest on the tonic, so the chord that
        // closes it is the tonic — whatever the approach could otherwise argue
        // for, and whatever the next phrase opens on.
        expect(close?.rootPc).toBe(tonic);
      }
    },
  );

  it('is the naming that puts it there, not the notes', () => {
    let moved = 0;
    let total = 0;
    for (const { tonic, steps, key } of KEYS) {
      for (const [antecedent, consequent] of PERIODS) {
        const period = [
          ...degrees(steps, tonic, 0, antecedent),
          ...degrees(steps, tonic, PHRASE_END, consequent),
        ];
        total += 1;
        if (
          !harmonizeMelody({ melody: period, key }).chords.some((c) => c.startBeat === CLOSE_SLOT)
        )
          moved += 1;
      }
    }
    // Left unnamed, a large part of the sweep runs through the close on the
    // chord already sounding; naming it is what makes every one of them close
    // there.
    expect(moved).toBeGreaterThan(total / 4);
  });

  it('reads the note a phrase rests on as structural, not as the next phrase ornament', () => {
    // The tonic here sits between two supertonics, which is a lower neighbour to
    // a classifier that cannot see the phrase boundary. Dropped from the closing
    // slot, the close is harmonized by the note before it instead.
    const period = [
      ...degrees(MAJOR_STEPS, 0, 0, [0, 2, 4, 2, 3, 2, 1, 0]),
      ...degrees(MAJOR_STEPS, 0, PHRASE_END, [1, 2, 3, 4, 5, 3, 1, 0]),
    ];
    const close = harmonizeMelody({ melody: period, key: cMajor, phraseEnds: [PHRASE_END] }).chords;
    expect(close.find((chord) => chord.startBeat === CLOSE_SLOT)?.rootPc).toBe(0);
  });

  it('divides the chord grid where a phrase ends off it', () => {
    // A phrase ending on beat 6 under a four-beat harmonic rhythm falls inside
    // the slot running from 4 to 8. The named end cuts that slot, so the two
    // beats the next phrase opens with are scored on their own instead of
    // pulling the chord that has to close the phrase before them — and a chord
    // can begin on beat 6, which on the undivided grid there is no boundary for.
    const line = [
      ...quarters([60, 64, 67, 64], 0),
      ...quarters([60, 64], 4),
      ...quarters([62, 65], 6),
      ...quarters([65, 69, 65, 62], 8),
    ];
    const opts = {
      melody: line,
      key: cMajor,
      ts: { numerator: 4, denominator: 4 },
      harmonicRhythm: 4,
    };
    const cut = harmonizeMelody({ ...opts, phraseEnds: [6] });
    const whole = harmonizeMelody({ ...opts, phraseEnds: [8] });
    expect(cut.chords.some((chord) => chord.startBeat === 6)).toBe(true);
    expect(whole.chords.some((chord) => chord.startBeat === 6)).toBe(false);
  });
});

describe('a phrase end outside the melody names no close inside it', () => {
  const period: NoteEvent[] = [
    ...quarters([60, 62, 64, 65], 0),
    ...quarters([67, 65, 64, 60], 4),
    ...quarters([64, 65, 67, 69], 8),
    ...quarters([71, 67, 62, 60], 12),
  ];
  const opts = { melody: period, key: cMajor, ts: { numerator: 4, denominator: 4 } } as const;

  /**
   * Lines whose harmony holds through their close, so a close forced on the
   * last slot would be visible: an arpeggiated bar the tonic chord explains
   * whole, and a period settling onto the tonic through its last two slots.
   */
  const LINES: { melody: NoteEvent[]; endBeat: number }[] = [
    { melody: quarters([60, 64, 67, 72, 67, 64, 60, 72], 0), endBeat: 8 },
    { melody: period, endBeat: 16 },
  ];

  it('harmonizes a line naming its own end exactly as one naming nothing', () => {
    // A melody closes where it ends whether or not a caller says so, which is
    // what makes passing the ends of every phrase — the last one included, as
    // `phrasesFromTimeline` reports them — the same call as naming the closes
    // inside the line.
    for (const { melody: line, endBeat } of LINES) {
      const plain = harmonizeMelody({ ...opts, melody: line });
      expect(harmonizeMelody({ ...opts, melody: line, phraseEnds: [endBeat] })).toEqual(plain);
    }
  });

  it('reads the ends of every phrase as the closes inside the line', () => {
    const inner = harmonizeMelody({ ...opts, phraseEnds: [8] });
    expect(harmonizeMelody({ ...opts, phraseEnds: [8, 16] })).toEqual(inner);
  });

  it('ignores a beat at or before the grid the melody starts on', () => {
    for (const { melody: line } of LINES) {
      const plain = harmonizeMelody({ ...opts, melody: line });
      for (const end of [-8, 0]) {
        expect(harmonizeMelody({ ...opts, melody: line, phraseEnds: [end] })).toEqual(plain);
      }
    }
  });

  it('ignores a beat beyond the melody', () => {
    for (const { melody: line, endBeat } of LINES) {
      const plain = harmonizeMelody({ ...opts, melody: line });
      for (const end of [endBeat, endBeat + 4, 1000]) {
        expect(harmonizeMelody({ ...opts, melody: line, phraseEnds: [end] })).toEqual(plain);
      }
    }
  });

  it('takes the ends of a whole line from the phrases found in it', () => {
    // The documented route: harmonize once, read the phrases back, and hand
    // their ends to a second call. The last phrase ends where the melody does,
    // so the two calls agree wherever the closes inside the line do.
    const first = harmonizeMelody(opts);
    const timeline = chordTimelineFromChords(first.chords, 16);
    const ends = phrasesFromTimeline(timeline, period, { key: cMajor }).map(
      (phrase) => phrase.endBeat,
    );
    const inner = ends.filter((end) => end > 0 && end < 16);
    expect(harmonizeMelody({ ...opts, phraseEnds: ends })).toEqual(
      harmonizeMelody({ ...opts, phraseEnds: inner }),
    );
  });
});
