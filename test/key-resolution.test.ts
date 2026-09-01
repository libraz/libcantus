import { describe, expect, it } from 'vitest';
import { formatNote } from '../src/core/pitch/index.js';
import { Key } from '../src/model/key.js';
import {
  assertKeyVariant,
  majorKey,
  minorKey,
  resolveKey,
  scaleByName,
  scaleOf,
} from '../src/theory/scale/index.js';
import { MAJOR_MASK } from '../src/theory/scale/masks.js';

/**
 * A key is three facts, and this is the reading that keeps all three.
 *
 * Reducing a key to its pitch classes is what the layers below the class API
 * used to get by default, and what they handed back was spelled from whichever
 * side of the circle read best rather than from the side the caller wrote.
 * These check that the three facts survive the reading, and that dropping two
 * of them is something a caller asks for by name.
 *
 * Where those facts have to survive a whole score or timeline is
 * `key-identity.test.ts`; this is the reading itself.
 */

describe('resolving a key keeps what the key knows', () => {
  it('spells a bare scale the way the theory layer spells it', () => {
    expect(formatNote(resolveKey(majorKey(1)).tonic)).toBe('Db');
    expect(formatNote(resolveKey(majorKey(0)).tonic)).toBe('C');
  });

  it('reads the scale form from the mask rather than defaulting it away', () => {
    expect(resolveKey(majorKey(0)).variant).toBe('major');
    expect(resolveKey(minorKey(9)).variant).toBe('natural');
    expect(resolveKey(scaleByName('harmonicMinor', 9)).variant).toBe('harmonic');
    expect(resolveKey(scaleByName('melodicMinor', 9)).variant).toBe('melodic');
  });

  it('calls a scale standing in none of the four forms modal', () => {
    expect(resolveKey(scaleByName('dorian', 2)).variant).toBe('modal');
  });

  it("keeps the caller's spelling over the one it would have chosen", () => {
    // The defect this reading exists to prevent: an Ab minor handed down and a
    // G# minor handed back, which is a different key signature on the page.
    const chosen = formatNote(resolveKey(minorKey(8)).tonic);
    const carried = formatNote(
      resolveKey({ scale: minorKey(8), tonic: { letter: 5, alter: -1 } }).tonic,
    );

    expect(carried).toBe('Ab');
    expect(carried).not.toBe(chosen);
  });

  it('keeps the spelling a Key was built with', () => {
    expect(formatNote(resolveKey(Key.minor('Ab')).tonic)).toBe('Ab');
    expect(formatNote(resolveKey(Key.minor('G#')).tonic)).toBe('G#');
  });

  it('keeps the scale form a Key was built with', () => {
    expect(resolveKey(Key.named('harmonicMinor', 'A')).variant).toBe('harmonic');
  });

  it('reads a key name', () => {
    expect(resolveKey('C major').scale).toEqual(majorKey(0));
    expect(resolveKey('A minor').variant).toBe('natural');
  });

  it('refuses a value that names no key', () => {
    expect(() => resolveKey(42 as never)).toThrow();
    expect(() => resolveKey({ rootPc: 0, modeMask12: 0 } as never)).toThrow();
  });
});

describe('reducing a key says its own name', () => {
  it('hands back the pitch classes alone', () => {
    expect(scaleOf(resolveKey('C major'))).toEqual(majorKey(0));
  });

  it('is the same scale the narrow reading gives', () => {
    // The two readings agree about the pitch classes; they differ only in what
    // else survives, which is the whole point of having both.
    expect(scaleOf(resolveKey(Key.minor('Ab')))).toEqual(minorKey(8));
  });
});

describe('a scale form has to match the mask it is claimed for', () => {
  it('accepts the form the mask holds', () => {
    expect(() => assertKeyVariant('major', MAJOR_MASK)).not.toThrow();
  });

  it('refuses a form the mask does not hold', () => {
    expect(() => assertKeyVariant('harmonic', MAJOR_MASK)).toThrow(/does not match/);
  });

  it('refuses a form no key stands in', () => {
    expect(() => assertKeyVariant('lydian' as never, MAJOR_MASK)).toThrow();
  });
});
