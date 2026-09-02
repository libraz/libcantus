import { describe, expect, it } from 'vitest';
import type { ResolvedKey } from '../src/index.js';
import {
  ALGORITHM_VERSION,
  Arrangement,
  analyzeArrangement,
  analyzeChord,
  analyzeVoice,
  availableTensions,
  avoidNotes,
  beatsPerBar,
  beatsToDuration,
  beatsToSeconds,
  beatsToTicks,
  beatsToTiedDurations,
  beatToBarPosition,
  borrowedSource,
  Chord,
  type ChordSegment,
  Composer,
  canSound,
  centsBetweenFreq,
  centsFromNearestStep,
  centsOfSteps,
  centsToRatio,
  checkPartWriting,
  checkSpecies,
  chordFromDegree,
  chordPitchClasses,
  chordScales,
  chordTimelineFromChords,
  chordTimelineFromNotes,
  chordToneRole,
  chordToRoman,
  createNoteEventIndex,
  Duration,
  detectCadence,
  detectCadences,
  detectChord,
  detectChordBest,
  detectKey,
  detectKeyBest,
  detectKeyFromNotes,
  detectModulations,
  developMotif,
  diatonicSeventh,
  diatonicTriad,
  dominantKeyOf,
  durationToBeats,
  durationToSeconds,
  edo,
  enharmonicKeyOf,
  enumerateSafePitches,
  evaluateSafety,
  explainRoman,
  extractMotifs,
  figuredBassOf,
  fingeringsFor,
  foldIntoRange,
  formatBarPosition,
  formatChordSymbol,
  formatKeyName,
  formatNote,
  formatTimeSignature,
  frequencyOf,
  functionOf,
  GUITAR_STANDARD,
  generateBassLine,
  generateCounterMelody,
  generateDrums,
  generateMotif,
  generateProgression,
  generateRhythm,
  harmonizeMelody,
  humanize,
  hypermeter,
  Instrument,
  Interval,
  instrumentRange,
  intervalSemitones,
  isBorrowedChord,
  isChordMember,
  isCompound,
  isConsonantInterval,
  isScaleTone,
  isStrongBeat,
  justDeviationCents,
  Key,
  keyFromFifths,
  keyRelationBetween,
  keySignatureFifths,
  keyTimelineFromNotes,
  Meter,
  Motif,
  makeChord,
  melodicContour,
  melodicSimilarity,
  meterAt,
  metricWeight,
  midiToNote,
  modalInterchangePalette,
  motifFromNotes,
  motifToNoteEvents,
  Note,
  type NoteEvent,
  nearestScaleTone,
  nearestStep,
  negativeHarmonyMirror,
  nextVoicing,
  noteToMidi,
  noteToPitchClass,
  ornament,
  Progression,
  parallelKeyOf,
  parseInterval,
  parseNote,
  phrasesFromTimeline,
  pitchToScaleDegree,
  playability,
  prevailingKeyOf,
  pulseBeats,
  pulsesPerBar,
  Rhythm,
  ratioToCents,
  reduceProgression,
  relatedKeysOf,
  relateMotifs,
  relativeKeyOf,
  resolveContext,
  resolveKey,
  rhythmDensity,
  rhythmToNoteEvents,
  romanToChord,
  Score,
  STEP_BEATS,
  secondaryDominantOf,
  secondsToBeats,
  sectionsFromNotes,
  spanFromChord,
  spellChord,
  spelledInterval,
  spelledKeyOf,
  spellPitch,
  spellScale,
  spellVoicing,
  stepOf,
  stepsOfCents,
  subdominantKeyOf,
  substituteChord,
  syncopate,
  Tempo,
  Timeline,
  Tuning,
  TWELVE_TET,
  tempoAt,
  tensionCurveFrom,
  ticksToBeats,
  toChordData,
  toKeyScale,
  toSpelledInterval,
  toWrittenPitch,
  transformMotif,
  transposeByInterval,
  transposeChord,
  transposeNote,
  tryParseChordSymbol,
  tryParseKeyName,
  tryParseNote,
  tuplet,
  Voicing,
  voiceChord,
  voiceChordStyled,
  voiceIndependence,
  voiceLeadingCost,
  voiceProgression,
  withinCeiling,
} from '../src/index.js';
import { keyIdentity } from '../src/model/key.js';

/**
 * The library publishes one engine twice: as standalone functions, and as the
 * classes of `src/model`. The claim the guides make for that pair is that the
 * two are the same thing — that reaching for a class costs no capability and
 * changes no answer.
 *
 * Every case here holds a class method against the function it delegates to,
 * on the same input: the class result unwrapped to plain data, against what the
 * function returns. Where a method carries options through, the case passes a
 * non-default set, since a method that quietly drops an option answers exactly
 * like the default it fell back to. Where a method generates, the two sides are
 * driven from the same seed, which is the strongest statement the pair admits.
 */

/** A tonic-dominant-tonic phrase, long enough for the form analyses to read. */
const PHRASE: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 2, velocity: 96 },
  { pitch: 64, startBeat: 2, durationBeat: 2, velocity: 80 },
  { pitch: 67, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 71, startBeat: 6, durationBeat: 2, velocity: 72 },
  { pitch: 62, startBeat: 8, durationBeat: 4, velocity: 90 },
  { pitch: 60, startBeat: 12, durationBeat: 4, velocity: 100 },
];

/** Two parts that sound together, for the arrangement cases. */
const PARTS = [
  {
    name: 'lead',
    role: 'melody' as const,
    notes: [
      { pitch: 72, startBeat: 0, durationBeat: 2 },
      { pitch: 76, startBeat: 2, durationBeat: 2 },
      { pitch: 79, startBeat: 4, durationBeat: 4 },
    ],
  },
  {
    name: 'bass',
    role: 'bass' as const,
    notes: [
      { pitch: 36, startBeat: 0, durationBeat: 4 },
      { pitch: 43, startBeat: 4, durationBeat: 4 },
    ],
  },
];

/** Chords over the beats they sound for, as the timeline cases read them. */
const SEGMENTS: ChordSegment[] = [
  { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
  { startBeat: 4, endBeat: 8, chord: makeChord(5, 'maj') },
  { startBeat: 8, endBeat: 12, chord: makeChord(7, 'dom7') },
  { startBeat: 12, endBeat: 16, chord: makeChord(0, 'maj') },
];

/**
 * Note events in the order a score holds them.
 *
 * A score sorts its notes by onset, then pitch, then length, whatever order
 * they arrived in, so a generator's output has to be read in that order before
 * it can be compared with the score built from it.
 */
function inScoreOrder(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort(
    (a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch || a.durationBeat - b.durationBeat,
  );
}

/**
 * The element at `index` of a fixture, reported as a missing fixture rather
 * than read as `undefined`.
 *
 * A comparison written against `fixture[2]` says nothing useful when the
 * fixture is shorter than the test assumes: the class side and the function
 * side both receive `undefined` and can agree on a wrong answer.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  expect(item, `the fixture has no element at ${index}`).toBeDefined();
  return item as T;
}

/** A key as the theory layer spells one: the scale, and the tonic it is written on. */
function spelledOf(key: Key): ResolvedKey {
  return { scale: key.scale, tonic: key.tonic.data, variant: key.variant };
}

/**
 * An arrangement analysis with its chord lookup replaced by the segments behind
 * it, since two readings of the same notes build two closures over one value.
 */
function comparableAnalysis(analysis: ReturnType<typeof analyzeArrangement>): unknown {
  return { ...analysis, timeline: analysis.timeline.segments };
}

describe('Arrangement', () => {
  it('reads the arrangement the way analyzeArrangement reads the same tracks', () => {
    const arrangement = Arrangement.of(PARTS);
    expect(comparableAnalysis(arrangement.analysis)).toEqual(
      comparableAnalysis(analyzeArrangement([...PARTS])),
    );
    expect(arrangement.conflicts).toEqual(analyzeArrangement([...PARTS]).conflicts);
  });

  it('hands back the harmony the analysis found under the tracks', () => {
    const found = analyzeArrangement([...PARTS]);
    expect(Arrangement.of(PARTS).timeline().segments).toEqual(found.timeline.segments);
    expect(Arrangement.of(PARTS).timeline().keys).toEqual(found.keys);
  });

  it('samples the tension curve the function samples, at the step given', () => {
    const arrangement = Arrangement.of(PARTS);
    const found = analyzeArrangement([...PARTS]);
    expect(arrangement.tension({ step: 2 })).toEqual(
      tensionCurveFrom([...PARTS], found, { step: 2 }),
    );
    // The step reaches the function: a coarser sampling is a shorter curve.
    expect(arrangement.tension({ step: 4 }).length).toBeLessThan(
      arrangement.tension({ step: 1 }).length,
    );
  });

  it('reads an edited arrangement as a fresh analysis of the edited tracks', () => {
    const edited = [
      { ...at(PARTS, 0), notes: [{ pitch: 74, startBeat: 0, durationBeat: 8 }] },
      at(PARTS, 1),
    ];
    const updated = Arrangement.of(PARTS).update([
      { trackIndex: 0, notes: [{ pitch: 74, startBeat: 0, durationBeat: 8 }] },
    ]);
    expect(comparableAnalysis(updated.analyze())).toEqual(
      comparableAnalysis(analyzeArrangement(edited)),
    );
  });

  it('reads one track as a score over the notes it was given', () => {
    const arrangement = Arrangement.of(PARTS, { meters: '3/4', key: 'C major' });
    const lead = arrangement.track('lead');
    expect(lead?.notes).toEqual(inScoreOrder(at(PARTS, 0).notes));
    // The score carries the arrangement's own context, so its bars and its key
    // are the ones the arrangement is read under.
    expect(lead?.meterAt(0)).toEqual({ numerator: 3, denominator: 4 });
    expect(lead?.key()?.scale).toEqual(toKeyScale('C major'));
  });
});

describe('Chord', () => {
  const key = Key.major('C');

  it('enumerates the pitch classes the chord functions enumerate', () => {
    const slash = Chord.parse('F/G');
    expect(slash.pitchClasses()).toEqual(chordPitchClasses(slash.data));
    expect(slash.pitchClasses({ includeBass: false })).toEqual(
      chordPitchClasses(slash.data, { includeBass: false }),
    );
    expect(slash.pitchClasses({ includeBass: false })).not.toEqual(slash.pitchClasses());
    expect(slash.contains(65)).toBe(isChordMember(65, slash.data));
    expect(slash.roleOf(69)).toBe(chordToneRole(69, slash.data));
    expect(slash.roleOf(61)).toBe(chordToneRole(61, slash.data));
  });

  it('reads a symbol, a set of pitches and a scale under the options given', () => {
    // The options a method advertises have to reach the function under it: a
    // class that declares them and answers with the function's own defaults
    // reads exactly as one that carries them, so every case here passes a
    // non-default set.
    const german = { system: 'german' as const };
    const parsed = Chord.tryParse('H7', german);
    const symbol = tryParseChordSymbol('H7', german);
    expect(parsed.ok).toBe(true);
    expect(symbol.ok).toBe(true);
    expect(parsed.ok ? parsed.value.data : null).toEqual(symbol.ok ? symbol.value : null);
    expect(Chord.tryParse('H7').ok).toBe(false);
    const pitches = [60, 64, 67, 70];
    const asPcs = { input: 'pitchClass' as const };
    expect(Chord.detectBest(pitches, asPcs)?.data).toEqual(detectChordBest(pitches, asPcs));
    expect(Chord.detectBest([0, 4, 7, 10], asPcs)?.data).toEqual(
      detectChordBest([0, 4, 7, 10], asPcs),
    );
    const dominant = Chord.of('G', 'dom7');
    const resolving = { resolvesTo: Chord.of('C', 'min').data };
    expect(dominant.tensions('phrygianDominant', resolving)).toEqual(
      availableTensions(dominant.data, 'phrygianDominant', resolving),
    );
    const melodic = { use: 'melodic' as const };
    expect(Chord.of('C', 'maj7').avoidNotes('ionian', melodic)).toEqual(
      avoidNotes(Chord.of('C', 'maj7').data, 'ionian', melodic),
    );
    expect(Chord.of('C', 'maj7').avoidNotes('ionian', melodic)).not.toEqual(
      Chord.of('C', 'maj7').avoidNotes('ionian'),
    );
    const applied = { applied: true as const };
    expect(Chord.parse('D7').explain(key, applied)).toEqual(
      explainRoman(Chord.parse('D7').data, key.scale, applied),
    );
  });

  it('answers the functional questions in the key it is read in', () => {
    const chord = Chord.parse('Ab').withKey(key);
    expect(chord.function()).toBe(functionOf(chord.data, key.scale));
    expect(chord.isBorrowed()).toBe(isBorrowedChord(chord.data, key.scale));
    expect(chord.borrowedSource()).toEqual(borrowedSource(chord.data, key.scale));
    expect(chord.figuredBass()).toBe(figuredBassOf(chord.data, key));
    // The rendering option reaches the analysis rather than being defaulted.
    const applied = Chord.parse('D7').withKey(key);
    expect(applied.analyze(key, { applied: true })).toEqual(
      analyzeChord(applied.data, key.scale, { applied: true }),
    );
    expect(applied.analyze(key, { applied: true }).roman).not.toBe(applied.analyze(key).roman);
  });

  it('proposes the substitutions the reharmonizer proposes, melody and all', () => {
    const chord = Chord.parse('G7').withKey(key);
    const opts = { melodyPcs: [11] };
    expect(chord.substitutions()).toEqual(substituteChord(chord.data, key));
    expect(chord.substitutions(key, opts)).toEqual(substituteChord(chord.data, key, opts));
    expect(chord.substitutions(key, opts).length).toBeLessThan(chord.substitutions().length);
    expect(chord.modalInterchange()).toEqual(modalInterchangePalette(key));
  });

  it('voices, spells, and prints itself through the functions that do those', () => {
    const chord = Chord.parse('G7').withKey(key);
    expect(chord.voice()).toEqual(voiceChord(chord.data, { key: key.scale }));
    expect(chord.voice({ voices: 3 })).toEqual(
      voiceChord(chord.data, { voices: 3, key: key.scale }),
    );
    expect(chord.voice({ voices: 3 })).toHaveLength(3);
    expect(chord.styledVoicing({ style: 'drop2' })).toEqual(
      voiceChordStyled(chord.data, { style: 'drop2' }),
    );
    expect(chord.styledVoicing({ style: 'drop2' })).not.toEqual(chord.styledVoicing());
    expect(chord.spell(key).map((note) => note.data)).toEqual(
      spellChord(chord.data, key.tonic.data, key.scale),
    );
    // A root on a black key is where the spelling option is visible at all.
    const sharpSide = Chord.fromData(makeChord(6, 'dom7'));
    expect(sharpSide.symbol({ flats: true })).toBe(
      formatChordSymbol(sharpSide.data, { flats: true }),
    );
    expect(sharpSide.symbol({ flats: true })).toBe('Gb7');
    expect(sharpSide.symbol()).toBe('F#7');
    expect(chord.span(4)).toEqual(spanFromChord(chord.data, 4));
    expect(chord.scales()).toEqual(chordScales(chord.data));
  });

  it('mirrors, tonicizes, and transposes the way the chord functions do', () => {
    const chord = Chord.parse('Dm7');
    expect(chord.negativeHarmony(key).data).toEqual(negativeHarmonyMirror(chord.data, key));
    expect(Chord.parse('Eb').secondaryDominant().data).toEqual(
      Chord.fromData(secondaryDominantOf(Chord.parse('Eb').data)).data,
    );
    // A chord with no spelling of its own moves exactly as the plain data does.
    const bare = Chord.fromData({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7], bassPc: 7 });
    expect(bare.transpose(2).data).toEqual(transposeChord(bare.data, 2));
    expect(bare.transposeBy('A4').data).toEqual(
      transposeChord(bare.data, toSpelledInterval('A4').semitones),
    );
  });

  it('recognizes the chords the detector recognizes, options and all', () => {
    const pitches = [0, 4, 7, 10];
    const opts = { input: 'pitchClass' as const, bassPc: 4 };
    expect(Chord.detect(pitches, opts).map((chord) => chord.data)).toEqual(
      detectChord(pitches, opts).map((match) =>
        makeChord(match.rootPc, match.quality, match.bassPc),
      ),
    );
    expect(Chord.detect(pitches, opts)[0]?.bassPc).toBe(4);
    expect(Chord.detectMatches(pitches, opts).map((entry) => entry.match)).toEqual(
      detectChord(pitches, opts),
    );
  });
});

describe('Composer', () => {
  const KEY = 'C major';
  const SEED = 11;
  const composer = Composer.of({ key: KEY, bpm: 96, seed: SEED });
  /**
   * The context the composer hands every generator, written out. The version is
   * part of it: a composer concretises the algorithm version it resolved when
   * its settings were named, so the parts it writes stay reproducible.
   */
  const CTX = { seed: SEED, bpm: 96, algorithmVersion: ALGORITHM_VERSION };

  it('hands the generators the context its settings describe', () => {
    expect(composer.context).toEqual(CTX);
  });

  it('writes the progression the generator writes under the same seed', () => {
    const opts = { style: 'dance' as const, bars: 4 };
    const timeline = composer.progression(opts);
    expect(timeline.segments).toEqual(
      chordTimelineFromChords(generateProgression({ ...opts, key: toKeyScale(KEY), ctx: CTX }), 16)
        .segments,
    );
    expect(timeline.totalBeats).toBe(16);
    expect(timeline.key?.scale).toEqual(toKeyScale(KEY));
    // The seed is what fixes it: another seed is another progression.
    expect(composer.withSeed(SEED + 1).progression(opts).segments).not.toEqual(timeline.segments);
  });

  it('writes the bass line the generator writes over the same harmony', () => {
    const timeline = composer.progression({ style: 'dance', bars: 2 });
    const opts = { style: 'walking' as const, octave: 3 };
    expect(composer.bass(timeline, opts).notes).toEqual(
      inScoreOrder(
        generateBassLine({
          ...opts,
          segments: timeline.segments,
          key: toKeyScale(KEY),
          ts: { numerator: 4, denominator: 4 },
          ctx: CTX,
        }),
      ),
    );
    expect(composer.bass(timeline, opts).notes).not.toEqual(composer.bass(timeline).notes);
  });

  it('writes the drum part the generator writes under the same seed', () => {
    const opts = { bars: 2, style: 'funk' as const, section: 'chorus' as const, fills: true };
    expect(composer.drums(opts).notes).toEqual(
      inScoreOrder(generateDrums({ ...opts, ts: { numerator: 4, denominator: 4 }, ctx: CTX })),
    );
    expect(composer.drums(opts).notes).not.toEqual(composer.drums({ ...opts, fills: false }).notes);
  });

  it('writes the counter line the generator writes against the same melody', () => {
    const timeline = composer.progression({ style: 'dance', bars: 2 });
    const melody = Score.of([
      { pitch: 72, startBeat: 0, durationBeat: 2 },
      { pitch: 74, startBeat: 2, durationBeat: 2 },
      { pitch: 76, startBeat: 4, durationBeat: 4 },
    ]);
    const opts = { timeline: timeline.chordTimeline, register: 'above' as const };
    expect(composer.counterMelody(melody, opts).notes).toEqual(
      inScoreOrder(
        generateCounterMelody({
          ...opts,
          melody: melody.notes,
          key: toKeyScale(KEY),
          ts: { numerator: 4, denominator: 4 },
          ctx: CTX,
        }),
      ),
    );
    expect(composer.counterMelody(melody, opts).notes).not.toEqual(
      composer.counterMelody(melody, { timeline: opts.timeline }).notes,
    );
  });

  it('harmonizes the melody the harmonizer harmonizes', () => {
    const melody = Score.of([
      { pitch: 60, startBeat: 0, durationBeat: 2 },
      { pitch: 64, startBeat: 2, durationBeat: 2 },
      { pitch: 65, startBeat: 4, durationBeat: 2 },
      { pitch: 67, startBeat: 6, durationBeat: 2 },
    ]);
    const opts = { harmonicRhythm: 4 };
    const found = harmonizeMelody({
      ...opts,
      melody: melody.notes,
      key: toKeyScale(KEY),
      ts: { numerator: 4, denominator: 4 },
      ctx: CTX,
    });
    const harmonized = composer.harmonize(melody, opts);
    expect(harmonized.transposeSemitones).toBe(found.transposeSemitones);
    expect(harmonized.chords.key?.scale).toEqual(found.key.scale);
    // Over the span the class placed the chords on, the segments are the ones
    // the same chords describe.
    expect(harmonized.chords.segments).toEqual(
      chordTimelineFromChords(found.chords, harmonized.chords.totalBeats).segments,
    );
    expect(harmonized.melody.notes).toEqual(melody.transpose(found.transposeSemitones).notes);
    // The chord grid is the caller's: at one chord per bar there are fewer of
    // them than the default half-bar grid gives.
    expect(harmonized.chords.length).toBeLessThan(composer.harmonize(melody).chords.length);
  });
});

describe('Duration', () => {
  it('measures the written value the way the duration module measures it', () => {
    const dotted = Duration.of('quarter', 1);
    expect(dotted.beats()).toBe(durationToBeats({ base: 'quarter', dots: 1 }));
    // The beat unit reaches the function: counted in dotted quarters, a dotted
    // quarter is one beat rather than one and a half.
    const compound = { beatUnit: { base: 'quarter' as const, dots: 1 } };
    expect(dotted.beats(compound)).toBe(durationToBeats({ base: 'quarter', dots: 1 }, compound));
    expect(dotted.beats(compound)).not.toBe(dotted.beats());
    const triplet = Duration.of('eighth', 0, { actual: 3, normal: 2 });
    expect(triplet.beats()).toBe(
      durationToBeats({ base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }),
    );
  });

  it('spells a length as the duration module spells it', () => {
    expect(Duration.ofBeats(1.5).data).toEqual(beatsToDuration(1.5));
    const compound = { beatUnit: { base: 'quarter' as const, dots: 1 } };
    expect(Duration.ofBeats(1, compound).data).toEqual(beatsToDuration(1, compound));
    expect(Duration.ofBeats(1, compound).toString()).toBe('quarter.');
    expect(Duration.tieChain(5).map((value) => value.data)).toEqual(beatsToTiedDurations(5));
    expect(Duration.tieChain(1, compound).map((value) => value.data)).toEqual(
      beatsToTiedDurations(1, compound),
    );
  });
});

describe('Instrument', () => {
  const guitar = Instrument.guitar();

  it('reports the compass and the positions the instrument module reports', () => {
    expect(guitar.range()).toEqual(instrumentRange(GUITAR_STANDARD));
    expect(guitar.canSound(64)).toBe(canSound(GUITAR_STANDARD, 64));
    expect(guitar.canSound(30)).toBe(canSound(GUITAR_STANDARD, 30));
    expect(guitar.fingerings(64)).toEqual(fingeringsFor(GUITAR_STANDARD, 64));
    expect(guitar.foldIntoRange(27)).toBe(foldIntoRange(27, GUITAR_STANDARD));
  });

  it('judges a passage the way the playability check judges it, tempo and all', () => {
    const passage: NoteEvent[] = [
      { pitch: 40, startBeat: 0, durationBeat: 0.25 },
      { pitch: 64, startBeat: 0.25, durationBeat: 0.25 },
      { pitch: 41, startBeat: 0.5, durationBeat: 0.25 },
      { pitch: 65, startBeat: 0.75, durationBeat: 0.25 },
    ];
    expect(guitar.playability(passage)).toEqual(playability(passage, GUITAR_STANDARD));
    // The tempo reaches the layer that asks whether there is time for the move.
    expect(guitar.playability(passage, 240)).toEqual(playability(passage, GUITAR_STANDARD, 240));
    expect(guitar.playability(passage, 240)).not.toEqual(guitar.playability(passage));
  });
});

describe('Interval', () => {
  it('carries the interval the pitch module reads from a name', () => {
    for (const name of ['P5', 'm3', '-m3', 'AA4', 'd5']) {
      expect(Interval.parse(name).data, name).toEqual(toSpelledInterval(parseInterval(name)));
    }
    expect(Interval.of(5, 'P', 7).data).toEqual(
      toSpelledInterval({ number: 5, quality: 'P', semitones: 7 }),
    );
  });

  it('measures between two notes what the pitch module measures', () => {
    const from = Note.parse('C4');
    const to = Note.parse('Ab4');
    expect(Interval.between(from, to).data).toEqual(spelledInterval(from.data, to.data));
    expect(from.intervalTo(to).data).toEqual(spelledInterval(from.data, to.data));
  });

  it('inverts to the interval the pitch module measures on the other side', () => {
    // The inversion of C-to-E is E-to-C an octave up, which is a reading the
    // pitch module can take without being told what an inversion is.
    for (const [lower, upper] of [
      ['C4', 'E4'],
      ['C4', 'G4'],
      ['D4', 'F4'],
      ['C4', 'F#4'],
    ] as const) {
      const above = Note.parse(lower).intervalTo(Note.parse(upper));
      const back = Note.parse(upper).intervalTo(Note.parse(lower).transpose(12));
      expect(above.invert().data, `${lower} ${upper}`).toEqual(back.data);
    }
  });

  it('reads consonance the way the interval module reads it, in both contexts', () => {
    for (const name of ['P4', 'P5', 'M3', 'm7']) {
      const interval = Interval.parse(name);
      expect(interval.isConsonant(), name).toBe(isConsonantInterval(interval.semitones, true));
      expect(interval.isConsonant(false), name).toBe(
        isConsonantInterval(interval.semitones, false),
      );
    }
    // The two-voice reading is the one that differs, so the argument is doing
    // work rather than being accepted and ignored.
    expect(Interval.parse('P4').isConsonant(false)).not.toBe(Interval.parse('P4').isConsonant());
    expect(Interval.parse('P4').invert().semitones).toBe(intervalSemitones(5, 'P'));
  });
});

describe('Key', () => {
  const key = Key.major('Db');

  it('reports the signature and the spelled scale the theory layer reports', () => {
    expect(key.fifths).toBe(keySignatureFifths(key.tonic.data, key.scale));
    expect(key.notes().map((note) => note.data)).toEqual(spellScale(key.tonic.data, key.scale));
    expect(key.degree(5).data).toEqual(spellScale(key.tonic.data, key.scale)[4]);
    expect(key.contains(65)).toBe(isScaleTone(65, key.scale));
    expect(key.nearestTone(61)).toBe(nearestScaleTone(61, key.scale));
    expect(key.degreeOf(65)).toBe(pitchToScaleDegree(65, key.scale));
    // The scale function reports -1 for a pitch it does not hold; the class
    // says so with null, so the miss cannot be read as a degree.
    expect(pitchToScaleDegree(62, key.scale)).toBe(-1);
    expect(key.degreeOf(62)).toBeNull();
  });

  it('builds the chords on a degree that the chord functions build', () => {
    expect(key.chord(5, 'dom7').data).toEqual(
      Chord.fromData(chordFromDegree(5, 'dom7', key.scale)).withKey(key).data,
    );
    expect(key.chord(2).data).toEqual(
      Chord.fromData(diatonicTriad(2, key.scale)).withKey(key).data,
    );
    expect(key.diatonicTriad(7).data).toEqual(
      Chord.fromData(diatonicTriad(7, key.scale)).withKey(key).data,
    );
    expect(key.diatonicSeventh(5).data).toEqual(
      Chord.fromData(diatonicSeventh(5, key.scale)).withKey(key).data,
    );
    expect(key.roman('V7/V').data).toEqual(
      Chord.fromData(romanToChord('V7/V', key)).withKey(key).data,
    );
  });

  it('stands to its neighbours as the relation functions place it', () => {
    expect(spelledOf(key.relative())).toEqual(relativeKeyOf(key.tonic.data, key.scale));
    expect(spelledOf(key.parallel())).toEqual(parallelKeyOf(key.tonic.data, key.scale));
    expect(spelledOf(key.dominantKey())).toEqual(dominantKeyOf(key.tonic.data, key.scale));
    expect(spelledOf(key.subdominantKey())).toEqual(subdominantKeyOf(key.tonic.data, key.scale));
    const other = enharmonicKeyOf(key.tonic.data, key.scale);
    const enharmonic = key.enharmonic();
    expect(enharmonic === null ? null : spelledOf(enharmonic)).toEqual(other);
    expect(enharmonic?.toString()).toBe('C# major');
    expect(
      key
        .relatedKeys()
        .map((related) => ({ relation: related.relation, ...spelledOf(related.key) })),
    ).toEqual(relatedKeysOf(key.tonic.data, key.scale));
    expect(key.relationTo(Key.minor('Bb'))).toBe(
      keyRelationBetween(key.toJSON(), Key.minor('Bb').toJSON()),
    );
  });

  it('reads a signature and a written part the way the key functions do', () => {
    expect(spelledOf(Key.fromFifths(-2, 'minor'))).toEqual(keyFromFifths(-2, 'minor'));
    expect(Key.major('C').forInstrument('clarinetBb').tonic.data).toEqual(
      toWrittenPitch(parseNote('C'), 'clarinetBb'),
    );
    expect(Key.major('C').transposeBy('A4').tonic.data).toEqual(
      transposeByInterval(parseNote('C'), toSpelledInterval('A4')),
    );
  });

  it('reads a name and writes one under the options given', () => {
    const german = { system: 'german' as const };
    const read = Key.tryParse('h-moll', german);
    const named = tryParseKeyName('h-moll', german);
    expect(read.ok).toBe(true);
    expect(named.ok).toBe(true);
    expect(read.ok ? read.value.tonic.data : null).toEqual(named.ok ? named.value.tonic : null);
    const written = Key.major('C');
    expect(written.toString(german)).toBe(
      formatKeyName({ tonic: written.tonic.data, mode: 'major' }, german),
    );
    expect(written.toString(german)).not.toBe(written.toString());
    const pitches = [62, 64, 65, 67, 69, 71, 72];
    const modal = { modes: true as const, profile: 'temperley' as const };
    expect(Key.detectBest(pitches, modal)?.scale).toEqual(detectKeyBest(pitches, modal)?.key);
  });

  it('ranks the keys the detector ranks, church modes and all', () => {
    const pitches = [62, 64, 65, 67, 69, 71, 72];
    const opts = { modes: true as const, profile: 'temperley' as const };
    expect(Key.detect(pitches, opts).map((found) => found.scale)).toEqual(
      detectKey(pitches, opts).map((match) => match.key),
    );
    expect(Key.detect(pitches, opts).length).toBeGreaterThan(Key.detect(pitches).length);
  });
});

describe('Meter', () => {
  const meter = Meter.parse('6/8');
  const additive = Meter.of(7, 8, [2, 2, 3]);

  it('reads a bar the way the meter module reads it', () => {
    expect(meter.beatsPerBar).toBe(beatsPerBar(meter.data));
    expect(meter.pulsesPerBar).toBe(pulsesPerBar(meter.data));
    expect(meter.pulseBeats).toBe(pulseBeats(meter.data));
    expect(meter.isCompound).toBe(isCompound(meter.data));
    expect(additive.isCompound).toBe(isCompound(additive.data));
  });

  it('weighs and places a position the way the meter module does', () => {
    for (const beat of [0, 0.5, 1.5, 2.5, 3.75]) {
      expect(meter.weightAt(beat), `${beat}`).toBe(metricWeight(beat, meter.data));
      expect(meter.isStrongBeat(beat), `${beat}`).toBe(isStrongBeat(beat, meter.data));
      expect(meter.barPositionAt(beat), `${beat}`).toEqual(beatToBarPosition(beat, meter.data));
    }
    expect(meter.formatPosition(7.5)).toBe(formatBarPosition(7.5, meter.data, 2));
    // The precision reaches the formatter rather than being defaulted.
    expect(meter.formatPosition(7.4, 0)).toBe(formatBarPosition(7.4, meter.data, 0));
    expect(meter.formatPosition(7.4, 0)).not.toBe(meter.formatPosition(7.4));
  });

  it('prints and subdivides the way the meter module does', () => {
    expect(additive.format()).toBe(formatTimeSignature(additive.data));
    expect(additive.format({ grouping: true })).toBe(
      formatTimeSignature(additive.data, { grouping: true }),
    );
    expect(additive.format({ grouping: true })).not.toBe(additive.format());
    expect(meter.tuplet(1, 3)).toEqual(tuplet(1, 3));
  });
});

describe('Motif', () => {
  const CELL = [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 62, startBeat: 1, durationBeat: 1 },
    { pitch: 64, startBeat: 2, durationBeat: 2 },
  ];
  const motif = Motif.fromNotes(CELL);

  it('generates the cell the generator generates under the same seed', () => {
    const opts = { bars: 2, contour: 'ascending' as const, ctx: { seed: 5 } };
    expect(Motif.generate({ ...opts, key: 'C major' }).data).toEqual(
      generateMotif({ ...opts, key: toKeyScale('C major') }),
    );
    expect(Motif.generate({ ...opts, key: 'C major', ctx: { seed: 6 } }).data).toEqual(
      generateMotif({ ...opts, key: toKeyScale('C major'), ctx: { seed: 6 } }),
    );
  });

  it('transforms the cell the way the transform does, key and all', () => {
    expect(motif.transform('invert').data).toEqual(transformMotif(motif.data, 'invert'));
    expect(motif.transform('transposeDiatonic', 2, 'C major').data).toEqual(
      transformMotif(motif.data, 'transposeDiatonic', 2, toKeyScale('C major')),
    );
    // The key reaches the transform: two degrees diatonically is not two semitones.
    expect(motif.transform('transposeDiatonic', 2, 'C major').notes[0]?.pitch).not.toBe(
      motif.transform('transposeChromatic', 2).notes[0]?.pitch,
    );
  });

  it('develops the cell over a harmony the way the development does', () => {
    const timeline = Timeline.fromChords(
      SEGMENTS.map((segment) => spanFromChord(segment.chord, segment.startBeat)),
      16,
      'C major',
    );
    expect(motif.develop(timeline, 'C major', 2, '4/4').data).toEqual(
      developMotif(motif.data, timeline.chordTimeline, toKeyScale('C major'), 2, '4/4'),
    );
    expect(motif.develop(timeline, 'C major', 2, { numerator: 3, denominator: 4 }).data).toEqual(
      developMotif(motif.data, timeline.chordTimeline, toKeyScale('C major'), 2, {
        numerator: 3,
        denominator: 4,
      }),
    );
    expect(
      motif.develop(timeline, 'C major', 2, { numerator: 3, denominator: 4 }).data,
    ).not.toEqual(motif.develop(timeline, 'C major', 2, '4/4').data);
  });

  it('names its relation and its likeness the way the melody analyses do', () => {
    const answer = motif.transform('invert');
    expect(motif.relateTo(answer)).toEqual(
      relateMotifs(motifFromNotes(motif.notes), motifFromNotes(answer.notes)),
    );
    expect(motif.relateTo(answer, 'C major')).toEqual(
      relateMotifs(motifFromNotes(motif.notes), motifFromNotes(answer.notes), 'C major'),
    );
    expect(motif.similarityTo(answer)).toBe(melodicSimilarity(motif.notes, answer.notes));
    expect(motif.toScore().notes).toEqual(inScoreOrder(motifToNoteEvents(motif.data)));
  });
});

describe('Note', () => {
  const note = Note.parse('Ab4');

  it('names and locates itself the way the pitch module does', () => {
    expect(note.name).toBe(formatNote(note.data));
    expect(note.format({ system: 'german' })).toBe(formatNote(note.data, { system: 'german' }));
    expect(note.format({ system: 'german' })).not.toBe(note.name);
    expect(note.pitchClass).toBe(noteToPitchClass(note.data));
    expect(note.midi).toBe(noteToMidi(note.data));
    expect(Note.fromMidi(61, 'flat').data).toEqual(midiToNote(61, 'flat'));
    expect(Note.fromMidi(61, 'flat').data).not.toEqual(midiToNote(61, 'sharp'));
  });

  it('reads a name under the notation system it is given', () => {
    const german = { system: 'german' as const };
    const read = Note.tryParse('As4', german);
    const parsed = tryParseNote('As4', german);
    expect(read.ok).toBe(true);
    expect(parsed.ok).toBe(true);
    expect(read.ok ? read.value.data : null).toEqual(parsed.ok ? parsed.value : null);
    expect(read.ok ? read.value.name : '').not.toBe('As4');
  });

  it('moves the way the pitch module moves a note', () => {
    expect(note.transpose(2).data).toEqual(transposeNote(note.data, 2));
    expect(note.transpose(2, { spelling: 'sharp' }).data).toEqual(
      transposeNote(note.data, 2, { spelling: 'sharp' }),
    );
    expect(note.transpose(2, { spelling: 'sharp' }).name).not.toBe(note.transpose(2).name);
    expect(note.transposeBy('A2').data).toEqual(
      transposeByInterval(note.data, toSpelledInterval('A2')),
    );
    expect(note.forInstrument('altoSax').data).toEqual(toWrittenPitch(note.data, 'altoSax'));
  });

  it('sounds and is placed the way the tuning and scale modules read it', () => {
    expect(note.frequency()).toBe(frequencyOf(note.midi));
    // The temperament reaches the function rather than being defaulted away.
    expect(note.frequency(Tuning.edo(19).data)).toBe(frequencyOf(note.midi, edo(19)));
    expect(note.frequency(Tuning.edo(19).data)).not.toBe(note.frequency());
    expect(Note.parse('E4').degreeIn('C major')).toBe(
      pitchToScaleDegree(noteToPitchClass(parseNote('E4')), toKeyScale('C major')),
    );
    expect(note.degreeIn('C major')).toBeNull();
  });
});

describe('Progression', () => {
  const key = Key.major('C');
  const progression = new Progression(
    [Chord.parse('C'), Chord.parse('D7'), Chord.parse('G7'), Chord.parse('C')],
    key,
  );

  it('names the function of every chord the way the analysis does', () => {
    expect(progression.functions()).toEqual(
      progression.chords.map((chord) => functionOf(chord.data, key.scale)),
    );
    const opts = { applied: true };
    expect(progression.roman(undefined, opts)).toEqual(
      progression.chords.map((chord) => chordToRoman(chord.data, key.scale, opts)),
    );
    // The option reaches every chord: the applied reading names the dominant
    // of the dominant, and the plain one names the degree it stands on.
    expect(progression.roman(undefined, opts)).toEqual(['I', 'V7/V', 'V7', 'I']);
    expect(progression.roman()).toEqual(['I', 'II7', 'V7', 'I']);
  });

  it('voices the progression the way the voicing module voices it', () => {
    const chords = progression.chords.map((chord) => chord.data);
    expect(progression.voice()).toEqual(voiceProgression(chords, { key: key.scale }));
    const opts = { voices: 3 };
    expect(progression.voice(opts)).toEqual(voiceProgression(chords, { ...opts, key: key.scale }));
    expect(progression.voice(opts)[0]).toHaveLength(3);
  });

  it('reads every chord change the way the cadence detector reads the pair', () => {
    const approach = Chord.parse('Am');
    const chords = progression.chords;
    expect(progression.cadences(undefined, { approach })).toEqual([
      detectCadence(at(chords, 0).data, at(chords, 1).data, key.scale, { approach: approach.data }),
      detectCadence(at(chords, 1).data, at(chords, 2).data, key.scale, {
        approach: at(chords, 0).data,
      }),
      detectCadence(at(chords, 2).data, at(chords, 3).data, key.scale, {
        approach: at(chords, 1).data,
      }),
    ]);
    // The chord before each pair comes from the progression itself, so only the
    // first pair has the caller's approach chord to fall back on.
    expect(progression.cadences()[0]).toEqual(
      detectCadence(at(chords, 0).data, at(chords, 1).data, key.scale, {}),
    );
  });

  it('substitutes the chord the reharmonizer proposes for it', () => {
    const opts = { melodyPcs: [11] };
    const [chosen] = substituteChord(at(progression.chords, 2).data, key, opts).filter(
      (candidate) => candidate.type === 'tritone',
    );
    expect(chosen).toBeDefined();
    expect(progression.substitute(2, 'tritone', opts).at(2)?.data).toEqual(
      chosen === undefined ? undefined : Chord.fromData(chosen.chord).withKey(key).data,
    );
    expect(progression.substitute(2, 'tritone').at(2)?.symbol()).toBe('Db7');
  });
});

describe('Rhythm', () => {
  const TS = { numerator: 4, denominator: 4 };
  const rhythm = Rhythm.generate(TS, { bars: 2, ctx: { seed: 3, complexity: { rhythmic: 0.7 } } });

  /** The pattern's onsets on the sixteenth grid the transforms are written for. */
  function grid(events: readonly { position: number; duration: number }[]): {
    step: number;
    velocity: number;
  }[] {
    return events.map((event) => ({ step: event.position / STEP_BEATS, velocity: 1 }));
  }

  /** Grid onsets read back as a pattern: each sounds until the next, the last to the span. */
  function fromGrid(
    events: readonly { step: number }[],
    spanBeats: number,
  ): { position: number; duration: number }[] {
    const positions = [...new Set(events.map((event) => event.step * STEP_BEATS))].sort(
      (a, b) => a - b,
    );
    return positions.map((position, index) => ({
      position,
      duration: (positions[index + 1] ?? spanBeats) - position,
    }));
  }

  it('generates the pattern the generator generates under the same seed', () => {
    const opts = { bars: 2, ctx: { seed: 3, complexity: { rhythmic: 0.7 } } };
    expect(rhythm.events).toEqual(generateRhythm(TS, opts));
    expect(Rhythm.generate(TS, { ...opts, subdivision: 4 }).events).toEqual(
      generateRhythm(TS, { ...opts, subdivision: 4 }),
    );
    expect(Rhythm.generate(TS, { ...opts, subdivision: 4 }).events).not.toEqual(rhythm.events);
  });

  it('measures its density the way the rhythm module measures it', () => {
    expect(rhythm.density()).toBe(rhythmDensity(rhythm.events, rhythm.ts));
    expect(rhythm.toScore(38, 64).notes).toEqual(
      inScoreOrder(rhythmToNoteEvents(rhythm.events, 38, 64)),
    );
    expect(rhythm.toScore(38, 64).notes[0]?.velocity).toBe(64);
  });

  it('syncopates the way the transform does, drawing from the same stream', () => {
    // The pattern addresses its draws under its own part name, so the seed a
    // caller gives it names the same stream the transform is handed here.
    const drawn = syncopate(grid(rhythm.events), 0.6, resolveContext({ seed: 9 }).part('rhythm'));
    expect(rhythm.syncopate(0.6, { seed: 9 }).events).toEqual(fromGrid(drawn, rhythm.totalBeats));
    expect(rhythm.syncopate(0.6, { seed: 9 }).events.length).toBeGreaterThan(rhythm.events.length);
    // A different seed anticipates different beats, so the stream is doing work.
    expect(rhythm.syncopate(0.6, { seed: 10 }).events).not.toEqual(
      rhythm.syncopate(0.6, { seed: 9 }).events,
    );
  });

  it('reads the ceiling the way the transform reads it', () => {
    const ctx = { seed: 1, bpm: 180, complexity: { difficulty: 2 } };
    const resolved = resolveContext(ctx);
    expect(rhythm.withinCeiling(ctx)).toBe(
      withinCeiling(grid(rhythm.events), resolved.bpm, resolved.difficulty),
    );
    // A context naming neither tempo nor ceiling has nothing to measure against.
    expect(rhythm.withinCeiling()).toBe(true);
  });
});

describe('Score', () => {
  const score = Score.of(PHRASE, { meters: '4/4', tempo: 100 });

  it('infers the harmony and the keys the analyses infer from the same notes', () => {
    const found = chordTimelineFromNotes(score.notes, { meters: score.meters });
    expect(score.timeline().segments).toEqual(found.timeline.segments);
    expect(score.timeline().keys).toEqual(found.keys);
    expect(score.keys()).toEqual(keyTimelineFromNotes(score.notes, { meters: score.meters }));
    expect(keyIdentity(score.key() as Key)).toEqual(prevailingKeyOf(score.keys()));
  });

  it('carries its own options into the readings that take them', () => {
    const timelineOpts = { harmonicRhythm: 1, segmentation: 'grid' as const };
    expect(score.timeline(timelineOpts).segments).toEqual(
      chordTimelineFromNotes(score.notes, { meters: score.meters, ...timelineOpts }).timeline
        .segments,
    );
    expect(score.timeline(timelineOpts).segments).not.toEqual(score.timeline().segments);
    const keyOpts = { modes: true as const, profile: 'temperley' as const };
    expect(score.detectKeys(keyOpts).map((found) => found.key.scale)).toEqual(
      detectKeyFromNotes(score.notes, keyOpts).map((match) => match.key),
    );
    expect(score.detectKeys(keyOpts).length).toBeGreaterThan(score.detectKeys().length);
    const indexOpts = { budget: 1000 };
    expect(score.index(indexOpts).at(2)).toEqual(
      createNoteEventIndex(score.notes, indexOpts).at(2),
    );
  });

  it('reads the form the way the form analyses read it, options and all', () => {
    const timeline = chordTimelineFromNotes(score.notes, { meters: score.meters }).timeline;
    const opts = { expectedPhraseBeats: 4, minPhraseBeats: 2 };
    expect(score.phrases(opts)).toEqual(
      phrasesFromTimeline(timeline, score.notes, { meters: score.meters, ...opts }),
    );
    expect(score.phrases(opts)).not.toEqual(score.phrases());
    const sectionOpts = { unitBars: 1 };
    expect(score.sections(sectionOpts)).toEqual(
      sectionsFromNotes(score.notes, { meters: score.meters, ...sectionOpts }),
    );
    expect(score.sections(sectionOpts)).not.toEqual(score.sections());
    const hyperOpts = { cadenceBeats: [8, 16] };
    expect(score.hypermeter(hyperOpts)).toEqual(hypermeter(score.notes, score.meters, hyperOpts));
    expect(score.hypermeter(hyperOpts)).not.toEqual(score.hypermeter());
  });

  it('reads the melody the way the melody analyses read it', () => {
    expect(score.contour()).toEqual(melodicContour(score.notes));
    // A line that restates its own cell, so there is a motif to find at all.
    const restated = Score.of([
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 1 },
      { pitch: 64, startBeat: 2, durationBeat: 1 },
      { pitch: 65, startBeat: 3, durationBeat: 1 },
      { pitch: 60, startBeat: 4, durationBeat: 1 },
      { pitch: 62, startBeat: 5, durationBeat: 1 },
      { pitch: 64, startBeat: 6, durationBeat: 1 },
      { pitch: 65, startBeat: 7, durationBeat: 1 },
    ]);
    const opts = { minNotes: 2, maxNotes: 2 };
    expect(restated.motifs(opts)).toEqual(extractMotifs(restated.notes, opts));
    expect(restated.motifs(opts).length).toBeGreaterThan(0);
    expect(restated.motifs(opts)).not.toEqual(restated.motifs());
    expect(score.voices('C major')).toEqual(
      analyzeVoice(
        score.notes,
        chordTimelineFromNotes(score.notes, { meters: score.meters }).timeline.at,
        'C major',
      ),
    );
    // The key reaches the reading where a note is chromatic in one key and a
    // scale tone in another; over notes that are all chord tones it cannot.
    const chromatic = Score.of([
      { pitch: 60, startBeat: 0, durationBeat: 2 },
      { pitch: 64, startBeat: 2, durationBeat: 1 },
      { pitch: 66, startBeat: 3, durationBeat: 1 },
      { pitch: 67, startBeat: 4, durationBeat: 4 },
    ]);
    expect(chromatic.voices('G major')).toEqual(
      analyzeVoice(
        chromatic.notes,
        chordTimelineFromNotes(chromatic.notes, { meters: chromatic.meters }).timeline.at,
        toKeyScale('G major'),
      ),
    );
    expect(chromatic.voices('G major')).not.toEqual(chromatic.voices('C major'));
  });

  it('performs the notes the way the generators perform them, under one seed', () => {
    const humanized = { timing: 0.05, ctx: { seed: 4 } };
    expect(score.humanize(humanized).notes).toEqual(
      inScoreOrder(humanize(score.notes, { ts: score.meterAt(0), ...humanized })),
    );
    expect(score.humanize(humanized).notes).not.toEqual(score.notes);
    const ornamented = { style: 'accent' as const, amount: 0.9, ctx: { seed: 4 } };
    expect(score.ornament(ornamented).notes).toEqual(
      inScoreOrder(ornament(score.notes, { ts: score.meterAt(0), ...ornamented })),
    );
    // The style and the amount reach the function: the default leaves this
    // phrase as it was, and the accented reading does not.
    expect(score.ornament().notes).toEqual(score.notes);
    expect(score.ornament(ornamented).notes).not.toEqual(score.notes);
  });

  it('converts and places a beat the way the tempo and meter modules do', () => {
    expect(score.secondsAt(8)).toBe(beatsToSeconds(8, score.tempo));
    expect(score.barAt(6)).toEqual(beatToBarPosition(6, score.meters));
    expect(score.meterAt(6)).toEqual(meterAt(6, score.meters));
    expect(score.toTicks(480)).toEqual(
      score.notes.map((note) => ({
        ...note,
        startBeat: beatsToTicks(note.startBeat, 480),
        durationBeat: beatsToTicks(note.durationBeat, 480),
      })),
    );
    expect(score.playability(GUITAR_STANDARD)).toEqual(
      playability(score.notes, GUITAR_STANDARD, tempoAt(0, score.tempo)),
    );
  });
});

describe('Tempo', () => {
  const tempo = Tempo.of(90);
  /** The one-event map the class measures every conversion against. */
  const MAP = [{ startBeat: 0, bpm: 90 }];

  it('converts beats and seconds the way the tempo module converts them', () => {
    expect(tempo.secondsAt(6)).toBe(beatsToSeconds(6, MAP));
    expect(tempo.secondsAt(-2)).toBe(beatsToSeconds(-2, MAP));
    expect(tempo.beatAtSeconds(4)).toBe(secondsToBeats(4, MAP));
    expect(tempo.secondsOf(3)).toBe(durationToSeconds(0, 3, MAP));
  });

  it('converts beats and ticks the way the tempo module converts them', () => {
    expect(tempo.ticksAt(2.5, 480)).toBe(beatsToTicks(2.5, 480));
    expect(tempo.ticksAt(2.5, 96)).toBe(beatsToTicks(2.5, 96));
    expect(tempo.ticksAt(2.5, 96)).not.toBe(tempo.ticksAt(2.5, 480));
    expect(tempo.beatAtTicks(1200, 480)).toBe(ticksToBeats(1200, 480));
  });
});

describe('Timeline', () => {
  const key = Key.major('C');
  const spans = SEGMENTS.map((segment) => spanFromChord(segment.chord, segment.startBeat));
  const timeline = Timeline.fromChords(spans, 16, key);

  it('places the chords the way the timeline builder places them', () => {
    expect(timeline.segments).toEqual(chordTimelineFromChords(spans, 16).segments);
    expect(timeline.at(5)?.data).toEqual(Chord.fromData(at(SEGMENTS, 1).chord).withKey(key).data);
    expect(timeline.at(16)).toBeNull();
    expect(timeline.key?.scale).toEqual(key.scale);
  });

  it('reads the modulations the key search reads, under the same options', () => {
    const modulating = Timeline.fromNotes(PHRASE);
    const opts = { minKeyBeats: 2, expectedKeyBeats: 4, totalBeats: modulating.totalBeats };
    expect(modulating.modulations(opts)).toEqual(detectModulations(modulating.segments, opts));
  });

  it('infers a timeline from notes the way the analysis infers one', () => {
    const opts = { ts: { numerator: 3, denominator: 4 }, harmonicRhythm: 3 };
    const found = chordTimelineFromNotes(PHRASE, opts);
    const inferred = Timeline.fromNotes(PHRASE, opts);
    expect(inferred.segments).toEqual(found.timeline.segments);
    expect(inferred.keys).toEqual(found.keys);
    expect(inferred.segments).not.toEqual(Timeline.fromNotes(PHRASE).segments);
  });

  it('names every segment the numeral the functional analysis names', () => {
    expect(timeline.roman()).toEqual(
      timeline.segments.map((segment) => ({
        startBeat: segment.startBeat,
        endBeat: segment.endBeat,
        roman: chordToRoman(segment.chord, key.scale),
      })),
    );
    const opts = { applied: true };
    const applied = Timeline.fromChords(
      [spanFromChord(makeChord(2, 'dom7'), 0), spanFromChord(makeChord(7, 'dom7'), 4)],
      8,
      key,
    );
    expect(applied.roman('C major', opts)).toEqual(
      applied.segments.map((segment) => ({
        startBeat: segment.startBeat,
        endBeat: segment.endBeat,
        roman: chordToRoman(segment.chord, key.scale, opts),
      })),
    );
    expect(applied.roman('C major', opts).map((entry) => entry.roman)).toEqual(['V7/V', 'V7']);
    expect(applied.roman().map((entry) => entry.roman)).toEqual(['II7', 'V7']);
  });

  it('reduces and cadences the way the analyses do over the same harmony', () => {
    const chordTimeline = timeline.chordTimeline;
    expect(timeline.reduce()).toEqual(reduceProgression(chordTimeline, () => key.scale));
    const opts = { basis: 'duration' as const };
    expect(timeline.reduce(opts)).toEqual(reduceProgression(chordTimeline, () => key.scale, opts));
    expect(timeline.reduce(opts)).not.toEqual(timeline.reduce());
    expect(timeline.cadences()).toEqual(detectCadences(chordTimeline, () => key.scale));
  });
});

describe('Tuning', () => {
  const et19 = Tuning.edo(19);

  it('carries the table the tuning module builds', () => {
    expect(et19.data).toEqual(edo(19));
    expect(Tuning.twelveTet().data).toEqual(
      edo(TWELVE_TET.divisions, TWELVE_TET.refFreq, TWELVE_TET.refStep),
    );
    expect(Tuning.edo(19, 432, 60).data).toEqual(edo(19, 432, 60));
  });

  it('converts pitch and frequency the way the tuning module converts them', () => {
    expect(et19.frequencyOf('A4')).toBe(frequencyOf(noteToMidi(parseNote('A4')), edo(19)));
    expect(et19.frequencyOfStep(70)).toBe(frequencyOf(70, edo(19)));
    expect(et19.nearestStep(442)).toBe(nearestStep(442, edo(19)));
    expect(et19.stepOf(442)).toBe(stepOf(442, edo(19)));
    expect(et19.centsFromNearestStep(442)).toBe(centsFromNearestStep(442, edo(19)));
    expect(et19.centsOfSteps(1)).toBe(centsOfSteps(1, edo(19)));
    expect(et19.stepsOfCents(700)).toBe(stepsOfCents(700, edo(19)));
  });

  it('reads a second temperament where one is named instead of its own', () => {
    expect(et19.frequencyOfStep(70, TWELVE_TET)).toBe(frequencyOf(70, TWELVE_TET));
    expect(et19.frequencyOfStep(70, TWELVE_TET)).not.toBe(et19.frequencyOfStep(70));
    expect(et19.centsOfSteps(1, TWELVE_TET)).toBe(centsOfSteps(1, TWELVE_TET));
    expect(et19.nearestStep(442, TWELVE_TET)).toBe(nearestStep(442, TWELVE_TET));
  });

  it('answers the ratio questions the tuning module answers', () => {
    expect(Tuning.ratioToCents(3, 2)).toBe(ratioToCents(3, 2));
    expect(Tuning.centsToRatio(702)).toBe(centsToRatio(702));
    expect(Tuning.centsBetweenFreq(440, 660)).toBe(centsBetweenFreq(440, 660));
    expect(Tuning.justDeviationCents(7)).toBe(justDeviationCents(7));
  });
});

describe('Voicing', () => {
  const key = 'C major';
  const scale = toKeyScale(key);
  const voicing = Voicing.of([48, 55, 64, 72]);

  it('realizes a chord the way the voicing module realizes it', () => {
    expect(Voicing.satb('Cmaj7').pitches).toEqual(voiceChord(toChordData('Cmaj7')));
    expect(Voicing.satb('Cmaj7', { voices: 3 }).pitches).toEqual(
      voiceChord(toChordData('Cmaj7'), { voices: 3 }),
    );
    expect(Voicing.satb('Cmaj7', { voices: 3 }).pitches).toHaveLength(3);
    expect(Voicing.forChord('Dm7', { style: 'drop2' }).pitches).toEqual(
      voiceChordStyled(toChordData('Dm7'), { style: 'drop2' }),
    );
    expect(Voicing.forChord('Dm7', { style: 'drop2' }).pitches).not.toEqual(
      Voicing.forChord('Dm7').pitches,
    );
    expect(voicing.next('G7').pitches).toEqual(nextVoicing(voicing.pitches, toChordData('G7')));
    expect(voicing.costTo(Voicing.of([50, 57, 65, 69]))).toBe(
      voiceLeadingCost(voicing.pitches, [50, 57, 65, 69]),
    );
  });

  it('spells its voices the way the spelling module spells them', () => {
    const { tonic } = spelledKeyOf(scale);
    expect(voicing.spell(key).map((note) => note.data)).toEqual(
      voicing.pitches.map((pitch) => spellPitch(pitch, tonic, scale)),
    );
    // The chord under the voicing supplies the enharmonic evidence.
    const chord = toChordData('D');
    expect(
      Voicing.of([50, 57, 66, 69])
        .spell(key, 'D')
        .map((note) => note.data),
    ).toEqual(spellVoicing([50, 57, 66, 69], chord, key));
  });

  it('grades a pair of voicings the way the part-writing check grades it', () => {
    const other = Voicing.of([50, 57, 65, 69]);
    const from = toChordData('C');
    const to = toChordData('Dm');
    const spelled = [
      spellVoicing(voicing.pitches, from, key),
      spellVoicing(other.pitches, to, key),
    ];
    expect(voicing.checkTo(other, ['C', 'Dm'], key)).toEqual(
      checkPartWriting(spelled, [from, to], scale),
    );
    const opts = { maxSpacing: 5 };
    expect(voicing.checkTo(other, ['C', 'Dm'], key, opts)).toEqual(
      checkPartWriting(spelled, [from, to], scale, opts),
    );
    expect(voicing.checkTo(other, ['C', 'Dm'], key, opts)).not.toEqual(
      voicing.checkTo(other, ['C', 'Dm'], key),
    );
  });

  it('marks a species exercise the way the species check marks it', () => {
    const counterpoint = Voicing.of([72, 69, 67, 71, 72]);
    const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'];
    const { tonic } = spelledKeyOf(scale);
    const spell = (line: readonly (string | number)[]) =>
      line.map((value) =>
        typeof value === 'number' ? spellPitch(value, tonic, scale) : parseNote(value),
      );
    expect(counterpoint.species(cantus, 1, key)).toEqual(
      checkSpecies(spell(cantus), spell(counterpoint.pitches), 1, scale),
    );
    const opts = { counterpointAbove: false };
    expect(counterpoint.species(cantus, 1, key, opts)).toEqual(
      checkSpecies(spell(cantus), spell(counterpoint.pitches), 1, scale, opts),
    );
    expect(counterpoint.species(cantus, 1, key, opts)).not.toEqual(
      counterpoint.species(cantus, 1, key),
    );
    // A line moving in parallel with the cantus, so the two sides have
    // violations to agree on rather than an empty list.
    const parallel = Voicing.of([72, 74, 76, 74, 72]);
    expect(parallel.species(cantus, 1, key)).toEqual(
      checkSpecies(spell(cantus), spell(parallel.pitches), 1, scale),
    );
    expect(parallel.species(cantus, 1, key).length).toBeGreaterThan(0);
  });

  it('measures independence the way the counterpoint module measures it', () => {
    // A fourth apart throughout, so the treatment of the fourth is what the
    // report turns on.
    const lead = Voicing.of([72, 74, 76, 74, 72]);
    const counter = Voicing.of([67, 69, 71, 69, 67]);
    const bare = (pitches: readonly number[]) => pitches.map((pitch) => midiToNote(pitch));
    expect(lead.independence(counter)).toEqual(
      voiceIndependence(bare(lead.pitches), bare(counter.pitches), undefined),
    );
    // A key spells the lines instead of reading them as sharp-spelled MIDI.
    const opts = { key, countFourths: true };
    const { tonic } = spelledKeyOf(scale);
    const spelled = (pitches: readonly number[]) =>
      pitches.map((pitch) => spellPitch(pitch, tonic, scale));
    expect(lead.independence(counter, opts)).toEqual(
      voiceIndependence(spelled(lead.pitches), spelled(counter.pitches), opts),
    );
    expect(lead.independence(counter, opts).longestPerfectRun).not.toBe(
      lead.independence(counter).longestPerfectRun,
    );
    // `key` is the class's own option: it spells the two lines and means
    // nothing below, so what reaches the delegate is the bag without it. The
    // delegate discards an unknown property either way, which is exactly why
    // this has to be pinned rather than left to be noticed.
    expect(lead.independence(counter, opts)).toEqual(
      voiceIndependence(spelled(lead.pitches), spelled(counter.pitches), { countFourths: true }),
    );
  });

  it('judges a candidate pitch the way the safety module judges it', () => {
    const query = {
      profile: 'pop' as const,
      chord: 'C' as const,
      key,
      strongBeat: true,
    };
    const context = {
      profile: 'pop' as const,
      chord: toChordData('C'),
      key: scale,
      otherVoices: [48, 55, 64].map((pitch) => ({ pitch })),
      strongBeat: true,
      prevPitch: undefined,
      vocalLow: undefined,
      vocalHigh: undefined,
    };
    const sounding = Voicing.of([48, 55, 64]);
    expect(sounding.safetyOf(72, query)).toEqual(
      evaluateSafety({ ...context, candidatePitch: 72 }),
    );
    expect(sounding.safetyOf(73, query, { suggestions: false })).toEqual(
      evaluateSafety({ ...context, candidatePitch: 73 }, { suggestions: false }),
    );
    expect(sounding.safetyOf(73, query).suggestions).toBeDefined();
    expect(sounding.safetyOf(73, query, { suggestions: false }).suggestions).toBeUndefined();
    expect(sounding.safePitches(query, 60, 72)).toEqual(enumerateSafePitches(context, 60, 72));
  });
});

/**
 * The same equivalence measured where the key's spelling decides the answer.
 *
 * A key is three facts — its pitch classes, the tonic it is written on, the
 * scale form it stands in — and only the first survives a reduction to a bare
 * scale. Reduce an Ab minor and spell it back, and a G# minor comes up: the
 * sound is the same and every letter is different. So a class method that
 * narrowed its key before handing it on answered a question the caller never
 * asked, and answered it identically for keys a musician writes differently.
 *
 * The cases below are the cross product of the keys that make the difference
 * visible and the members that reach a function whose answer carries letters.
 * Each holds the class result against the same function called with the whole
 * key, which is what the class was handed.
 */
describe('a key travels whole from a class method to the function it delegates to', () => {
  /**
   * One key per side of the circle, and one standard key as the control.
   *
   * The control matters: it is the shape the older cases here had, and it
   * passes whether or not the spelling survives, which is why it never caught
   * any of this on its own.
   */
  const SPELLINGS = ['Ab minor', 'D# minor', 'C major'] as const;

  /** The chords each case is measured on, built and spelled by the key. */
  function chordsOf(key: Key): Chord[] {
    return [key.chord(1), key.chord(4), key.roman('V7'), key.chord(1)];
  }

  /** One member, as the class answers it and as the function does. */
  type Surface = {
    /** The member, named as a failure should name it. */
    name: string;
    /** What the class answers, with the key delivered the way the member takes it. */
    viaClass: (key: Key) => unknown;
    /** What the same function answers, called with the whole key. */
    viaFunction: (key: Key) => unknown;
  };

  const SURFACES: readonly Surface[] = [
    {
      name: 'Progression.voice',
      viaClass: (key) => new Progression(chordsOf(key), key).voice(),
      viaFunction: (key) =>
        voiceProgression(
          new Progression(chordsOf(key), key).chords.map((chord) => chord.data),
          { key },
        ),
    },
    {
      name: 'Progression.roman',
      viaClass: (key) => new Progression(chordsOf(key), key).roman(),
      viaFunction: (key) =>
        new Progression(chordsOf(key), key).chords.map((chord) => chordToRoman(chord.data, key)),
    },
    {
      name: 'Progression.functions',
      viaClass: (key) => new Progression(chordsOf(key), key).functions(),
      viaFunction: (key) =>
        new Progression(chordsOf(key), key).chords.map((chord) => functionOf(chord.data, key)),
    },
    {
      name: 'Progression.analyze',
      viaClass: (key) => new Progression(chordsOf(key), key).analyze(),
      viaFunction: (key) => {
        const chords = new Progression(chordsOf(key), key).chords.map((chord) => chord.data);
        return {
          chords: chords.map((chord) => analyzeChord(chord, key)),
          cadence: detectCadence(at(chords, 2), at(chords, 3), key, { approach: at(chords, 1) }),
        };
      },
    },
    {
      name: 'Progression.cadences',
      viaClass: (key) => new Progression(chordsOf(key), key).cadences(),
      viaFunction: (key) => {
        const chords = new Progression(chordsOf(key), key).chords.map((chord) => chord.data);
        return [
          detectCadence(at(chords, 0), at(chords, 1), key, {}),
          detectCadence(at(chords, 1), at(chords, 2), key, { approach: at(chords, 0) }),
          detectCadence(at(chords, 2), at(chords, 3), key, { approach: at(chords, 1) }),
        ];
      },
    },
    {
      name: 'Progression.substitute',
      viaClass: (key) => new Progression(chordsOf(key), key).substitute(2, 'tritone').at(2)?.data,
      viaFunction: (key) => {
        const target = at(new Progression(chordsOf(key), key).chords, 2);
        const chosen = substituteChord(target.data, key).find(
          (candidate) => candidate.type === 'tritone',
        );
        return chosen === undefined ? undefined : Chord.fromData(chosen.chord).withKey(key).data;
      },
    },
    {
      name: 'Chord.figuredBass',
      viaClass: (key) => key.chord(4).invert(1).figuredBass(),
      viaFunction: (key) => figuredBassOf(key.chord(4).invert(1).data, key),
    },
    {
      name: 'Chord.voice',
      viaClass: (key) => key.roman('V7').voice(),
      viaFunction: (key) => voiceChord(key.roman('V7').data, { key }),
    },
    {
      name: 'Chord.roman',
      viaClass: (key) => key.roman('V7').roman(),
      viaFunction: (key) => chordToRoman(key.roman('V7').data, key),
    },
    {
      name: 'Chord.analyze',
      viaClass: (key) => key.roman('V7').analyze(),
      viaFunction: (key) => analyzeChord(key.roman('V7').data, key),
    },
    {
      name: 'Chord.substitutions',
      viaClass: (key) => key.roman('V7').substitutions(),
      viaFunction: (key) => substituteChord(key.roman('V7').data, key),
    },
  ];

  const CASES = SURFACES.flatMap((surface) => SPELLINGS.map((spelling) => ({ surface, spelling })));

  it.each(CASES)('answers as $surface.name does in $spelling', ({ surface, spelling }) => {
    const key = Key.parse(spelling);
    expect(surface.viaClass(key)).toEqual(surface.viaFunction(key));
  });

  it('spells the figures a key needs rather than the ones its pitch classes do', () => {
    // The sixth and the third of an Ab minor subdominant are both in the key,
    // so the figure needs no accidental; read from the pitch classes alone the
    // same chord is written with two.
    expect(Key.minor('Ab').roman('iv6').figuredBass()).toBe('6');
  });

  it('voices a flat-side progression as the voicer voices it', () => {
    const key = Key.minor('Ab');
    const progression = key.progression('i', 'V7/iv', 'iv', 'V7', 'i');
    expect(progression.voice()).toEqual(
      voiceProgression(
        progression.chords.map((chord) => chord.data),
        { key },
      ),
    );
  });

  it('substitutes through a progression as it does through a chord', () => {
    const key = Key.minor('Ab');
    const progression = key.progression('V7', 'i');
    const target = at(progression.chords, 0);
    const chosen = target.substitutions().find((candidate) => candidate.type === 'tritone');
    expect(chosen).toBeDefined();
    expect(progression.substitute(0, 'tritone').at(0)?.data).toEqual(
      chosen === undefined ? undefined : Chord.fromData(chosen.chord).withKey(key).data,
    );
  });

  it('writes the parts of a composer in the key it was named with', () => {
    for (const spelling of SPELLINGS) {
      const key = Key.parse(spelling);
      const composer = Composer.of({ key: spelling, seed: 4 });
      const chords = composer.progression({ style: 'dance', bars: 2 });
      expect(chords.keys[0]?.key.tonic, spelling).toEqual(key.tonic.data);
      expect(composer.bass(chords, { style: 'pop' }).key()?.tonic.data, spelling).toEqual(
        key.tonic.data,
      );
    }
  });

  it('reads an arrangement in the key it was named with', () => {
    for (const spelling of SPELLINGS) {
      const key = Key.parse(spelling);
      const arrangement = Arrangement.of(PARTS, { key: spelling });
      expect(arrangement.track('lead')?.key()?.tonic.data, spelling).toEqual(key.tonic.data);
      expect(arrangement.analyze().prevailingKey.tonic, spelling).toEqual(key.tonic.data);
    }
  });
});

/**
 * The same claim across the ways a key is delivered and the forms it arrives in.
 *
 * A key reaches a method as the instance's own or as an argument, and in any of
 * the four shapes the library accepts. Only one of those shapes carries no
 * spelling: a bare scale has none to keep, so what it answers is the library's
 * own reading of those pitch classes — asserted here rather than skipped, since
 * "no spelling" and "some other key's spelling" are the two answers this whole
 * area exists to keep apart.
 */
describe('a key is carried the same whichever way it is handed over', () => {
  /** The four shapes a key argument arrives in, from one key. */
  const FORMS = {
    name: () => 'Ab minor',
    instance: () => Key.parse('Ab minor'),
    data: () => Key.parse('Ab minor').toJSON(),
    scale: () => Key.parse('Ab minor').scale,
  } as const;

  const FORM_NAMES = Object.keys(FORMS) as (keyof typeof FORMS)[];

  /** The first-inversion subdominant of an Ab minor, with no key of its own. */
  const chord = () => Chord.parse('Dbm/Fb');

  /** A dominant and its tonic in that key, with no key of their own. */
  const chords = () => [Chord.parse('Eb7'), Chord.parse('Abm')];

  /**
   * The forms that carry a spelling, which are the ones a spelling-sensitive
   * entry point takes.
   *
   * `figuredBassOf` answers differently for an Ab minor and a G# minor, so it
   * declares the key type that a bare scale cannot satisfy: there is no writing
   * the call that hands it one. The bare form is still a key the class layer
   * takes, and it is swept below against the reading the resolver gives it.
   */
  const SPELLED_FORM_NAMES = ['name', 'instance', 'data'] as const;

  it.each(SPELLED_FORM_NAMES)('figures a chord in a key carried as %s', (form) => {
    const key = FORMS[form]();
    const carried = chord().withKey(key);
    expect(carried.figuredBass()).toBe(figuredBassOf(carried.data, key));
    const given = chord();
    expect(given.figuredBass(key)).toBe(figuredBassOf(given.data, key));
  });

  it.each(FORM_NAMES)('numbers a progression in a key carried as %s', (form) => {
    const key = FORMS[form]();
    const carried = new Progression(chords(), key);
    expect(carried.roman()).toEqual(carried.chords.map((c) => chordToRoman(c.data, key)));
    const given = new Progression(chords());
    expect(given.roman(key)).toEqual(given.chords.map((c) => chordToRoman(c.data, key)));
  });

  it('answers the three spelled forms alike, and a bare scale as the library reads it', () => {
    const spelled = [FORMS.name(), FORMS.instance(), FORMS.data()].map((key) =>
      chord().withKey(key).figuredBass(),
    );
    expect(new Set(spelled).size).toBe(1);
    // Nothing in a bare scale says Ab minor rather than G# minor, so the answer
    // is the one the resolver's own spelling gives. Reaching the function API
    // with it means spelling it first, in as many words: the entry point no
    // longer takes a shape that cannot say which of the two it is.
    const bare = chord().withKey(FORMS.scale());
    expect(bare.figuredBass()).toBe(figuredBassOf(bare.data, resolveKey(FORMS.scale())));
  });
});
