import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { degreeOfInterval } from '../../theory/chord/index.js';
import { chordScales } from '../../theory/chordscale/index.js';
import { namedScaleMask, nearestScaleTone } from '../../theory/scale/index.js';

/** Semitones above the root for each degree of a major scale, 1-based. */
const MAJOR_DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
/** How many tones a scale has one degree apiece. */
const HEPTATONIC_SIZE = 7;
/**
 * The scale a chord's own quality implies, as semitones above its root.
 *
 * A chord that states a seventh has named its mode — the third and the seventh
 * together are what chord-scale theory reads a chord scale from — so the
 * degrees it does not state are still its own rather than the surrounding key's:
 * the sixth over a dominant seventh is the major sixth its mode carries,
 * whatever the key spells in that place. A triad names no mode, and a chord
 * whose set no seven-tone scale contains has no degrees to give, so both leave
 * the answer to the key.
 *
 * @param chord The chord being played over.
 * @returns One semitone offset per degree, 1-based, or undefined when the
 *   quality determines no scale.
 */
export function impliedScaleTones(chord: Chord): readonly number[] | undefined {
  if (chordDegreeSemitone(7, chord) === undefined) {
    return undefined;
  }
  for (const match of chordScales(chord)) {
    const mask = namedScaleMask(match.name);
    if (mask === undefined) {
      continue;
    }
    const tones: number[] = [];
    for (let offset = 0; offset < 12; offset += 1) {
      if (((mask >> offset) & 1) === 1) {
        tones.push(offset);
      }
    }
    if (tones.length === HEPTATONIC_SIZE) {
      return tones;
    }
  }
  return undefined;
}
/**
 * The tone standing in the place of a degree the chord replaced.
 *
 * A suspension does not leave its third unstated; it puts another tone there.
 * Filling the third back in from the key is the one thing a suspension exists
 * to prevent, so a figure written on the third sounds the tone the chord
 * suspended into instead. Read from the tones the chord sounds rather than from
 * its quality name: one suspension is written `sus4`, `7sus4`, `9sus4` and
 * `11`, and the eleventh states it by omitting the third rather than by naming
 * a suspension at all.
 */
function replacedDegreeSemitone(degree: number, chord: Chord): number | undefined {
  if (degree !== 3) {
    return undefined;
  }
  const sounds = (semitones: number): boolean =>
    chord.intervals.some((interval) => pitchClass(interval) === semitones);
  if (sounds(3) || sounds(4)) {
    return undefined;
  }
  return sounds(5) ? 5 : sounds(2) ? 2 : undefined;
}
/**
 * Semitones above the chord's root that a degree names.
 *
 * The chord answers for the degrees it actually contains, so a figure written
 * on the third comes out minor over a minor chord without the dictionary having
 * to hold two versions of it. Next comes what the chord's quality settles
 * without stating: the tone a suspension put in the third's place, and the
 * degrees of the chord scale a seventh chord names. Only what is left — a
 * degree the harmony genuinely leaves open, which is where a passing tone lives
 * — is taken from the key, which keeps it inside the music rather than inside a
 * template.
 *
 * An alteration is a displacement from the plain diatonic degree, so it is
 * measured against the major-scale template rather than stacked on top of what
 * the chord or the key already supplies: a flat seventh is the minor seventh
 * over a dominant chord as much as over a major one, which is what keeps the
 * boogie figure's sixth-to-flat-seventh motion from collapsing onto the sixth.
 *
 * The result is a signed offset, not a pitch class: degree 8 is the octave, and
 * reducing it modulo twelve would spell it as the root the figure just played,
 * turning every octave figure into a repeated note.
 */
export function degreeSemitone(
  degree: number,
  alter: number,
  chord: Chord,
  key: KeyScale,
  implied: readonly number[] | undefined,
): number {
  const octaves = Math.floor((degree - 1) / 7);
  const within = ((degree - 1) % 7) + 1;
  const template = MAJOR_DEGREE_SEMITONES[within - 1] ?? 0;
  const semitone =
    alter !== 0
      ? template
      : (chordDegreeSemitone(within, chord) ??
        replacedDegreeSemitone(within, chord) ??
        implied?.[within - 1] ??
        // A degree neither the chord nor its quality settles is a passing tone,
        // so the key decides it.
        nearestScaleTone(chord.rootPc + template, key) - chord.rootPc);
  // A degree names a position inside one octave; the octaves it spans are what
  // `octaves` carries. An extended chord states its ninth as fourteen semitones
  // and the key's answer may land on the octave itself, so both are folded here.
  return pitchClass(semitone) + 12 * octaves + alter;
}
/** The semitone a chord gives one of its own degrees, if it has that degree. */
export function chordDegreeSemitone(degree: number, chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    if (degreeOfInterval(interval, chord) === degree) {
      return interval;
    }
  }
  return undefined;
}
