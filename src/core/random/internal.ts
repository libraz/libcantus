/**
 * The hash behind hierarchical seeds and position-addressed draws.
 *
 * Both public entry points reduce a root seed plus a path to one 32-bit word,
 * so the mixing lives here once. The construction is FNV-1a (32-bit) over a
 * type-tagged byte encoding of the path, finished with the MurmurHash3 fmix32
 * avalanche step: FNV-1a alone leaves neighbouring inputs — `'drums'` against
 * `'drum'`, bar 1 against bar 2 — differing in only a few bits, and fmix32
 * spreads a one-bit input difference across the whole word so sibling paths
 * behave as unrelated seeds.
 *
 * Nothing here reads the platform: only code units, IEEE 754 bytes and 32-bit
 * integer arithmetic, so the same path yields the same word in every runtime
 * and every locale.
 */

import { InvalidInputError } from '../errors/index.js';
import { assertFiniteNumber } from '../validation/index.js';

/** Number of distinct values a 32-bit word takes; the divisor for a unit float. */
export const UINT32_RANGE = 4294967296;

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * Keyspace a hash belongs to.
 *
 * Derived seeds and positional draws are asked for at the same paths, so they
 * are hashed under different tags; without that, `at(...path)` would be the
 * unit-scaled `deriveSeed(seed, ...path)` and a generator using both at one
 * position would draw the same number twice.
 */
export const DOMAIN_SEED = 0x01;
export const DOMAIN_POSITION = 0x02;

/** Segment tags, so `'3'` and `3` never encode to the same bytes. */
const TAG_STRING = 0x01;
const TAG_NUMBER = 0x02;

/**
 * Scratch view for the IEEE 754 encoding of a numeric segment.
 *
 * Written and read within a single synchronous call, so the reuse is not
 * observable; it keeps the hot path — one draw per bar, beat and voice — free
 * of per-call allocation.
 */
const numberBytes = new DataView(new ArrayBuffer(8));

/** Absorb one byte into a running FNV-1a hash. */
function absorb(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** Absorb a 32-bit word, least significant byte first. */
function absorbUint32(hash: number, value: number): number {
  let next = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    next = absorb(next, (value >>> shift) & 0xff);
  }
  return next;
}

/**
 * MurmurHash3 32-bit finalizer.
 *
 * @param value The accumulated hash.
 * @returns The avalanched word.
 */
function fmix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/**
 * Absorb one path segment, tagged and length-prefixed.
 *
 * The length prefix is what keeps `['ab', 'c']` apart from `['a', 'bc']`: a
 * plain separator byte could itself appear inside a segment.
 */
function absorbSegment(hash: number, segment: string | number, index: number): number {
  if (typeof segment === 'string') {
    let next = absorb(hash, TAG_STRING);
    next = absorbUint32(next, segment.length);
    for (let i = 0; i < segment.length; i += 1) {
      // UTF-16 code units, low byte first: a fixed encoding of the string,
      // with no case folding or normalisation that a locale could steer.
      const unit = segment.charCodeAt(i);
      next = absorb(next, unit & 0xff);
      next = absorb(next, (unit >>> 8) & 0xff);
    }
    return next;
  }
  if (typeof segment === 'number') {
    // A path segment that is not a number at all would otherwise hash as one
    // fixed word (NaN) or two (the infinities), aliasing unrelated positions.
    assertFiniteNumber(segment, `seed path segment ${index}`);
    // Negative zero carries different bytes from zero while comparing equal,
    // which would make two paths a caller reads as identical derive apart.
    numberBytes.setFloat64(0, segment === 0 ? 0 : segment, true);
    let next = absorb(hash, TAG_NUMBER);
    for (let i = 0; i < 8; i += 1) {
      next = absorb(next, numberBytes.getUint8(i));
    }
    return next;
  }
  throw new InvalidInputError(
    `seed path segment ${index} must be a string or a number; received ${typeof segment}`,
  );
}

/**
 * Hash a root seed and a path to a 32-bit word within one keyspace.
 *
 * @param domain The keyspace tag.
 * @param root The validated root seed.
 * @param path The path segments.
 * @returns The mixed word in `[0, 0xffffffff]`.
 */
export function hashPath(domain: number, root: number, path: readonly (string | number)[]): number {
  let hash = absorb(FNV_OFFSET_BASIS, domain);
  hash = absorbUint32(hash, root);
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (segment === undefined) {
      throw new InvalidInputError(
        `seed path segment ${index} must be a string or a number; received undefined`,
      );
    }
    hash = absorbSegment(hash, segment, index);
  }
  return fmix32(hash);
}
