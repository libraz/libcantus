import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
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
 * The rule applies to entry points, which is where a caller's own value first
 * meets the library.
 *
 * Below an entry point the key has already been read, and passing the pitch
 * classes inward is both correct and what the library already does — a
 * generator reads its key once at the boundary and hands the plain form down.
 * Widening the inner helpers too would put a resolve inside the voicing search
 * and buy nothing: the caller's spelling is already safe by then, held by the
 * entry point that read it.
 *
 * So reachability from the package root is what decides. A function a caller
 * can call is a function whose signature has to admit what a caller holds.
 */
const ENTRY_POINTS: ReadonlySet<string> = new Set(
  Object.entries(api as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name),
);

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
 * Entry points whose subject *is* the narrow form, each with why.
 *
 * Permanent, and short by design: an entry added here without one of these
 * reasons is the rule being worked around rather than met.
 */
const NARROW_BY_DESIGN: readonly string[] = [
  // Validating a time signature and a meter map are operations on the carrier
  // itself, not questions about which meter a passage is in.
  'src/core/validation/index.ts:assertMeterMap(meters)',
  'src/core/validation/index.ts:assertTimeSignature(ts)',
  // What the key resolver is built on. Spelling a tonic is how a bare scale
  // becomes a whole key, so these two run before there is a whole key to take,
  // and widening them would have the resolver call itself.
  'src/theory/scale/relations.ts:spelledKeyOf(key)',
  'src/theory/scale/signature.ts:isSignatureKey(key)',
  // The subject is a scale, not a key standing on one. Widening would also make
  // a string ambiguous: 'dorian' names the scale and 'C major' names a key.
  'src/theory/scale/system.ts:scaleSystemOf(scale)',
  'src/theory/scale/system.ts:supportsFunctionalHarmony(scale)',
];

/**
 * Entry points that still declare a narrow carrier.
 *
 * Every line would be a place where the signature makes the caller throw
 * information away before the call. Empty, and meant to stay so: a new entry
 * here is a contract that was written narrow, not a debt that was inherited.
 */
const NARROW_CARRIER_ALLOWED: readonly string[] = [];

/**
 * Concept parameters that still carry a default.
 *
 * A default meter is a fail-open written in the type: a caller that forgets the
 * meter gets 4/4 rather than an error, and nothing downstream can tell the two
 * apart. These three defend the default on the grounds that the built-in
 * figures really are written on a 4/4 grid, which is true and still leaves a
 * caller working in 7/8 no way to hear that they forgot. Removing it makes the
 * meter a required argument, which is a change to a published signature and so
 * is held for the next major rather than taken quietly here.
 */
const CONCEPT_DEFAULT_ALLOWED: readonly string[] = [
  'src/generate/motif/index.ts:developMotif(ts)',
  'src/generate/vocabulary/transform.ts:gridMetricWeight(ts)',
  'src/generate/vocabulary/transform.ts:thin(ts)',
];

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
  const params = functionParams().filter((param) => param.exported && ENTRY_POINTS.has(param.fn));

  it('asks for a concept, not for one of its carriers', () => {
    const violations = params
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
    expect(params.length).toBeGreaterThan(200);
  });
});
