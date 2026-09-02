import { type ParseResult, unwrapParse } from '../../core/errors/index.js';
import type { Note, NoteNameOptions } from '../../core/pitch/index.js';
import { noteToPitchClass, tryParseKeyName, tryParseNote } from '../../core/pitch/index.js';
import type { ResolvedKey } from './kinds.js';
import {
  NAMED_SCALES,
  SCALE_ALIASES,
  type ScaleAliasName,
  type ScaleName,
  variantOfMask,
  WORLD_SCALES,
  type WorldScaleName,
} from './masks.js';
import { majorScale, minorScale, namedScale } from './scales.js';

/**
 * Reading a key from the name it is written under.
 *
 * One reader, because a name carries the two facts that are lost when the same
 * text is read twice: which letter the tonic is spelled on, and which scale form
 * the word names. A second reader that answers only the first is how `'Ab
 * minor'` came back spelled `'G# minor'` — the name said Ab and the reading
 * discarded it, so the spelling had to be guessed again from the pitch classes,
 * and the guess reads the flat side of the circle as sharps.
 */

/** A scale word with its spacing and case dropped, so two spellings compare. */
function scaleWordKey(text: string): string {
  return text.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Every name a built-in scale answers to, canonical names before aliases. */
const BUILT_IN_SCALE_NAMES: readonly (ScaleName | WorldScaleName | ScaleAliasName)[] = [
  ...(Object.keys(NAMED_SCALES) as ScaleName[]),
  ...(Object.keys(WORLD_SCALES) as WorldScaleName[]),
  ...(Object.keys(SCALE_ALIASES) as ScaleAliasName[]),
];

/**
 * The built-in scale each scale word names, indexed the way names compare.
 *
 * Every register a scale can be built from is here, because a name
 * {@link scaleByName} accepts is a name a key can be written under, and a word
 * this map does not hold is a key that cannot be read back from its own text.
 */
const SCALE_BY_WORD: ReadonlyMap<string, ScaleName | WorldScaleName | ScaleAliasName> = new Map(
  BUILT_IN_SCALE_NAMES.map((name) => [scaleWordKey(name), name]),
);

/**
 * The scale word a mask is written with, or undefined when no built-in scale
 * has that mask.
 *
 * The inverse of {@link SCALE_BY_WORD}, and the reason a key on a scale outside
 * the Western vocabulary prints as itself: the miyako-bushi scale names the five
 * pitch classes it actually holds rather than the major key its tonic sits in.
 *
 * The first name declared with the mask answers, so a mask several traditions
 * name reads under the Western name where there is one — the min'yō scale prints
 * as the minor pentatonic it shares its pitch classes with — and the register
 * order is what settles it rather than a table of exceptions.
 *
 * @param mask The 12-bit mode mask.
 * @returns The scale name, or undefined for a mask no built-in scale has.
 */
export function scaleNameOfMask(mask: number): ScaleName | WorldScaleName | undefined {
  for (const name of Object.keys(NAMED_SCALES) as ScaleName[]) {
    if (NAMED_SCALES[name] === mask) {
      return name;
    }
  }
  for (const name of Object.keys(WORLD_SCALES) as WorldScaleName[]) {
    if (WORLD_SCALES[name] === mask) {
      return name;
    }
  }
  return undefined;
}

/** The tonic without its register: a key has none, whatever the name carried. */
function bareTonic(note: Note): Note {
  return { letter: note.letter, alter: note.alter };
}

/**
 * Read a key named by a tonic and a scale word — `'D harmonic minor'`,
 * `'D dorian'` — or answer null when the text names no built-in scale.
 *
 * This is the inverse of what a key writes itself as, so a key that is neither a
 * plain major nor a plain minor survives being written down and read back. A
 * plain mode word is left to the key-name parser, which reads it in every
 * notation system rather than in English alone.
 */
function tryNamedScaleKey(text: string): ResolvedKey | null {
  const trimmed = text.trim();
  const separator = trimmed.search(/\s/);
  if (separator < 0) {
    return null;
  }
  const name = SCALE_BY_WORD.get(scaleWordKey(trimmed.slice(separator)));
  if (name === undefined) {
    return null;
  }
  const tonic = tryParseNote(trimmed.slice(0, separator));
  if (!tonic.ok) {
    return null;
  }
  const scale = namedScale(name, noteToPitchClass(tonic.value));
  return { scale, tonic: bareTonic(tonic.value), variant: variantOfMask(scale.modeMask12) };
}

/**
 * Read a key name, reporting failure instead of throwing it.
 *
 * The scale-word form is tried first, because a name ending in a mode word —
 * `'D harmonic minor'` — would otherwise be read as the plain minor key that
 * word names and lose the scale it was written with. It is English-only, so a
 * name asked for in another notation system goes straight to the key-name
 * parser, which reads that system.
 *
 * @param text The key name.
 * @param opts `system` reads the name in that notation system instead of
 *   detecting it.
 * @returns The key the name denotes, or the error explaining why the text is
 *   not one.
 * @example
 * ```ts
 * import { tryResolveKeyName } from '@libraz/libcantus';
 * const result = tryResolveKeyName('D dorian');
 * result.ok ? result.value.variant : result.error.message; // 'modal'
 * ```
 * @category Scales
 */
export function tryResolveKeyName(text: string, opts?: NoteNameOptions): ParseResult<ResolvedKey> {
  if (typeof text === 'string' && (opts?.system === undefined || opts.system === 'english')) {
    const named = tryNamedScaleKey(text);
    if (named !== null) {
      return { ok: true, value: named };
    }
  }
  const parsed = tryParseKeyName(text, opts);
  if (!parsed.ok) {
    return parsed;
  }
  const tonic = bareTonic(parsed.value.tonic);
  const rootPc = noteToPitchClass(tonic);
  return parsed.value.mode === 'major'
    ? { ok: true, value: { scale: majorScale(rootPc), tonic, variant: 'major' } }
    : { ok: true, value: { scale: minorScale(rootPc), tonic, variant: 'natural' } };
}

/**
 * Read a key name to the whole key it denotes.
 *
 * The tonic is the one the name spells, not one derived back from the pitch
 * classes: `'Ab minor'` is an A flat minor here and stays one wherever the
 * result travels.
 *
 * Not published: for a caller `resolveKey` is this function, since it reads a
 * name by calling it, and a second public name for one reading is the split
 * this module exists to prevent. A notation system other than English is asked
 * for through `Key.parse`, which carries the option.
 *
 * @param text The key name.
 * @param opts `system` reads the name in that notation system instead of
 *   detecting it.
 * @returns The key, whole.
 * @throws If the text names no key.
 */
export function resolveKeyName(text: string, opts?: NoteNameOptions): ResolvedKey {
  return unwrapParse(tryResolveKeyName(text, opts));
}
