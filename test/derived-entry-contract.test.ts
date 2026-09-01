import { describe, expect, it } from 'vitest';
import { functionParams, type ParamInfo } from './support/signatures.js';

/**
 * The entry-contract check: what a function *says* it takes.
 *
 * A key or a meter reaches a function in several shapes, and the library
 * answers that with one resolver each. The resolver only helps where the
 * signature admits the shapes, though: a parameter declared as the narrow
 * `KeyScale` forces its caller to reduce a key before the call, and a key
 * reduced to its pitch classes has lost the spelled tonic and the scale form
 * for good. The loss is therefore written into the type, not into the body, and
 * that is what this check reads.
 *
 * The subject is derived from the tree, so a function added tomorrow is checked
 * without anybody adding it here. What is listed here is the opposite: the
 * sites that still violate the rule, which shrink to nothing as the contracts
 * are unified. A new violation fails the run; an old one is named with its file
 * and line.
 */

/** How a parameter is addressed in the lists below and in a failure message. */
function siteOf(param: ParamInfo): string {
  return `${param.file}:${param.fn}(${param.param})`;
}

/**
 * Modules allowed to speak in the narrow types, because they define them.
 *
 * A resolver has to take the shapes it resolves, and the module that owns a
 * concept is where the reduction to its narrow form belongs. Everywhere else
 * the narrow type in a signature is the defect.
 */
const NARROW_TYPE_OWNERS = ['src/core/types.ts', 'src/core/meter/', 'src/core/key/'];

/** The narrow carriers a signature must not ask for outside their owner. */
const NARROW_TYPES: Readonly<Record<string, string>> = {
  KeyScale: 'KeyLike',
  TimeSignature: 'MeterLike',
  MeterData: 'MeterLike',
  MeterMap: 'MeterLike',
};

/** Types that name a concept the caller may hand over in any shape. */
const CONCEPT_TYPES = ['KeyLike', 'MeterLike', 'IntervalLike', 'NoteLike', 'ChordLike'];

/**
 * Signatures whose subject *is* the narrow form.
 *
 * Validating a time signature and copying one are operations on the carrier
 * itself, not questions about which meter a passage is in, so they take the
 * carrier and are right to. This list is permanent, and short by design: a
 * fourth entry is a sign that the rule is being worked around rather than met.
 */
const NARROW_BY_DESIGN: readonly string[] = [
  'src/core/validation/index.ts:assertMeterMap(meters)',
  'src/core/validation/index.ts:assertTimeSignature(ts)',
  'src/model/shared.ts:copyTimeSignature(ts)',
];

/**
 * Parameters that still declare a narrow carrier.
 *
 * Every line is a place where the signature makes the caller throw information
 * away. The list is the migration's own measure: it is complete when empty.
 */
const NARROW_CARRIER_ALLOWED: readonly string[] = [
  'src/analyze/functional/augmented-sixth.ts:augmentedSixthFromSymbol(key)',
  'src/analyze/functional/augmented-sixth.ts:augmentedSixthKindOf(key)',
  'src/analyze/functional/augmented-sixth.ts:augmentedSixthOverBass(key)',
  'src/analyze/functional/augmented-sixth.ts:augmentedSixthSymbol(key)',
  'src/analyze/functional/borrowed.ts:borrowedSourceOf(key)',
  'src/analyze/functional/cadence.ts:cadenceBetween(key)',
  'src/analyze/functional/cadence.ts:isCadentialSixFour(key)',
  'src/analyze/functional/function.ts:functionWithReason(key)',
  'src/analyze/functional/internal.ts:degreeRootPc(key)',
  'src/analyze/functional/internal.ts:isDiatonicChord(key)',
  'src/analyze/functional/internal.ts:isMinorScale(key)',
  'src/analyze/functional/internal.ts:isNeapolitan(key)',
  'src/analyze/functional/internal.ts:loweredDegrees(key)',
  'src/analyze/functional/internal.ts:parallelScale(key)',
  'src/analyze/functional/internal.ts:romanReference(key)',
  'src/analyze/functional/pivot.ts:pivotsBetween(from)',
  'src/analyze/functional/pivot.ts:pivotsBetween(to)',
  'src/analyze/functional/roman.ts:renderRoman(key)',
  'src/analyze/functional/roman.ts:romanAlternatives(key)',
  'src/analyze/functional/tonicization.ts:appliedTarget(key)',
  'src/analyze/functional/tonicization.ts:isAppliedDominant(key)',
  'src/analyze/functional/tonicization.ts:tonicizableDegrees(key)',
  'src/analyze/melody/index.ts:relateMotifs(key)',
  'src/generate/bass/internal.ts:approachNote(key)',
  'src/generate/bass/internal.ts:beatPositions(ts)',
  'src/generate/harmonize/index.ts:buildCandidates(key)',
  'src/theory/counterpoint/index.ts:isLeadingToneResolution(key)',
  'src/theory/partwriting/index.ts:checkPartWriting(key)',
  'src/theory/partwriting/index.ts:spellVoicing(key)',
  'src/theory/partwriting/species.ts:checkSpecies(mode)',
  'src/theory/scale/relations.ts:spelledKeyOf(key)',
  'src/theory/scale/signature.ts:isSignatureKey(key)',
  'src/theory/scale/signature.ts:keySignatureFifths(key)',
  'src/theory/scale/system.ts:scaleSystemOf(scale)',
  'src/theory/scale/system.ts:supportsFunctionalHarmony(scale)',
  'src/theory/spelling/index.ts:assertTonicOf(key)',
  'src/theory/voicing/internal.ts:moveScoring(key)',
  'src/theory/voicing/internal.ts:resolutionTables(key)',
  'src/theory/voicing/internal.ts:structuralTables(key)',
  'src/theory/voicing/tendency.ts:isFunctioningLeadingTone(key)',
  'src/theory/voicing/tendency.ts:leadingTonePcOf(key)',
  'src/theory/voicing/tendency.ts:spellingTable(key)',
];

/**
 * Concept parameters that still carry a default.
 *
 * A default meter is a fail-open written in the type: a caller that forgets the
 * meter gets 4/4 rather than an error, and nothing downstream can tell the two
 * apart.
 */
const CONCEPT_DEFAULT_ALLOWED: readonly string[] = [
  'src/generate/motif/index.ts:developMotif(ts)',
  'src/generate/vocabulary/transform.ts:gridMetricWeight(ts)',
  'src/generate/vocabulary/transform.ts:thin(ts)',
];

/** Whether a file is one of the modules allowed to speak in narrow types. */
function ownsNarrowTypes(file: string): boolean {
  return NARROW_TYPE_OWNERS.some((owner) =>
    owner.endsWith('/') ? file.startsWith(owner) : file === owner,
  );
}

/** The narrow carrier a declared type asks for, if it asks for one. */
function narrowCarrierIn(type: string): string | null {
  for (const narrow of Object.keys(NARROW_TYPES)) {
    // The type is read as written, so `readonly KeyScale[]` and
    // `KeyScale | undefined` are both found, and `SomeKeyScaleThing` is not.
    if (new RegExp(`\\b${narrow}\\b`).test(type) && !/\bKeyLike\b|\bMeterLike\b/.test(type)) {
      return narrow;
    }
  }
  return null;
}

describe('entry contracts are declared in the wide form', () => {
  const params = functionParams().filter((param) => param.exported);

  it('asks for a concept, not for one of its carriers', () => {
    const violations = params
      .filter((param) => !ownsNarrowTypes(param.file))
      .filter((param) => narrowCarrierIn(param.type) !== null)
      .filter((param) => !NARROW_BY_DESIGN.includes(siteOf(param)))
      .filter((param) => !NARROW_CARRIER_ALLOWED.includes(siteOf(param)))
      .map((param) => {
        const narrow = narrowCarrierIn(param.type) as string;
        return `${param.file}:${param.line} ${param.fn}(${param.param}: ${param.type}) should take ${NARROW_TYPES[narrow]}`;
      });

    expect(violations).toEqual([]);
  });

  it('gives no concept parameter a default', () => {
    const violations = params
      .filter((param) => param.hasDefault)
      .filter((param) =>
        CONCEPT_TYPES.some((concept) => new RegExp(`\\b${concept}\\b`).test(param.type)),
      )
      .filter((param) => !CONCEPT_DEFAULT_ALLOWED.includes(siteOf(param)))
      .map(
        (param) =>
          `${param.file}:${param.line} ${param.fn}(${param.param}: ${param.type}) defaults instead of asking`,
      );

    expect(violations).toEqual([]);
  });

  it('holds no allowance for a site that no longer offends', () => {
    // Without this, a contract that was unified leaves its line behind, and the
    // list stops measuring the debt it exists to measure. An entry removed by
    // the same commit that fixes the site is the intended workflow.
    const offending = new Set(
      params.filter((param) => narrowCarrierIn(param.type) !== null).map(siteOf),
    );
    const stale = [...NARROW_BY_DESIGN, ...NARROW_CARRIER_ALLOWED].filter(
      (site) => !offending.has(site),
    );

    expect(stale).toEqual([]);
  });

  it('reads a subject the tree supplies rather than a list', () => {
    // The guard on the guard: were the walk to return nothing, both checks
    // above would pass while measuring nothing at all.
    expect(params.length).toBeGreaterThan(500);
  });
});
