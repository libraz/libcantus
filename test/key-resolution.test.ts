import { describe, expect, it } from 'vitest';
import type { SpelledKeyScale } from '../src/analyze/keys/index.js';
import { formatNote } from '../src/core/pitch/index.js';
import { Key } from '../src/model/key.js';
import {
  assertKeyVariant,
  majorKey,
  minorKey,
  resolveKey,
  scaleByName,
  scaleOf,
  toKeyScale,
  tryResolveKeyName,
} from '../src/theory/scale/index.js';
import { MAJOR_MASK, NAMED_SCALES, type ScaleName } from '../src/theory/scale/masks.js';

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

  it('reads a spelling written beside a scale rather than inside it', () => {
    // A key region lays its key out flat, so the spelling sits next to the
    // pitch classes instead of around them. The resolver reads it there; this
    // states the shape it reads, which the type used to deny while the
    // implementation relied on it.
    const region: SpelledKeyScale = {
      ...minorKey(8),
      tonic: { letter: 5, alter: -1 },
      variant: 'natural',
    };

    expect(formatNote(resolveKey(region).tonic)).toBe('Ab');
    expect(resolveKey(region).variant).toBe('natural');
    // Not vacuous: the same pitch classes with nothing written beside them.
    expect(formatNote(resolveKey(minorKey(8)).tonic)).toBe('G#');
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

  it('keeps the tonic the name spells rather than choosing one again', () => {
    // A name is the plainest way a caller says which side of the circle they
    // mean, and the two names below denote the same pitch classes. A reading
    // that dropped the letter would have to guess it back, and the guess reads
    // both as the sharp side.
    expect(formatNote(resolveKey('Ab minor').tonic)).toBe('Ab');
    expect(formatNote(resolveKey('G# minor').tonic)).toBe('G#');
    expect(formatNote(resolveKey('Cb major').tonic)).toBe('Cb');
    expect(formatNote(resolveKey('D# major').tonic)).toBe('D#');
    // The guess, for contrast: the same pitch classes with no letter to keep.
    expect(formatNote(resolveKey(minorKey(8)).tonic)).toBe('G#');
  });

  it('reads a name that carries a scale word', () => {
    expect(resolveKey('D dorian').scale).toEqual(scaleByName('dorian', 2));
    expect(resolveKey('D dorian').variant).toBe('modal');
    expect(resolveKey('D harmonic minor').variant).toBe('harmonic');
    expect(formatNote(resolveKey('Eb melodic minor').tonic)).toBe('Eb');
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

describe('every entry point reads a key name from one vocabulary', () => {
  /**
   * A name for each built-in scale, written the way a key writes itself. Taken
   * from the table rather than listed here, so a scale added tomorrow is
   * carried into this check without anybody remembering to add it.
   */
  const NAMES = (Object.keys(NAMED_SCALES) as ScaleName[]).map(
    (name) => `C ${name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()}`,
  );

  it.each(NAMES)('%s names the same key to all three readings', (text) => {
    const resolved = resolveKey(text);
    expect(toKeyScale(text)).toEqual(resolved.scale);
    expect(resolveKey(Key.parse(text))).toEqual(resolved);
  });

  it('reads a plain mode word in the notation system it is written in', () => {
    // The scale words are English; a mode word is not, and reducing the reading
    // to one table would have silently dropped the other notations.
    expect(resolveKey(Key.parse('gis moll'))).toEqual(resolveKey('G# minor'));
    expect(resolveKey(Key.parse('B dur'))).toEqual(resolveKey('Bb major'));
  });

  it('reports text that names no key instead of throwing it', () => {
    const failed = tryResolveKeyName('H lydianish');
    expect(failed.ok).toBe(false);
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
