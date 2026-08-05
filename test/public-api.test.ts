import { describe, expect, it } from 'vitest';
import * as analyze from '../src/analyze/index.js';
import * as core from '../src/core/index.js';
import * as generate from '../src/generate/index.js';
import * as api from '../src/index.js';
import * as model from '../src/model/index.js';
import * as theory from '../src/theory/index.js';

/**
 * Guards the public runtime surface against accidental loss during refactors.
 * When an export is intentionally renamed or removed, update this list in the
 * same commit so the diff reads as the rename table itself.
 */
const EXPECTED_EXPORTS = [
  'ALTERED_MASK',
  'BudgetExceededError',
  'BASS_STYLES',
  'BLUES_MASK',
  'BORROWED_DEGREES',
  'CHROMATIC_MASK',
  'Chord',
  'DEFAULT_GENERATION_BUDGET',
  'DRUM_NOTES',
  'DORIAN_MASK',
  'HARMONIC_MINOR_MASK',
  'Interval',
  'ConsonanceClass',
  'JUST_RATIOS',
  'Key',
  'LOCRIAN_MASK',
  'LOCRIAN_NATURAL2_MASK',
  'LYDIAN_DOMINANT_MASK',
  'LYDIAN_MASK',
  'MAJOR_MASK',
  'MAJOR_PENTATONIC_MASK',
  'MELODIC_MINOR_MASK',
  'MINOR_PENTATONIC_MASK',
  'MIXOLYDIAN_B13_MASK',
  'MIXOLYDIAN_MASK',
  'NAMED_SCALES',
  'NATURAL_MINOR_MASK',
  'Note',
  'NoteSafety',
  'OCTATONIC_HALF_WHOLE_MASK',
  'OCTATONIC_WHOLE_HALF_MASK',
  'PHRYGIAN_DOMINANT_MASK',
  'PHRYGIAN_MASK',
  'Progression',
  'ReasonFlag',
  'SATB_RANGES',
  'TWELVE_TET',
  'WHOLE_TONE_MASK',
  'analyzeArrangement',
  'analyzeChord',
  'analyzeVoice',
  'applyGrooveTemplate',
  'assertFiniteNumber',
  'assertFiniteSemitones',
  'assertDegree',
  'assertGenerationBudget',
  'assertInteger',
  'assertMidiPitch',
  'assertNoteEvent',
  'assertNoteEvents',
  'assertOneOf',
  'assertPositiveInt',
  'assertRange',
  'assertTimeSignature',
  'availableTensions',
  'avoidNotes',
  'barPositionToBeat',
  'barPositionToPulse',
  'beatToBarPosition',
  'beatsPerBar',
  'borrowedSource',
  'centsBetweenFreq',
  'centsFromNearestStep',
  'centsOfSteps',
  'centsToRatio',
  'chordFromDegree',
  'chordPitchClasses',
  'chordQualities',
  'chordScaleReport',
  'chordScales',
  'chordTimelineFromChords',
  'chordTimelineFromNotes',
  'chordToRoman',
  'chordToneRole',
  'classifyInterval',
  'clampToMidi',
  'createNoteEventIndex',
  'createRng',
  'createsHiddenParallelPerfect',
  'createsParallelOctave',
  'createsParallelPerfect',
  'createsParallelUnison',
  'createsVerticalDissonance',
  'createsVoiceCrossing',
  'createsVoiceOverlap',
  'detectCadence',
  'detectCadences',
  'detectChord',
  'detectChordBest',
  'diatonicLetterOf',
  'detectKey',
  'detectKeyBest',
  'detectKeyFromNotes',
  'dropSilentNotes',
  'soundingNotesOnly',
  'developMotif',
  'diatonicPitchClasses',
  'diatonicSeventh',
  'diatonicTriad',
  'drumVoiceOf',
  'edo',
  'enumerateSafePitches',
  'evaluateSafety',
  'exceedsSpacing',
  'extractGrooveTemplate',
  'formatBarPosition',
  'formatChordSymbol',
  'formatNote',
  'formatTimeSignature',
  'frequencyOf',
  'functionOf',
  'generateBassLine',
  'generateCounterMelody',
  'generateDrums',
  'generateMotif',
  'generateProgression',
  'generateRhythm',
  'harmonizeMelody',
  'humanize',
  'isBorrowedChord',
  'InvalidInputError',
  'NoSolutionError',
  'intervalAboveRoot',
  'isChordMember',
  'isCompound',
  'isConsonantInterval',
  'isLibcantusError',
  'isDiatonic',
  'isForbiddenMelodicLeap',
  'isLeadingToneResolution',
  'isMinorKey',
  'isPerfectInterval',
  'isScaleTone',
  'intervalSemitones',
  'isStrongBeat',
  'justDeviationCents',
  'majorKey',
  'makeChord',
  'maskFromOffsets',
  'metricWeight',
  'midiToNote',
  'minorKey',
  'modalInterchangePalette',
  'motifToNoteEvents',
  'nearestScaleTone',
  'namedScaleMask',
  'naturalPitchClassOf',
  'nearestStep',
  'negativeHarmonyMirror',
  'nextVoicing',
  'noteNames',
  'noteToMidi',
  'noteToPitchClass',
  'onsetWeightCurve',
  'parallelKey',
  'parseChordSymbol',
  'parseInterval',
  'parseNote',
  'parseTimeSignature',
  'pickProgressionPreset',
  'pitchClassOf',
  'pitchToScaleDegree',
  'progressions',
  'progressionsByStyle',
  'pulseBeats',
  'pulsesPerBar',
  'ratioToCents',
  'requireScaleMask',
  'rhythmDensity',
  'rhythmToNoteEvents',
  'roleOf',
  'romanToChord',
  'scaleByName',
  'scaleMatchesChord',
  'scaleTonesInDegreeOrder',
  'scalesForChanges',
  'secondaryDominant',
  'spellChord',
  'spellChordFromRoot',
  'spellPitch',
  'spellPitchClass',
  'spellPitchClasses',
  'spellScale',
  'spelledInterval',
  'stepOf',
  'stepsOfCents',
  'substituteChord',
  'tensionCurve',
  'tensionCurveFrom',
  'transformMotif',
  'toVoiceNotes',
  'transposeByInterval',
  'transposeChord',
  'transposeChordSymbol',
  'transposeNote',
  'tuplet',
  'voiceChord',
  'voiceChordStyled',
  'voiceLeadingCost',
  'voiceProgression',
];

/** Every layer barrel, in the order the root re-exports them. */
const LAYERS = { core, theory, analyze, generate, model } as const;

describe('public API surface', () => {
  it('exports exactly the expected runtime members', () => {
    const actual = Object.keys(api).sort();
    expect(actual).toEqual([...EXPECTED_EXPORTS].sort());
  });

  it('reaches every root member through the layer subpath that owns it', () => {
    // Derived rather than listed: the root barrel is five `export *` lines, so
    // a name the root still has but a layer barrel lost is a subpath consumer's
    // break that the root-only list above cannot see.
    const fromLayers = new Set(Object.values(LAYERS).flatMap((layer) => Object.keys(layer)));
    expect([...Object.keys(api)].filter((name) => !fromLayers.has(name))).toEqual([]);
    expect([...fromLayers].filter((name) => !(name in api)).sort()).toEqual([]);
  });

  it('keeps the model API aligned with its functional counterparts', () => {
    const key = model.Key.major('C');
    const chord = key.roman('V7/V');
    const progression = new model.Progression([chord, key.roman('V7'), key.roman('I')], key);
    const romanOpts = { applied: true };

    expect(chord.roman(undefined, romanOpts)).toBe(
      api.chordToRoman(chord.data, key.scale, romanOpts),
    );
    expect(progression.analyze(undefined, romanOpts).chords).toEqual(
      progression.chords.map((item) => api.analyzeChord(item.data, key.scale, romanOpts)),
    );
    expect(progression.scales()).toEqual(
      api.scalesForChanges(progression.chords.map((item) => item.data)),
    );

    const pitches = [57, 59, 60, 62, 64, 65, 68];
    expect(model.Key.detectMatches(pitches)).toEqual(
      api.detectKey(pitches).map((match) => ({
        ...match,
        key: expect.objectContaining({
          scale: match.key,
          variant: match.variant,
        }),
      })),
    );
  });
});
