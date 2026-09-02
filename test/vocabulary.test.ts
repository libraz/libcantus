import { describe, expect, it } from 'vitest';
import { BASS_LICKS } from '../src/generate/bass/licks-data.js';
import { resolveContext } from '../src/generate/context/index.js';
import {
  BAR_STEPS,
  deform,
  double,
  doubleTime,
  fitsQuery,
  GENRES,
  type GridEvent,
  gridMetricWeight,
  halfTime,
  mergeVocabulary,
  ornamentBy,
  PROVENANCE_BASES,
  pickVocabulary,
  selectVocabulary,
  syncopate,
  thin,
  type Vocabulary,
  vocabularyOfKind,
  withinCeiling,
} from '../src/generate/vocabulary/index.js';
import { assertVocabulary } from '../src/generate/vocabulary/types.js';

type Material = { tag: 'test'; strokes: GridEvent[] };

function entry(id: string, over: Partial<Vocabulary<Material>> = {}): Vocabulary<Material> {
  return {
    id,
    genre: 'funk',
    material: { tag: 'test', strokes: [{ step: 0, velocity: 1 }] },
    articulations: [],
    difficulty: 3,
    provenance: { basis: 'idiom', note: 'a figure with no owner' },
    ...over,
  };
}

const draw = resolveContext(7).part('test');

describe('vocabulary model', () => {
  it('treats an absent condition as no restriction', () => {
    const plain = entry('plain');
    expect(fitsQuery(plain, { section: 'chorus', bpm: 200, quality: 'dim7' })).toBe(true);
  });

  it('filters on every condition an entry states', () => {
    const narrow = entry('narrow', {
      sections: ['chorus'],
      tempoRange: [90, 120],
      ts: { numerator: 4, denominator: 4 },
      fitsOver: ['maj7'],
    });
    expect(fitsQuery(narrow, { section: 'chorus', bpm: 100, quality: 'maj7' })).toBe(true);
    expect(fitsQuery(narrow, { section: 'verse' })).toBe(false);
    expect(fitsQuery(narrow, { bpm: 140 })).toBe(false);
    expect(fitsQuery(narrow, { quality: 'min7' })).toBe(false);
    expect(fitsQuery(narrow, { ts: { numerator: 3, denominator: 4 } })).toBe(false);
    expect(fitsQuery(narrow, { genre: 'gospel' })).toBe(false);
  });

  it('rejects an entry above the difficulty ceiling and never simplifies it', () => {
    const hard = entry('hard', { difficulty: 5 });
    expect(fitsQuery(hard, { difficulty: 3 })).toBe(false);
    expect(selectVocabulary([hard], { difficulty: 3 })).toEqual([]);
    // The entry itself is untouched: rejection is the ceiling's only power.
    expect(hard.difficulty).toBe(5);
  });

  it('keeps dictionary order in the candidate list', () => {
    const dict = [entry('a'), entry('b'), entry('c')];
    expect(selectVocabulary(dict, {}).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('picks deterministically and by position', () => {
    const dict = [entry('a'), entry('b'), entry('c')];
    const first = pickVocabulary(dict, {}, draw, 'bar', 3);
    expect(pickVocabulary(dict, {}, draw, 'bar', 3)?.id).toBe(first?.id);
    // A different position may pick differently, but each position is stable.
    expect(pickVocabulary(dict, {}, draw, 'bar', 4)?.id).toBe(
      pickVocabulary(dict, {}, draw, 'bar', 4)?.id,
    );
  });

  it('answers undefined when nothing fits', () => {
    expect(pickVocabulary([entry('a')], { genre: 'samba' }, draw, 'bar', 0)).toBeUndefined();
  });

  it('names every genre and provenance basis as a frozen list', () => {
    expect(GENRES).toContain('motown');
    expect(PROVENANCE_BASES).toEqual(['idiom', 'construction', 'traditional']);
    expect(Object.isFrozen(GENRES)).toBe(true);
  });

  it('validates a caller entry on the way in', () => {
    expect(() => assertVocabulary(entry('bad', { difficulty: 40 }))).toThrow();
    expect(() => assertVocabulary(entry('bad', { tempoRange: [140, 90] }))).toThrow();
    expect(assertVocabulary(entry('good')).id).toBe('good');
  });

  it('names the tables its string fields have to come from', () => {
    // A dictionary is data, and data arrives from JavaScript callers and config
    // files where a typo is not a compile error. A name no table contains would
    // otherwise match nothing and simply never be chosen.
    const bad = (over: Record<string, unknown>) =>
      assertVocabulary({ ...entry('typo'), ...over } as Vocabulary<Material>);
    expect(() => bad({ genre: 'gamelan' })).toThrow(/genre/);
    expect(() => bad({ provenance: { basis: 'invented', note: 'from nowhere' } })).toThrow(
      /provenance/,
    );
    expect(() => bad({ articulations: ['whammy'] })).toThrow(/articulations\[0\]/);
    expect(() => bad({ sections: ['solo'] })).toThrow(/sections\[0\]/);
    expect(() => bad({ fitsOver: ['maj13sus'] })).toThrow(/fitsOver\[0\]/);
    expect(() => bad({ ts: { numerator: 0, denominator: 4 } })).toThrow(/ts/);
    expect(assertVocabulary(entry('fine', { sections: ['chorus'], fitsOver: ['maj7'] })).id).toBe(
      'fine',
    );
  });

  it('does not offer a figure asking for a technique the instrument lacks', () => {
    // The field is a requirement rather than a label: a kit with no flam is not
    // handed flam material and told to work it out.
    const flammed = entry('flammed', { articulations: ['flam'] });
    const plain = entry('plain');
    expect(fitsQuery(flammed, { articulations: ['ghost', 'accent'] })).toBe(false);
    expect(fitsQuery(flammed, { articulations: ['ghost', 'flam'] })).toBe(true);
    expect(fitsQuery(plain, { articulations: [] })).toBe(true);
    // Absent asks nothing, which is the programmed case.
    expect(fitsQuery(flammed, {})).toBe(true);
    expect(
      selectVocabulary([flammed, plain], { articulations: ['ghost'] }).map((e) => e.id),
    ).toEqual(['plain']);
  });
});

describe('caller dictionaries', () => {
  it('appends caller entries after the built-ins', () => {
    const merged = mergeVocabulary([entry('a'), entry('b')], [entry('z')]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'z']);
  });

  it('replaces a built-in when the caller reuses its id', () => {
    const merged = mergeVocabulary([entry('a'), entry('b')], [entry('a', { difficulty: 1 })]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
    expect(merged[0]?.difficulty).toBe(1);
  });

  it('leaves the built-ins alone when the caller brings nothing', () => {
    const builtIn = [entry('a')];
    expect(mergeVocabulary(builtIn, undefined)).toEqual(builtIn);
    expect(mergeVocabulary(builtIn, [])).toEqual(builtIn);
  });

  it('hides material another part would misread', () => {
    const mixed: Vocabulary<unknown>[] = [
      entry('mine'),
      { ...entry('theirs'), material: { other: 1 } },
    ];
    const isMine = (m: unknown): m is Material => (m as Material)?.tag === 'test';
    expect(vocabularyOfKind(mixed, isMine).map((e) => e.id)).toEqual(['mine']);
  });
});

describe('the vocabulary surface is reachable', () => {
  it('publishes the grid ranking under a name of its own', async () => {
    // The ranking is documented as part of the thin contract callers are meant
    // to work with, so it has to be gettable — under a name that does not
    // collide with the analysis layer's own metric weight, which answers a
    // different question on a different scale.
    const generate = await import('../src/generate/index.js');
    const root = await import('../src/index.js');
    const core = await import('../src/core/index.js');
    expect(generate.gridMetricWeight).toBe(gridMetricWeight);
    expect(root.gridMetricWeight).toBe(gridMetricWeight);
    expect(root.metricWeight).toBe(core.metricWeight);
    expect(root.gridMetricWeight).not.toBe(root.metricWeight);
  });
});

describe('transformation rules', () => {
  const figure: GridEvent[] = [
    { step: 0, velocity: 1 },
    { step: 3, velocity: 0.5 },
    { step: 4, velocity: 0.9 },
    { step: 8, velocity: 0.9 },
    { step: 12, velocity: 0.9 },
  ];

  it('ranks positions by how much of the metre they carry', () => {
    expect(gridMetricWeight(0, '4/4')).toBe(4);
    expect(gridMetricWeight(8, '4/4')).toBe(3);
    expect(gridMetricWeight(4, '4/4')).toBe(2);
    expect(gridMetricWeight(2, '4/4')).toBe(1);
    expect(gridMetricWeight(3, '4/4')).toBe(0);
  });

  it('thins from the weakest position upward, and monotonically', () => {
    expect(thin(figure, 0, '4/4')).toHaveLength(figure.length);
    const light = thin(figure, 0.3, '4/4').map((e) => e.step);
    const lighter = thin(figure, 0.6, '4/4').map((e) => e.step);
    expect(light).not.toContain(3);
    // Thinning further can only take more away, never bring anything back.
    expect(lighter.every((step) => light.includes(step))).toBe(true);
    expect(thin(figure, 1, '4/4').map((e) => e.step)).toEqual([0]);
  });

  it('doubles into the gaps without moving what was there', () => {
    const doubled = double(
      [
        { step: 0, velocity: 1 },
        { step: 8, velocity: 1 },
      ],
      BAR_STEPS,
    );
    expect(doubled.map((e) => e.step)).toEqual([0, 4, 8, 12]);
    expect(doubled[1]?.velocity).toBeLessThan(1);
  });

  it('halves and doubles the rate, keeping the bar full', () => {
    const stretched = halfTime(
      [
        { step: 0, velocity: 1 },
        { step: 4, velocity: 1 },
      ],
      BAR_STEPS,
    );
    expect(stretched.map((e) => e.step)).toEqual([0, 8]);
    const compressed = doubleTime(
      [
        { step: 0, velocity: 1 },
        { step: 8, velocity: 1 },
      ],
      BAR_STEPS,
    );
    expect(compressed.map((e) => e.step)).toEqual([0, 4, 8, 12]);
  });

  it('drops what half-time pushes past the bar', () => {
    expect(halfTime([{ step: 12, velocity: 1 }], BAR_STEPS)).toEqual([]);
  });

  it('keeps every onset when doubling the rate, odd steps included', () => {
    // The figure that names the funk genre has its kick on step 3 and its
    // ghosts on 7, 9 and 15 — all odd. Halving those onto no grid position and
    // dropping them returned a de-syncopated figure as though it were the same
    // one played faster.
    const odd: GridEvent[] = [
      { step: 0, velocity: 1 },
      { step: 3, velocity: 0.8 },
      { step: 7, velocity: 0.4 },
      { step: 9, velocity: 0.4 },
      { step: 15, velocity: 0.4 },
    ];
    const compressed = doubleTime(odd, BAR_STEPS);
    expect(compressed.length).toBeGreaterThanOrEqual(odd.length);
    // Each onset lands on the grid position nearest its halved place, and every
    // position the figure asks for is on the grid.
    for (const event of odd) {
      expect(compressed.map((e) => e.step)).toContain(Math.round(event.step / 2));
    }
    for (const event of compressed) {
      expect(Number.isInteger(event.step)).toBe(true);
    }
  });

  it('merges the onsets a doubled rate brings onto one step of one voice', () => {
    // Halving a run of sixteenths puts two of them on the same step. One drum
    // sounds once there, so the pair is one stroke and the louder of the two is
    // what it is; two entries would be a note-on a reader answers with no
    // note-off.
    const run: GridEvent[] = [
      { step: 0, velocity: 0.5, voice: 'closedHiHat' },
      { step: 1, velocity: 0.9, voice: 'closedHiHat' },
      { step: 2, velocity: 0.55, voice: 'closedHiHat' },
      { step: 3, velocity: 0.55, voice: 'closedHiHat' },
      // Another voice on the same steps is another hand: it stays.
      { step: 0, velocity: 1, voice: 'kick' },
      { step: 1, velocity: 1, voice: 'kick' },
    ];
    const compressed = doubleTime(run, BAR_STEPS);
    const seen = new Set<string>();
    for (const event of compressed) {
      const key = `${event.voice}@${event.step}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    const merged = compressed.find((e) => e.voice === 'closedHiHat' && e.step === 1);
    expect(merged?.velocity).toBe(0.9);
    expect(
      compressed
        .filter((e) => e.step === 0)
        .map((e) => e.voice)
        .sort(),
    ).toEqual(['closedHiHat', 'kick']);
  });

  it('lets another voice sit where this one wants to anticipate', () => {
    // Two hands are two players: a ghost snare on the step a hi-hat wants to
    // anticipate into is not an obstacle, and blocking on it left the upper
    // half of the dial doing nothing at all for several built-in genres.
    const shared: GridEvent[] = [
      { step: 3, velocity: 0.3, voice: 'snare' },
      { step: 4, velocity: 1, voice: 'closedHiHat' },
    ];
    const pushed = syncopate(shared, 1, draw, 'bar', 0);
    expect(pushed.some((e) => e.voice === 'closedHiHat' && e.step === 3)).toBe(true);
    // The same voice still blocks itself: that would be one hand twice over.
    const sameVoice: GridEvent[] = [
      { step: 3, velocity: 0.3, voice: 'closedHiHat' },
      { step: 4, velocity: 1, voice: 'closedHiHat' },
    ];
    expect(syncopate(sameVoice, 1, draw, 'bar', 0)).toHaveLength(sameVoice.length);
  });

  it('measures the ceiling within a stream rather than across the kit', () => {
    // A kick and a hi-hat a sixteenth apart are two limbs, not one hand playing
    // at sixteenth speed.
    const twoVoices: GridEvent[] = [
      { step: 0, velocity: 1, voice: 'kick' },
      { step: 1, velocity: 1, voice: 'closedHiHat' },
      { step: 4, velocity: 1, voice: 'kick' },
      { step: 5, velocity: 1, voice: 'closedHiHat' },
    ];
    // A quarter apart within each voice, a sixteenth apart across them.
    expect(withinCeiling(twoVoices, 160, 1)).toBe(true);
    const oneLimb: GridEvent[] = twoVoices.map((event) => ({ ...event, limb: 'rightHand' }));
    expect(withinCeiling(oneLimb, 160, 1)).toBe(false);
  });

  it('anticipates beats when syncopating, and never the downbeat', () => {
    const heavy = syncopate(figure, 1, draw, 'bar', 0);
    expect(heavy.some((e) => e.step === 0)).toBe(true);
    expect(heavy.map((e) => e.step)).toEqual([...heavy.map((e) => e.step)].sort((a, b) => a - b));
    // Every added note sits one step before a beat the figure already had.
    for (const event of heavy) {
      expect(figure.some((f) => f.step === event.step || f.step === event.step + 1)).toBe(true);
    }
    // The dial adds: the notes that were sounding are all still sounding, and
    // the anticipation is softer than the note it leans into.
    const steps = heavy.map((e) => e.step);
    for (const written of figure) {
      expect(steps).toContain(written.step);
    }
    const anticipation = heavy.find((e) => !figure.some((f) => f.step === e.step));
    expect(anticipation).toBeDefined();
    expect(anticipation?.velocity).toBeLessThan(
      figure.find((f) => f.step === (anticipation?.step ?? 0) + 1)?.velocity ?? 0,
    );
  });

  it('syncopates the same way for the same position', () => {
    expect(syncopate(figure, 0.7, draw, 'bar', 2)).toEqual(syncopate(figure, 0.7, draw, 'bar', 2));
  });

  it('keeps more ornament as the dial rises, and never moves the rest', () => {
    const withGhosts = [
      { step: 0, velocity: 1 },
      { step: 2, velocity: 0.3 },
      { step: 6, velocity: 0.3 },
      { step: 10, velocity: 0.3 },
      { step: 14, velocity: 0.3 },
    ];
    const isOrnament = (e: GridEvent) => e.velocity < 0.5;
    const quiet = ornamentBy(withGhosts, isOrnament, 0.2, draw, 'bar', 0).map((e) => e.step);
    const busy = ornamentBy(withGhosts, isOrnament, 0.9, draw, 'bar', 0).map((e) => e.step);
    expect(quiet.every((step) => busy.includes(step))).toBe(true);
    expect(quiet).toContain(0);
    expect(busy.length).toBeGreaterThanOrEqual(quiet.length);
  });

  it('leaves a figure as written at the neutral rhythmic setting', () => {
    expect(deform(figure, { rhythmic: 0.5 }, draw, 'bar', 0)).toEqual(
      [...figure].sort((a, b) => a.step - b.step),
    );
  });

  it('thins below the middle and syncopates above it', () => {
    expect(deform(figure, { rhythmic: 0 }, draw, 'bar', 0).map((e) => e.step)).toEqual([0]);
    const busy = deform(figure, { rhythmic: 1 }, draw, 'bar', 0);
    // Syncopating adds the anticipations to the figure rather than moving it,
    // so the top of the dial is the written figure and more.
    expect(busy.length).toBeGreaterThan(figure.length);
    for (const written of figure) {
      expect(busy.map((e) => e.step)).toContain(written.step);
    }
  });

  it('rejects a figure faster than the ceiling sustains, at that tempo', () => {
    const sixteenths = [
      { step: 0, velocity: 1 },
      { step: 1, velocity: 1 },
      { step: 2, velocity: 1 },
    ];
    expect(withinCeiling(sixteenths, 160, 1)).toBe(false);
    expect(withinCeiling(sixteenths, 160, 5)).toBe(true);
    // A limit nobody stated constrains nothing.
    expect(withinCeiling(sixteenths, undefined, 1)).toBe(true);
    expect(withinCeiling(sixteenths, 160, undefined)).toBe(true);
  });
});

describe('the built-in lick dictionary is one object for the whole process', () => {
  it('holds every entry and every note frozen', () => {
    for (const lick of BASS_LICKS) {
      expect(Object.isFrozen(lick), lick.id).toBe(true);
      expect(Object.isFrozen(lick.material), lick.id).toBe(true);
      expect(Object.isFrozen(lick.material.notes), lick.id).toBe(true);
      for (const note of lick.material.notes) {
        expect(Object.isFrozen(note), `${lick.id} step ${note.step}`).toBe(true);
      }
    }
  });

  it('refuses a caller edit to an entry rather than keeping it for the process', () => {
    const first = BASS_LICKS[0];
    if (!first) {
      throw new Error('the dictionary is empty');
    }
    const id = first.id;
    expect(() => {
      (first as { id: string }).id = 'hijacked';
    }).toThrow(TypeError);
    expect(() => {
      first.material.notes.push({ degree: 1, step: 1, velocity: 1 });
    }).toThrow(TypeError);
    expect(BASS_LICKS[0]?.id).toBe(id);
  });
});
