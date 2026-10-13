import { describe, expect, it, vi } from 'vitest';
import type { ComposerOptions } from '../src/model/composer.js';
import { Composer } from '../src/model/composer.js';

/**
 * A composer's settings are what a project file stores, so the reproduction
 * recipe has to survive the round trip through them.
 *
 * The build default is stood in for rather than waited for: the version module
 * is mocked so this file's copy of the library produces version 2 by default
 * while still accepting a project pinned to version 1. That is the situation a
 * project saved today meets on the day the constant moves, and it is the only
 * way to run it before the constant does.
 */
vi.mock('../src/core/random/version.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/random/version.js')>();
  return {
    ...actual,
    ALGORITHM_VERSION: 2,
    resolveAlgorithmVersion: (requested?: number) => requested ?? 2,
  };
});

/** A drawn part, for comparing what two composers would generate. */
const part = (composer: Composer) =>
  composer.drums({ bars: 2, style: 'funk', section: 'chorus' }).notes;

describe('a composer stores the version its parts were written under', () => {
  it('records the resolved version where the caller pinned none', () => {
    // The documented recipe is `JSON.stringify(composer)`, so what the caller
    // never named is what a project file has to carry for it.
    expect(Composer.of({ key: 'C major', seed: 7 }).data.algorithmVersion).toBe(2);
    expect(Composer.of({ key: 'C major', seed: 7 }).data.seed).toBe(7);
  });

  it('records a seed the caller left out', () => {
    expect(Composer.of({ key: 'C major' }).data.seed).toBe(0);
  });

  it('keeps a pinned version through the round trip', () => {
    const written = Composer.of({ key: 'C major', seed: 7, algorithmVersion: 1 });
    const saved = JSON.parse(JSON.stringify(written)) as ComposerOptions;

    expect(saved.algorithmVersion).toBe(1);
    expect(part(Composer.of(saved))).toEqual(part(written));
  });

  it('reopens a saved project as the piece it was after the build default moves', () => {
    const written = Composer.of({ key: 'C major', seed: 7, algorithmVersion: 1 });
    const saved = JSON.parse(JSON.stringify(written)) as ComposerOptions;
    const { algorithmVersion, ...withoutVersion } = saved;

    // Dropping the version is what makes the file reopen at whatever the build
    // opening it defaults to, and the parts that come back are not the ones the
    // project was written with: the version takes part in every seed derivation.
    expect(algorithmVersion).toBe(1);
    expect(part(Composer.of(withoutVersion))).not.toEqual(part(written));
    expect(part(Composer.of(saved))).toEqual(part(written));
  });

  it('draws the pinned version of a progression, preset included', () => {
    const chords = (composer: Composer) =>
      composer.progression({ style: 'dance', bars: 4 }).segments;
    const pinned = Composer.of({ key: 'C major', seed: 7, algorithmVersion: 1 });
    const current = Composer.of({ key: 'C major', seed: 7 });

    // The preset is drawn like everything else, so a pinned project gets the
    // loop its version chose rather than this build's under its own chords.
    expect(chords(pinned)).not.toEqual(chords(current));
    expect(chords(Composer.of(JSON.parse(JSON.stringify(pinned)) as ComposerOptions))).toEqual(
      chords(pinned),
    );
  });
});
