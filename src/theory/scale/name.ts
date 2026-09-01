import { type ParseResult, unwrapParse } from '../../core/errors/index.js';
import type { Note, NoteNameOptions } from '../../core/pitch/index.js';
import { noteToPitchClass, tryParseKeyName, tryParseNote } from '../../core/pitch/index.js';
import { majorKey, minorKey, scaleByName } from './key.js';
import type { ResolvedKey } from './kinds.js';
import { NAMED_SCALES, type ScaleName, variantOfMask } from './masks.js';

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

/** The built-in scale each scale word names, indexed the way names compare. */
const SCALE_BY_WORD: ReadonlyMap<string, ScaleName> = new Map(
  (Object.keys(NAMED_SCALES) as ScaleName[]).map((name) => [scaleWordKey(name), name]),
);

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
  const scale = scaleByName(name, noteToPitchClass(tonic.value));
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
    ? { ok: true, value: { scale: majorKey(rootPc), tonic, variant: 'major' } }
    : { ok: true, value: { scale: minorKey(rootPc), tonic, variant: 'natural' } };
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
