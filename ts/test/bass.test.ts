import { describe, expect, it } from 'vitest';
import {
  BASS_4_STRING,
  BASS_5_STRING,
  foldIntoRange,
  type StringedProfile,
} from '../src/core/instrument/index.js';
import {
  beatsPerBar,
  isStrongBeat,
  pulseBeats,
  type TimeSignature,
} from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import {
  type BassLineOptions,
  type BassSegment,
  type BassStyle,
  generateBassLine,
} from '../src/generate/bass/index.js';
import { bandFloor, placeRoot } from '../src/generate/bass/internal.js';
import { sustainsShift } from '../src/generate/context/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** A four-bar I-IV-V-I placement in C major, one bar (4 beats) per chord. */
function progression(): BassSegment[] {
  return [
    { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
    { startBeat: 4, endBeat: 8, chord: makeChord(5, 'maj') },
    { startBeat: 8, endBeat: 12, chord: makeChord(7, 'maj') },
    { startBeat: 12, endBeat: 16, chord: makeChord(0, 'maj') },
  ];
}

const ALL_STYLES: BassStyle[] = ['root', 'rootFifth', 'pop', 'walking', 'arpeggio'];

/** Circular distance between two pitch classes, in [0, 6]. */
function pcDistance(a: number, b: number): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/** The segment covering a note's onset, if any. */
function segmentAt(segments: BassSegment[], startBeat: number): BassSegment | undefined {
  return segments.find((s) => startBeat >= s.startBeat - 1e-9 && startBeat < s.endBeat - 1e-9);
}

describe('generateBassLine', () => {
  it('rejects overlapping chord segments instead of silently dropping one', () => {
    expect(() =>
      generateBassLine({
        segments: [
          { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
          { startBeat: 0, endBeat: 4, chord: makeChord(7, 'maj') },
        ],
        key: cMajor,
      }),
    ).toThrow(/must not overlap/);
  });

  it('holds its register over a vamp instead of climbing out of it', () => {
    // Sixteen turns of I-V. The register the caller asked for is the one the
    // whole line is written in, so a chord that comes back sounds where it
    // sounded before rather than an octave higher every time the line turns
    // around.
    const segments: BassSegment[] = [];
    for (let bar = 0; bar < 16; bar += 1) {
      segments.push({
        startBeat: bar * 4,
        endBeat: bar * 4 + 4,
        chord: makeChord(bar % 2 === 0 ? 0 : 7, 'maj'),
      });
    }
    const notes = generateBassLine({ segments, key: cMajor, style: 'root', octave: 2 });
    expect(notes.map((note) => note.pitch)).toEqual(
      segments.map((segment) => (segment.chord.rootPc === 0 ? 36 : 43)),
    );
    for (let i = 1; i < notes.length; i += 1) {
      expect(Math.abs((notes[i]?.pitch ?? 0) - (notes[i - 1]?.pitch ?? 0))).toBeLessThanOrEqual(7);
    }
  });

  it('sounds the same chord degree on the same pitch every time the chord returns', () => {
    // Four bars of I-V in every style: the second turn of the vamp is the same
    // notes as the first, so the line keeps the band it was written for.
    const segments: BassSegment[] = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
      { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
      { startBeat: 8, endBeat: 12, chord: makeChord(0, 'maj') },
      { startBeat: 12, endBeat: 16, chord: makeChord(7, 'maj') },
    ];
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({ segments, key: cMajor, style, octave: 2, ctx: { seed: 8 } });
      // Which weak beats take a pop pickup is drawn per position and so differs
      // from bar to bar by design; what a given chord tone sounds as does not.
      const heard = new Map<string, Set<number>>();
      for (const note of notes) {
        const segment = segmentAt(segments, note.startBeat);
        const pc = ((note.pitch % 12) + 12) % 12;
        const key = `${segment?.chord.rootPc ?? -1}:${pc}`;
        const pitches = heard.get(key) ?? new Set<number>();
        // The pop style's octave pickup is documented to drop below the band.
        pitches.add(style === 'pop' ? note.pitch + (note.pitch < 36 ? 12 : 0) : note.pitch);
        heard.set(key, pitches);
      }
      for (const [where, pitches] of heard) {
        expect([...pitches], `${style} ${where}`).toHaveLength(1);
      }
    }
  });

  it('repeats the alternating bass once per bar of a long chord', () => {
    // A modal vamp holds one chord for four bars. Root and fifth is what the
    // style is named for, so it is written against the bar rather than stretched
    // across the whole span as one root and one fifth of eight beats each.
    const segments: BassSegment[] = [{ startBeat: 0, endBeat: 16, chord: makeChord(2, 'min7') }];
    const notes = generateBassLine({ segments, key: cMajor, style: 'rootFifth', octave: 2 });
    expect(notes.map((note) => note.startBeat)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(notes.map((note) => note.pitch)).toEqual([38, 45, 38, 45, 38, 45, 38, 45]);
    expect(notes.every((note) => note.durationBeat === 2)).toBe(true);
  });

  it('places every note in the bass register', () => {
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({
        segments: progression(),
        key: cMajor,
        style,
        ctx: { seed: 3 },
      });
      for (const note of notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(24);
        expect(note.pitch).toBeLessThanOrEqual(55);
      }
    }
  });

  it('sounds only chord tones, except walking approach beats', () => {
    const segments = progression();
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({ segments, key: cMajor, style, ctx: { seed: 7 } });
      for (const note of notes) {
        const seg = segmentAt(segments, note.startBeat);
        expect(seg).toBeDefined();
        if (!seg) {
          continue;
        }
        const pc = ((note.pitch % 12) + 12) % 12;
        const lastStart = segments[segments.length - 1]?.startBeat ?? Number.NEGATIVE_INFINITY;
        const hasNext = note.startBeat < lastStart;
        const isApproach =
          style === 'walking' && hasNext && Math.abs(note.startBeat - (seg.endBeat - 1)) < 1e-6;
        if (isApproach) {
          // A walking approach note leads by step into the next chord, so it
          // sits within two semitones of that chord's bass (diatonic or
          // chromatic neighbor) rather than merely being some scale tone.
          const nextSeg = segments.find((s) => s.startBeat >= seg.endBeat - 1e-9);
          const nextRoot = (((nextSeg?.chord.bassPc ?? nextSeg?.chord.rootPc ?? 0) % 12) + 12) % 12;
          expect(pcDistance(nextRoot, pc)).toBeLessThanOrEqual(2);
        } else {
          expect(chordPitchClasses(seg.chord)).toContain(pc);
        }
      }
    }
  });

  it('uses the slash bass pitch class for root style', () => {
    const segments: BassSegment[] = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj', 4) }, // C/E
    ];
    const notes = generateBassLine({ segments, key: cMajor, style: 'root' });
    expect(notes).toHaveLength(1);
    expect((((notes[0]?.pitch ?? Number.NaN) % 12) + 12) % 12).toBe(4);
  });

  it('sounds the slash bass at the segment onset in every style', () => {
    // A slash bass is what sounds under the chord, so every style has to begin
    // the segment on it: C/E in the default register is E2. The arpeggiating
    // styles cycle the chord's own tones from behind that note rather than
    // starting the cycle over on the written root.
    const segments: BassSegment[] = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj', 4) }, // C/E
      { startBeat: 4, endBeat: 8, chord: makeChord(5, 'maj') },
    ];
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({ segments, key: cMajor, style, ctx: { seed: 4 } });
      const onset = notes.find((note) => note.startBeat === 0);
      expect(onset?.pitch, style).toBe(40);
    }
    // The rest of the arpeggio is still the chord's own tones, not a figure
    // transposed onto the bass.
    const arpeggio = generateBassLine({ segments, key: cMajor, style: 'arpeggio' });
    for (const note of arpeggio.filter((n) => n.startBeat < 4)) {
      expect(chordPitchClasses(segments[0]?.chord ?? makeChord(0, 'maj'))).toContain(
        ((note.pitch % 12) + 12) % 12,
      );
    }
  });

  it('yields exactly one note per segment for root style', () => {
    const segments = progression();
    const notes = generateBassLine({ segments, key: cMajor, style: 'root' });
    expect(notes).toHaveLength(segments.length);
  });

  it('yields one note per beat for walking style', () => {
    const segments = progression();
    const notes = generateBassLine({ segments, key: cMajor, style: 'walking' });
    // Four bars of 4/4 = 16 quarter-note beats.
    expect(notes).toHaveLength(16);
  });

  it('leads by step into each chord change in walking style', () => {
    const segments = progression();
    const notes = generateBassLine({ segments, key: cMajor, style: 'walking', ctx: { seed: 5 } });
    const byStart = new Map<number, NoteEvent>();
    for (const note of notes) {
      byStart.set(Math.round(note.startBeat * 2) / 2, note);
    }
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      const next = segments[i + 1];
      if (!seg || !next) {
        continue;
      }
      const approach = byStart.get(seg.endBeat - 1);
      const downbeat = byStart.get(next.startBeat);
      expect(approach).toBeDefined();
      expect(downbeat).toBeDefined();
      if (approach && downbeat) {
        expect(Math.abs(approach.pitch - downbeat.pitch)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('moves on the approach beat for every pair of chord roots', () => {
    // The beat before a chord change is the one beat that has to move. When the
    // next chord's bass already sits a step from the note in hand, the neighbour
    // on the near side is that same note, and the line would stand still on it.
    for (let from = 0; from < 12; from += 1) {
      for (let to = 0; to < 12; to += 1) {
        if (from === to) {
          continue;
        }
        const segments: BassSegment[] = [
          { startBeat: 0, endBeat: 4, chord: makeChord(from, 'dom7') },
          { startBeat: 4, endBeat: 8, chord: makeChord(to, 'maj') },
        ];
        for (let seed = 0; seed < 4; seed += 1) {
          const notes = generateBassLine({
            segments,
            key: cMajor,
            style: 'walking',
            ctx: { seed },
          });
          const where = `${from}->${to} seed ${seed}`;
          const approach = notes.find((note) => note.startBeat === 3);
          const before = notes.find((note) => note.startBeat === 2);
          const downbeat = notes.find((note) => note.startBeat === 4);
          expect(approach, where).toBeDefined();
          expect(approach?.pitch, where).not.toBe(before?.pitch);
          // And it is still a neighbour of what it leads into.
          const approachPc = (((approach?.pitch ?? 0) % 12) + 12) % 12;
          const downbeatPc = (((downbeat?.pitch ?? 0) % 12) + 12) % 12;
          expect(pcDistance(approachPc, downbeatPc), where).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('sorts onsets and never overlaps notes', () => {
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({
        segments: progression(),
        key: cMajor,
        style,
        ctx: { seed: 11 },
      });
      for (let i = 1; i < notes.length; i += 1) {
        const prev = notes[i - 1];
        const cur = notes[i];
        if (!prev || !cur) {
          continue;
        }
        expect(cur.startBeat).toBeGreaterThan(prev.startBeat);
        expect(prev.startBeat + prev.durationBeat).toBeLessThanOrEqual(cur.startBeat + 1e-9);
      }
    }
  });

  it('is deterministic for identical options and seed', () => {
    const opts: BassLineOptions = {
      segments: progression(),
      key: cMajor,
      style: 'pop',
      ctx: { seed: 42 },
    };
    expect(generateBassLine(opts)).toEqual(generateBassLine(opts));
  });

  it('produces different lines for different seeds in stochastic styles', () => {
    const base = { segments: progression(), key: cMajor, style: 'walking' as BassStyle };
    const a = generateBassLine({ ...base, ctx: { seed: 1 } });
    const b = generateBassLine({ ...base, ctx: { seed: 2 } });
    expect(a).not.toEqual(b);
  });

  it('sounds the real altered fifth for dim/aug/m7b5 chords in rootFifth style', () => {
    // rootFifth emits the root on the downbeat and the fifth on the midpoint;
    // dim => 6, aug => 8, m7b5 => 6 semitones above the root.
    const cases: [Parameters<typeof makeChord>[1], number][] = [
      ['dim', 6],
      ['aug', 8],
      ['m7b5', 6],
    ];
    for (const [quality, expectedFifth] of cases) {
      const segments: BassSegment[] = [{ startBeat: 0, endBeat: 4, chord: makeChord(0, quality) }];
      const notes = generateBassLine({ segments, key: cMajor, style: 'rootFifth' });
      expect(notes).toHaveLength(2);
      const rootPc = (((notes[0]?.pitch ?? Number.NaN) % 12) + 12) % 12;
      const fifthPc = (((notes[1]?.pitch ?? Number.NaN) % 12) + 12) % 12;
      expect(rootPc).toBe(0);
      // The fifth is the actual altered fifth, never a repeated root.
      expect(fifthPc).toBe(expectedFifth);
      expect(fifthPc).not.toBe(rootPc);
    }
  });

  it('keeps pop notes in the register band, allowing the octave pickup below it', () => {
    // Default octave 2 => band [36, 48]. Sweep many seeds so weak-beat pickups
    // actually fire. The octave pickup is by definition an octave below where
    // the root would otherwise sit, so it is allowed that far down and no
    // further.
    const octave = 2;
    const low = octave * 12 + 12;
    const high = low + 12;
    for (let seed = 0; seed < 40; seed += 1) {
      const notes = generateBassLine({
        segments: progression(),
        key: cMajor,
        style: 'pop',
        octave,
        ctx: { seed: seed },
      });
      for (const note of notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(low - 12);
        expect(note.pitch).toBeLessThanOrEqual(high);
      }
    }
  });

  it('sounds only chord tones, whatever the root and seed', () => {
    // The octave pickup used to clamp back to the bottom of the band, which is
    // always pitch class 0 — a C sounding under every chord in the progression.
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      const segments: BassSegment[] = [
        { startBeat: 0, endBeat: 4, chord: makeChord(rootPc, 'maj') },
        { startBeat: 4, endBeat: 8, chord: makeChord((rootPc + 7) % 12, 'dom7') },
      ];
      for (let seed = 0; seed < 20; seed += 1) {
        for (const style of ['root', 'rootFifth', 'arpeggio', 'walking', 'pop'] as const) {
          const notes = generateBassLine({
            segments,
            key: cMajor,
            style,
            octave: 2,
            ctx: { seed: seed },
          });
          for (const note of notes) {
            const segment = segments.find(
              (candidate) =>
                note.startBeat >= candidate.startBeat && note.startBeat < candidate.endBeat,
            );
            if (segment === undefined) {
              continue;
            }
            const tones = chordPitchClasses(segment.chord);
            const pc = ((note.pitch % 12) + 12) % 12;
            // Walking lines pass through approach notes by design; every other
            // style sounds chord tones only.
            if (style !== 'walking') {
              expect(tones, `${style} on ${rootPc} seed ${seed}`).toContain(pc);
            }
          }
        }
      }
    }
  });

  it('is deep-equal deterministic across every style for a fixed seed', () => {
    for (const style of ALL_STYLES) {
      const opts: BassLineOptions = {
        segments: progression(),
        key: cMajor,
        style,
        ctx: { seed: 99 },
      };
      expect(generateBassLine(opts)).toEqual(generateBassLine(opts));
    }
  });

  it('returns an empty line for no segments', () => {
    expect(generateBassLine({ segments: [], key: cMajor })).toEqual([]);
  });

  it.each([
    { numerator: 6, denominator: 8 },
    { numerator: 12, denominator: 8 },
    { numerator: 5, denominator: 4 },
  ] as const)('aligns every pulse-driven style to the global meter grid (%o)', (ts) => {
    const meter: TimeSignature = ts;
    const bar = beatsPerBar(meter);
    const pulse = pulseBeats(meter);
    const segments: BassSegment[] = [{ startBeat: 0, endBeat: bar, chord: makeChord(0, 'maj') }];
    for (const style of ['pop', 'walking', 'arpeggio'] as const) {
      const notes = generateBassLine({ segments, key: cMajor, style, ts: meter, ctx: { seed: 1 } });
      for (const note of notes) {
        const positionInPulse = note.startBeat / pulse;
        expect(
          Math.abs(positionInPulse - Math.round(positionInPulse)),
          `${style}@${note.startBeat}`,
        ).toBeLessThan(1e-9);
      }
    }
  });
});

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

const THREE_FOUR: TimeSignature = { numerator: 3, denominator: 4 };

/** The roots of {@link waltz}, in order. */
const WALTZ_ROOTS = [0, 5, 7, 0];

/**
 * The same I-IV-V-I in three, one bar per chord.
 *
 * Three beats to the bar leaves two weak beats after the downbeat, so a pickup
 * can follow a pickup and the note before an octave pickup is not always the
 * root a beat below it. What a leap actually is, is then a range rather than a
 * constant.
 */
function waltz(): BassSegment[] {
  return WALTZ_ROOTS.map((rootPc, bar) => ({
    startBeat: bar * 3,
    endBeat: bar * 3 + 3,
    chord: makeChord(rootPc, 'maj'),
  }));
}

/**
 * Where a chord sounds its bass in a generated line: the band placement, as the
 * instrument leaves it.
 *
 * This is the note a pickup must not be, and it is derived the way the line
 * derives it rather than read back off the output — a segment whose every note
 * is a pickup still has to be measured against the right note.
 */
function soundingRoot(
  rootPc: number,
  octave: number,
  instrument: StringedProfile | undefined,
): number {
  const placed = placeRoot(rootPc, bandFloor(octave * 12 + 12, instrument));
  return instrument ? foldIntoRange(placed, instrument) : placed;
}

/**
 * The octave pickups a `pop` line took, each with the leap it actually is.
 *
 * A weak-beat note sounding the chord's own bass pitch class is the octave
 * pickup; the alternative pickup is the fifth, which is a different pitch class.
 */
function octavePickups(ctx: BassLineOptions['ctx']): { leap: number; beats: number }[] {
  const segments = waltz();
  const notes = generateBassLine({
    segments,
    key: cMajor,
    style: 'pop',
    octave: 2,
    ts: THREE_FOUR,
    ctx,
  });
  const taken: { leap: number; beats: number }[] = [];
  for (let index = 1; index < notes.length; index += 1) {
    const note = notes[index];
    const previous = notes[index - 1];
    if (note === undefined || previous === undefined) {
      continue;
    }
    if (isStrongBeat(note.startBeat, THREE_FOUR)) {
      continue;
    }
    const at = segments.findIndex(
      (segment) => note.startBeat >= segment.startBeat && note.startBeat < segment.endBeat,
    );
    if (((note.pitch % 12) + 12) % 12 !== WALTZ_ROOTS[at]) {
      continue;
    }
    taken.push({
      leap: Math.abs(note.pitch - previous.pitch),
      beats: note.startBeat - previous.startBeat,
    });
  }
  return taken;
}

describe('a chord written over a bass is played as the inversion it is', () => {
  /** Every inversion of a seventh chord, one chord per segment. */
  function inversions(rootPc: number): BassSegment[] {
    return chordPitchClasses(makeChord(rootPc, 'dom7'))
      .filter((pc) => pc !== rootPc % 12)
      .map((bassPc, index) => ({
        startBeat: index * 4,
        endBeat: index * 4 + 4,
        chord: makeChord(rootPc, 'dom7', bassPc),
      }));
  }

  it('sounds no tone of the chord under the bass the chord names', () => {
    // The band is one octave wide, so folding the chord's other tones into it
    // put them under a bass placed anywhere but the bottom of it: the C of a
    // C/E came out below its own E, which is a root-position C. Reading such a
    // line back through this library reported a chord the part was not written
    // on. The walking style's last note of a segment is the approach into the
    // next chord and is left out, as the style's own reading is.
    for (const style of ['root', 'rootFifth', 'arpeggio', 'pop', 'walking'] as BassStyle[]) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const segments = inversions(rootPc);
        const notes = generateBassLine({ segments, key: cMajor, style, ctx: 3 });
        for (const segment of segments) {
          const bass = placeRoot(
            segment.chord.bassPc ?? segment.chord.rootPc,
            bandFloor(36, undefined),
          );
          const inSegment = notes.filter(
            (note) =>
              note.startBeat >= segment.startBeat - 1e-9 && note.startBeat < segment.endBeat - 1e-9,
          );
          const own =
            style === 'walking' ? inSegment.slice(0, Math.max(0, inSegment.length - 1)) : inSegment;
          for (const note of own) {
            // The pop style's pickup is the bass an octave below itself, which
            // is the one note written under the bass on purpose.
            if (style === 'pop' && note.pitch === bass - 12) {
              continue;
            }
            expect(
              note.pitch,
              `${style} ${rootPc}/${segment.chord.bassPc} at ${note.startBeat}`,
            ).toBeGreaterThanOrEqual(bass);
          }
        }
      }
    }
  });
});

describe("the pop style's weak-beat pickup", () => {
  it('is never the note already sounding under it, on any instrument or register', () => {
    // The pickup drops an octave below the band, and the band is one octave
    // wide: on an instrument with nothing under it the drop folds straight back
    // onto the root and the pickup becomes a repeated note. A four-string bass
    // has no C, C#, D or D# below its E — between them most of the keys pop is
    // written in — and `Instrument.bass4()` is the example the class layer's own
    // documentation gives.
    let seen = 0;
    for (const instrument of [undefined, BASS_4_STRING, BASS_5_STRING]) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        for (const octave of [1, 2, 3]) {
          for (let seed = 0; seed < 8; seed += 1) {
            const segments: BassSegment[] = [
              { startBeat: 0, endBeat: 4, chord: makeChord(rootPc, 'maj') },
            ];
            const notes = generateBassLine({
              segments,
              key: cMajor,
              style: 'pop',
              octave,
              instrument,
              ctx: { seed, complexity: { rhythmic: 1 } },
            });
            const root = soundingRoot(rootPc, octave, instrument);
            for (const note of notes) {
              if (isStrongBeat(note.startBeat, FOUR_FOUR)) {
                continue;
              }
              seen += 1;
              expect(
                note.pitch,
                `pc ${rootPc} / octave ${octave} / seed ${seed} @${note.startBeat}`,
              ).not.toBe(root);
            }
          }
        }
      }
    }
    // The sweep has to have produced pickups for the assertion above to mean
    // anything.
    expect(seen).toBeGreaterThan(500);
  });

  it('still drops below the band on an instrument that reaches under it', () => {
    const octave = 2;
    const low = octave * 12 + 12;
    const dropped: number[] = [];
    for (let seed = 0; seed < 20; seed += 1) {
      for (const instrument of [undefined, BASS_5_STRING]) {
        const notes = generateBassLine({
          segments: progression(),
          key: cMajor,
          style: 'pop',
          octave,
          instrument,
          ctx: { seed, complexity: { rhythmic: 1 } },
        });
        dropped.push(...notes.filter((note) => note.pitch < low).map((note) => note.pitch));
      }
    }
    expect(dropped.length).toBeGreaterThan(0);
  });

  it('sounds instead of the fallback root on a segment with no strong beat', () => {
    // The fallback is for a segment that produced no note at all. A segment
    // covering one weak beat produces a pickup, and the pickup is what has to be
    // heard: writing the fallback on top of it put two notes on one onset, and
    // the one silently dropped was the one the line had chosen.
    for (const ts of [
      { numerator: 4, denominator: 4 },
      { numerator: 3, denominator: 4 },
    ] as const) {
      for (let seed = 0; seed < 8; seed += 1) {
        const notes = generateBassLine({
          segments: [{ startBeat: 1, endBeat: 2, chord: makeChord(0, 'maj') }],
          key: cMajor,
          style: 'pop',
          ts,
          octave: 2,
          ctx: { seed, complexity: { rhythmic: 1 } },
        });
        const label = `${ts.numerator}/${ts.denominator} seed ${seed}`;
        expect(notes, label).toHaveLength(1);
        expect(notes[0]?.startBeat, label).toBe(1);
        expect(notes[0]?.pitch, label).not.toBe(soundingRoot(0, 2, undefined));
      }
    }
  });

  it('is judged by the leap it actually is, not by the octave it is named for', () => {
    // The pickup leaves the band, so the note before it sits anywhere from a
    // unison to two octaves away. Charging the difficulty ceiling a flat twelve
    // semitones accepts leaps the hand cannot make and rejects ones it can.
    const bpm = 90;
    const difficulty = 3;
    let judged = 0;
    let under = 0;
    let free = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const density = { rhythmic: 1 };
      const limited = octavePickups({ seed, bpm, complexity: { ...density, difficulty } });
      under += limited.length;
      free += octavePickups({ seed, bpm, complexity: density }).length;
      for (const pickup of limited) {
        judged += 1;
        expect(
          sustainsShift(pickup.leap, pickup.beats, bpm, difficulty),
          `seed ${seed}: ${pickup.leap} semitones in ${pickup.beats} beats`,
        ).toBe(true);
      }
    }
    expect(judged).toBeGreaterThan(0);
    // And the ceiling has to be doing something, or the assertion above holds
    // for a line nobody constrained.
    expect(under).toBeLessThan(free);
  });
});
