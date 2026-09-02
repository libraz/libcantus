/**
 * Scale systems: which pitch organisations functional harmony was built for,
 * and which ones it would only be imposed on.
 *
 * Roman numerals, tonic/subdominant/dominant function and cadence detection all
 * presuppose Western common practice. A `KeyScale` is a root pitch class and a
 * twelve-bit mask, which says nothing about the tradition the scale came from,
 * so analysis code that wants to branch instead of assuming needs this
 * classification to branch on.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertRecord } from '../../core/validation/index.js';
import type { ScaleName, ScaleNameInput, WorldScaleName } from './masks.js';
import { NAMED_SCALES, resolveScaleName, WORLD_SCALES } from './masks.js';

/**
 * The kind of pitch organisation a scale belongs to.
 *
 * - `'common-practice'`: the scale functional harmony is defined on — a tonic,
 *   a dominant carrying a leading tone, and a triad available on every degree.
 * - `'modal'`: a seven-note rotation or alteration of that material. Degrees
 *   and Roman numerals still describe it, but a dominant-to-tonic cadence is
 *   not what holds the music together.
 * - `'non-functional'`: the collection carries no chord function of its own. A
 *   gapped or symmetric set takes its harmony from whatever key it is used
 *   over, and a scale from a tradition organised melodically rather than by
 *   chords has no functional reading at all.
 *
 * @category Scales
 */
export type ScaleSystem = 'common-practice' | 'modal' | 'non-functional';

/**
 * The system each built-in scale belongs to.
 *
 * Every name in {@link NAMED_SCALES} and {@link WORLD_SCALES} appears here, so
 * a scale added without a classification fails to compile rather than falling
 * silently into a default. Aliases are classified through the name they resolve
 * to; use {@link scaleSystemOf} to look one up.
 *
 * @category Scales
 */
export const SCALE_SYSTEMS: Readonly<Record<ScaleName | WorldScaleName, ScaleSystem>> =
  Object.freeze({
    major: 'common-practice',
    ionian: 'common-practice',
    naturalMinor: 'common-practice',
    aeolian: 'common-practice',
    harmonicMinor: 'common-practice',
    melodicMinor: 'common-practice',
    dorian: 'modal',
    phrygian: 'modal',
    lydian: 'modal',
    mixolydian: 'modal',
    locrian: 'modal',
    lydianDominant: 'modal',
    mixolydianB13: 'modal',
    locrianNatural2: 'modal',
    altered: 'modal',
    phrygianDominant: 'modal',
    majorPentatonic: 'non-functional',
    minorPentatonic: 'non-functional',
    blues: 'non-functional',
    wholeTone: 'non-functional',
    octatonicHalfWhole: 'non-functional',
    octatonicWholeHalf: 'non-functional',
    chromatic: 'non-functional',
    miyakoBushi: 'non-functional',
    ritsu: 'non-functional',
    minyo: 'non-functional',
    ryukyu: 'non-functional',
    ajam: 'non-functional',
    nahawand: 'non-functional',
    kurd: 'non-functional',
    hijaz: 'non-functional',
    hijazkar: 'non-functional',
    bilaval: 'non-functional',
    khamaj: 'non-functional',
    kafi: 'non-functional',
    asavari: 'non-functional',
    bhairavi: 'non-functional',
    bhairav: 'non-functional',
    kalyan: 'non-functional',
    marwa: 'non-functional',
    purvi: 'non-functional',
    todi: 'non-functional',
  });

/**
 * System of each built-in mask, Western reading first.
 *
 * Maqam Nahawand and the natural minor are the same twelve pitch classes, so a
 * mask cannot tell them apart. Building the table in name order — the Western
 * register before the world one — makes the mask answer with the Western
 * reading, which is the reading a bare `KeyScale` from key detection or from a
 * caller's own data actually carries.
 */
const SYSTEM_BY_MASK: ReadonlyMap<number, ScaleSystem> = (() => {
  const byMask = new Map<number, ScaleSystem>();
  const names: (ScaleName | WorldScaleName)[] = [
    ...(Object.keys(NAMED_SCALES) as ScaleName[]),
    ...(Object.keys(WORLD_SCALES) as WorldScaleName[]),
  ];
  for (const name of names) {
    const mask = Object.hasOwn(NAMED_SCALES, name)
      ? NAMED_SCALES[name as ScaleName]
      : WORLD_SCALES[name as WorldScaleName];
    if (!byMask.has(mask)) {
      byMask.set(mask, SCALE_SYSTEMS[name]);
    }
  }
  return byMask;
})();

/**
 * The system a scale belongs to.
 *
 * A name — canonical or an alias — is answered exactly: `'nahawand'` is a maqam
 * even though its mask is the natural minor's. A `KeyScale` carries no
 * tradition, so it is answered by its mask, under the Western reading of that
 * mask; a mask that is no built-in scale answers undefined.
 *
 * @param scale The scale name, or a key/scale to read the mask of.
 * @returns The system, or undefined for a mask that names no built-in scale.
 * @throws If `scale` is a string naming no built-in scale. An unknown name is a
 *   typo, and answering it the way an unrecognised mask is answered would hide
 *   that.
 * @example
 * ```ts
 * import { scaleSystemOf, majorKey } from '@libraz/libcantus';
 * scaleSystemOf('harmonicMinor'); // 'common-practice'
 * scaleSystemOf('dorian'); // 'modal'
 * scaleSystemOf('hijaz'); // 'non-functional'
 * scaleSystemOf(majorKey(0)); // 'common-practice'
 * ```
 * @category Scales
 */
export function scaleSystemOf(scale: KeyScale | ScaleNameInput): ScaleSystem | undefined {
  if (typeof scale !== 'string') {
    assertRecord<KeyScale>(scale, 'scale');
  }
  if (typeof scale === 'string') {
    const canonical = resolveScaleName(scale);
    if (canonical === undefined) {
      throw new InvalidInputError(`Unknown scale: ${scale}`);
    }
    return SCALE_SYSTEMS[canonical];
  }
  return SYSTEM_BY_MASK.get(scale.modeMask12);
}

/**
 * Whether functional (Roman-numeral) analysis applies to a scale.
 *
 * True for common-practice and modal scales, false for everything classed
 * `'non-functional'` — analysis that would otherwise read a raga as a chord
 * progression can ask here first.
 *
 * The two ways of naming a scale are answered differently, exactly as
 * {@link scaleSystemOf} answers them. A name carries its tradition, so
 * `'hijaz'` is false. A `KeyScale` carries only a mask, and a mask shared with
 * a Western scale is read the Western way — maqam Hijaz and the phrygian
 * dominant are the same seven pitch classes, so that mask is modal and answers
 * true. A mask that names no built-in scale answers true as well, which keeps a
 * caller's own mask being analysed the way it always has been. Pass the name
 * whenever the tradition is known and the answer should follow it.
 *
 * @param scale The scale name, or a key/scale to read the mask of.
 * @returns True when functional harmony describes the scale.
 * @throws If `scale` is a string naming no built-in scale.
 * @example
 * ```ts
 * import { supportsFunctionalHarmony, scaleByName } from '@libraz/libcantus';
 * supportsFunctionalHarmony('harmonicMinor'); // true
 * supportsFunctionalHarmony('bhairav'); // false
 * supportsFunctionalHarmony('hijaz'); // false — named, so read as a maqam
 * supportsFunctionalHarmony(scaleByName('hijaz', 0)); // true — its mask is the phrygian dominant
 * supportsFunctionalHarmony(scaleByName('ryukyu', 0)); // false — a mask no Western scale shares
 * ```
 * @category Scales
 */
export function supportsFunctionalHarmony(scale: KeyScale | ScaleNameInput): boolean {
  return scaleSystemOf(scale) !== 'non-functional';
}
