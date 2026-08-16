import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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
  'ALGORITHM_VERSION',
  'ALTERED_MASK',
  'ARTICULATIONS',
  'BAR_STEPS',
  'BASS_4_STRING',
  'BASS_5_STRING',
  'BASS_LICKS',
  'BASS_STYLES',
  'BEAT_STEPS',
  'BLUES_MASK',
  'BORROWED_DEGREES',
  'BudgetExceededError',
  'CHROMATIC_MASK',
  'Chord',
  'Composer',
  'ConsonanceClass',
  'DEFAULT_GENERATION_BUDGET',
  'DORIAN_MASK',
  'DOUBLE_HARMONIC_MASK',
  'DRUM_KIT',
  'DRUM_NOTES',
  'DRUM_PATTERNS',
  'Duration',
  'FILL_ARCHETYPES',
  'FILL_TYPES',
  'GENRES',
  'GUITAR_DROP_D',
  'GUITAR_STANDARD',
  'HARMONIC_MINOR_MASK',
  'Instrument',
  'Interval',
  'InvalidInputError',
  'JUST_RATIOS',
  'KICK_FIGURES',
  'KICK_STEPS',
  'Key',
  'LIMBS',
  'LOCRIAN_MASK',
  'LOCRIAN_NATURAL2_MASK',
  'LYDIAN_DOMINANT_MASK',
  'LYDIAN_MASK',
  'MAJOR_MASK',
  'MAJOR_PENTATONIC_MASK',
  'MARWA_MASK',
  'MAX_DIFFICULTY',
  'MELODIC_MINOR_MASK',
  'MINOR_PENTATONIC_MASK',
  'MIN_ALGORITHM_VERSION',
  'MIN_DIFFICULTY',
  'MIXOLYDIAN_B13_MASK',
  'MIXOLYDIAN_MASK',
  'MIYAKO_BUSHI_MASK',
  'MODAL_SCALE_NAMES',
  'Meter',
  'NAMED_SCALES',
  'NATURAL_MINOR_MASK',
  'NOTE_VALUES',
  'NoSolutionError',
  'Note',
  'NoteSafety',
  'OCTATONIC_HALF_WHOLE_MASK',
  'OCTATONIC_WHOLE_HALF_MASK',
  'ORNAMENT_STYLES',
  'PHRYGIAN_DOMINANT_MASK',
  'PHRYGIAN_MASK',
  'PROFILE_WEIGHTS',
  'PROVENANCE_BASES',
  'PURVI_MASK',
  'Progression',
  'RITSU_MASK',
  'RYUKYU_MASK',
  'ReasonFlag',
  'SATB_RANGES',
  'Score',
  'SCALE_ALIASES',
  'SCALE_SYSTEMS',
  'STEP_BEATS',
  'TODI_MASK',
  'TRANSPOSING_INSTRUMENTS',
  'TWELVE_TET',
  'Tempo',
  'Timeline',
  'Tuning',
  'Voicing',
  'WHOLE_TONE_MASK',
  'WORLD_SCALES',
  'analyzeArrangement',
  'analyzeChord',
  'analyzeVoice',
  'applyGrooveTemplate',
  'assertDegree',
  'assertFiniteNumber',
  'assertFiniteSemitones',
  'assertGenerationBudget',
  'assertInteger',
  'assertMeterMap',
  'assertMidiPitch',
  'assertNoteEvent',
  'assertNoteEvents',
  'assertOneOf',
  'assertPositiveInt',
  'assertRange',
  'assertTimeSignature',
  'assertVocabulary',
  'augmentedSixthChord',
  'augmentedSixthFromPitchClasses',
  'augmentedSixthKind',
  'availableTensions',
  'avoidNotes',
  'barIndexAt',
  'barPositionToBeat',
  'barPositionToPulse',
  'barStartBeat',
  'beatToBarPosition',
  'beatsPerBar',
  'beatsPerBarAt',
  'beatsToDuration',
  'beatsToSeconds',
  'beatsToTicks',
  'beatsToTiedDurations',
  'borrowedSource',
  'canSound',
  'centsBetweenFreq',
  'centsFromNearestStep',
  'centsOfSteps',
  'centsToRatio',
  'checkPartWriting',
  'checkSpecies',
  'chordFromDegree',
  'chordFromSpan',
  'chordFromSpec',
  'chordPitchClasses',
  'chordQualities',
  'chordScaleReport',
  'chordScales',
  'chordSpecIntervals',
  'chordSpecOf',
  'chordSpecQuality',
  'chordTimelineFromChords',
  'chordTimelineFromNotes',
  'chordToRoman',
  'chordToneRole',
  'clampToMidi',
  'classifyInterval',
  'classifyMelodyTones',
  'classifySpelledInterval',
  'compareMelodies',
  'createArrangementSession',
  'createNoteEventIndex',
  'createPositionalRng',
  'createRng',
  'createsBattuta',
  'createsHiddenParallelPerfect',
  'createsParallelOctave',
  'createsParallelPerfect',
  'createsParallelUnison',
  'createsVerticalDissonance',
  'createsVoiceCrossing',
  'createsVoiceOverlap',
  'deform',
  'deriveSeed',
  'detectCadence',
  'detectCadences',
  'detectChord',
  'detectChordBest',
  'detectKey',
  'detectKeyBest',
  'detectKeyFromNotes',
  'detectModulations',
  'detectNoteNameSystem',
  'developMotif',
  'diatonicLetterOf',
  'diatonicPitchClasses',
  'diatonicSeventh',
  'diatonicTriad',
  'dominantKeyOf',
  'double',
  'doubleTime',
  'dropSilentNotes',
  'drumVoiceOf',
  'durationToBeats',
  'durationToSeconds',
  'edo',
  'enharmonicKeyOf',
  'enumerateSafePitches',
  'evaluateSafety',
  'exceedsSpacing',
  'explainRoman',
  'extractGrooveTemplate',
  'extractMotifs',
  'figuredBassOf',
  'figuredBassRealization',
  'fingeringsFor',
  'fitsQuery',
  'foldIntoRange',
  'formatBarPosition',
  'formatChordSymbol',
  'formatKeyName',
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
  'gridMetricWeight',
  'halfTime',
  'harmonizeMelody',
  'humanize',
  'hypermeter',
  'imitate',
  'includeAt',
  'instrumentRange',
  'instrumentTransposition',
  'intervalAboveRoot',
  'intervalSemitones',
  'isAugmentedMelodicInterval',
  'isBorrowedChord',
  'isChordMember',
  'isCompound',
  'isConsonantInterval',
  'isDiatonic',
  'isDrumPattern',
  'isFillArchetype',
  'isForbiddenMelodicLeap',
  'isLeadingToneResolution',
  'isLibcantusError',
  'isLickMaterial',
  'isMinorKey',
  'isPerfectInterval',
  'isScaleTone',
  'isStrongBeat',
  'justDeviationCents',
  'keyFromFifths',
  'keyRelationBetween',
  'keySignatureFifths',
  'keyTimelineFromNotes',
  'majorKey',
  'makeChord',
  'maskFromOffsets',
  'melodicContour',
  'melodicSimilarity',
  'mergeVocabulary',
  'meterAt',
  'metricWeight',
  'midiToNote',
  'minorKey',
  'modalInterchangePalette',
  'motifFromNotes',
  'motifToNoteEvents',
  'namedScaleMask',
  'naturalPitchClassOf',
  'nearestScaleTone',
  'nearestStep',
  'negativeHarmonyMirror',
  'nextVoicing',
  'noteNames',
  'noteToMidi',
  'noteToPitchClass',
  'onsetWeightCurve',
  'ornament',
  'ornamentBy',
  'parallelKey',
  'parallelKeyOf',
  'parseChordSymbol',
  'parseInterval',
  'parseKeyName',
  'parseNote',
  'parseTimeSignature',
  'phrasesFromTimeline',
  'pickProgressionPreset',
  'pickVocabulary',
  'pitchClassOf',
  'pitchToScaleDegree',
  'pivotChords',
  'placeDrumPattern',
  'placeLicks',
  'playability',
  'prevailingKeyOf',
  'profileWeights',
  'progressions',
  'progressionsByStyle',
  'pulseBeats',
  'pulsesPerBar',
  'ratioToCents',
  'realizeFiguredBass',
  'reduceProgression',
  'relateMotifs',
  'relatedKeysOf',
  'relativeKeyOf',
  'requireScaleMask',
  'resolveAlgorithmVersion',
  'resolveContext',
  'resolveMeters',
  'resolveScaleName',
  'rhythmDensity',
  'rhythmToNoteEvents',
  'roleOf',
  'romanToChord',
  'scaleByName',
  'scaleMatchesChord',
  'scaleSystemOf',
  'scaleTonesInDegreeOrder',
  'scalesForChanges',
  'secondaryDominant',
  'secondaryDominantOf',
  'secondsToBeats',
  'sectionsFromNotes',
  'selectVocabulary',
  'soundingNotesOnly',
  'spanFromChord',
  'spellAugmentedSixth',
  'spellChord',
  'spellChordFromRoot',
  'spellLine',
  'spellPitch',
  'spellPitchClass',
  'spellPitchClasses',
  'spellScale',
  'spellVoicing',
  'spelledInterval',
  'spelledKeyOf',
  'stepOf',
  'stepsOfCents',
  'structuralCadences',
  'subdominantKeyOf',
  'substituteChord',
  'supportsFunctionalHarmony',
  'sustainsShift',
  'sustainsStrokes',
  'syncopate',
  'tempoAt',
  'tensionCurve',
  'tensionCurveFrom',
  'thin',
  'ticksToBeats',
  'toChordData',
  'toKeyScale',
  'toNoteData',
  'toSoundingPitch',
  'toSpelledInterval',
  'toVoiceNotes',
  'toWrittenPitch',
  'transformMotif',
  'transposeByInterval',
  'transposeChord',
  'transposeChordSymbol',
  'transposeNote',
  'tryParseChordSymbol',
  'tryParseInterval',
  'tryParseKeyName',
  'tryParseNote',
  'tryParseTimeSignature',
  'tuplet',
  'vocabularyOfKind',
  'voiceChord',
  'voiceChordStyled',
  'voiceIndependence',
  'voiceLeadingCost',
  'voiceProgression',
  'withinCeiling',
];

/** Every layer barrel, in the order the root re-exports them. */
const LAYERS = { core, theory, analyze, generate, model } as const;

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const ROOT_ENTRY = path.join(SRC, 'index.ts');

/** `{@link Target}`, `{@link Target | text}`, and the `{@link}` form of `@see`. */
const INLINE_LINK = /\{@link(?:code|plain)?\s+([^}|\s]+)[^}]*\}/g;

/** A bare `@see Target`, which carries no braces. */
const BARE_SEE = /@see\s+(?!\{)([^\s\n*]+)/g;

/** The symbol a link names, without the member or the punctuation after it. */
function linkTarget(raw: string): string | null {
  const base = (raw.split(/[.#]/)[0] ?? '').replace(/[(),;:]+$/, '');
  return /^[A-Za-z_$][\w$]*$/.test(base) ? base : null;
}

/** Doc comments written on `node` itself, source text and all. */
function docsOn(node: ts.Node): string[] {
  return ts
    .getJSDocCommentsAndTags(node)
    .filter(ts.isJSDoc)
    .map((doc) => doc.getFullText());
}

/**
 * Every doc comment the API reference ships for a public symbol: the one on the
 * declaration, plus the ones on the members a class, an interface, or an object
 * type alias documents field by field.
 */
function publicDocs(symbol: ts.Symbol): string[] {
  const out: string[] = [];
  for (const declaration of symbol.getDeclarations() ?? []) {
    if (!declaration.getSourceFile().fileName.startsWith(SRC)) {
      continue;
    }
    out.push(...docsOn(declaration));
    const members =
      ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)
        ? declaration.members
        : ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)
          ? declaration.type.members
          : undefined;
    for (const member of members ?? []) {
      out.push(...docsOn(member));
    }
  }
  return out;
}

describe('documented cross-references', () => {
  it('resolves every link a public doc comment makes to a public symbol', () => {
    // The barrel chain is what a doc comment promises when it says "call this",
    // and a symbol that never reached it leaves the reader with a name they
    // cannot import and the API reference with a dangling link. Listing the
    // exports cannot catch that; only reading the comments can.
    const config = ts.readConfigFile(path.join(SRC, '..', 'tsconfig.json'), ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(SRC, '..'));
    const program = ts.createProgram([ROOT_ENTRY], { ...options.options, noEmit: true });
    const checker = program.getTypeChecker();
    const entry = program.getSourceFile(ROOT_ENTRY);
    if (entry === undefined) {
      throw new Error('the root barrel is missing from the program');
    }
    const entrySymbol = checker.getSymbolAtLocation(entry);
    if (entrySymbol === undefined) {
      throw new Error('the root barrel exports nothing');
    }

    const exported = checker.getExportsOfModule(entrySymbol);
    const publicNames = new Set(exported.map((symbol) => symbol.name));
    const unreachable: string[] = [];

    for (const alias of exported) {
      const symbol = alias.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(alias) : alias;
      for (const doc of publicDocs(symbol)) {
        for (const pattern of [INLINE_LINK, BARE_SEE]) {
          pattern.lastIndex = 0;
          for (const match of doc.matchAll(pattern)) {
            const target = linkTarget(match[1] ?? '');
            if (target !== null && !publicNames.has(target)) {
              unreachable.push(`${alias.name} -> ${target}`);
            }
          }
        }
      }
    }

    expect([...new Set(unreachable)].sort()).toEqual([]);
  });
});

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
