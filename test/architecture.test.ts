import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the one-directional layer dependency graph:
 *   core <- theory <- analyze <- generate <- model
 * A module may import only from its own layer or layers to its left.
 */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

const LAYER_ORDER = ['core', 'theory', 'analyze', 'generate', 'model'] as const;
type Layer = (typeof LAYER_ORDER)[number];

function layerOf(file: string): Layer | null {
  const rel = path.relative(SRC, file).split(path.sep);
  return (LAYER_ORDER as readonly string[]).includes(rel[0] ?? '') ? (rel[0] as Layer) : null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;

describe('layer architecture', () => {
  it('never imports from a higher layer', () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const from = layerOf(file);
      if (!from) continue;
      const fromRank = LAYER_ORDER.indexOf(from);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? '';
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), spec);
        const to = layerOf(target);
        if (!to) continue;
        const toRank = LAYER_ORDER.indexOf(to);
        if (toRank > fromRank) {
          violations.push(`${path.relative(SRC, file)} (${from}) -> ${spec} (${to})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

/** The unit whose modules share their helpers through one internal module. */
const FUNCTIONAL = path.join(SRC, 'analyze', 'functional');

/** Top-level function bodies of a module, by the name they are declared under. */
function functionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const start = (lines[index] ?? '').match(/^(?:export )?function (\w+)/);
    if (start === null) {
      continue;
    }
    const body: string[] = [];
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      body.push(line.trim());
      if (line === '}') {
        index = cursor;
        break;
      }
    }
    bodies.set(start[1] as string, body.join(' '));
  }
  return bodies;
}

describe('shared predicates in the functional-harmony unit', () => {
  it('keeps one definition of a body, in the module the siblings import', () => {
    // A predicate written twice drifts the moment one copy is corrected. The
    // bodies are compared rather than the names, since two modules may name
    // different things alike — `bassPcOf` is a key's flat submediant in one
    // module and a chord's sounding bass in another.
    const byBody = new Map<string, string[]>();
    for (const file of readdirSync(FUNCTIONAL).filter((name) => name.endsWith('.ts'))) {
      for (const [name, body] of functionBodies(
        readFileSync(path.join(FUNCTIONAL, file), 'utf8'),
      )) {
        const key = `${name} ${body}`;
        byBody.set(key, [...(byBody.get(key) ?? []), file]);
      }
    }
    const copied = [...byBody.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([key, files]) => `${key.split(' ')[0]} in ${files.sort().join(', ')}`);

    expect(copied).toEqual([]);
  });

  it('routes the shared predicates through the internal module', () => {
    // The other half of the same rule: a module that uses a shared helper has
    // to import it rather than reach for a copy of its own. `internal.ts` is
    // where the siblings reach them, whether it writes a predicate itself or
    // passes on one the theory layer owns.
    const shared = [
      'isDiatonicChord',
      'hasMajorThird',
      'isNeapolitanChordOf',
      'hasDominantSonority',
      'soundsDominantSeventh',
    ];
    const internalSource = readFileSync(path.join(FUNCTIONAL, 'internal.ts'), 'utf8');
    const internal = functionBodies(internalSource);
    for (const name of shared) {
      expect(
        internal.has(name) || new RegExp(`\\b${name}\\b`).test(internalSource),
        `internal.ts provides ${name}`,
      ).toBe(true);
    }
    for (const file of readdirSync(FUNCTIONAL).filter(
      (name) => name.endsWith('.ts') && name !== 'internal.ts',
    )) {
      const source = readFileSync(path.join(FUNCTIONAL, file), 'utf8');
      const used = shared.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
      for (const name of used) {
        expect(functionBodies(source).has(name), `${file} defines its own ${name}`).toBe(false);
      }
      if (used.length > 0) {
        expect(source, file).toMatch(/from '\.\/internal\.js'/);
      }
    }
  });
});

/**
 * The predicates the analysis layer and the part-writing layer both ask, which
 * neither may own: part-writing cannot import analysis, and analysis reads
 * part-writing nowhere, so a copy in either drifts the moment the other is
 * corrected.
 */
const TENDENCY = path.join(SRC, 'theory', 'tendency', 'index.ts');

describe('chord-and-key predicates shared across layers', () => {
  it('asks the sonority questions through the theory layer', () => {
    const owned = [
      'soundsDominantSeventh',
      'hasDominantSonority',
      'isDominantChordOf',
      'isNeapolitanChordOf',
      'isDiatonicChord',
      'tonicizableDegrees',
      'appliedDominantTarget',
    ];
    const tendency = functionBodies(readFileSync(TENDENCY, 'utf8'));
    for (const name of owned) {
      expect(tendency.has(name), `theory/tendency defines ${name}`).toBe(true);
    }
    // Nothing above it writes a second answer to the same question. A name may
    // be re-exported, which is how the analysis layer's internal module hands
    // these on, but no other module may declare a body for one.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file === TENDENCY) {
        continue;
      }
      const bodies = functionBodies(readFileSync(file, 'utf8'));
      for (const name of owned) {
        if (bodies.has(name)) {
          offenders.push(`${path.relative(SRC, file)} defines ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** The module that reads a key's mode straight off its mask. */
const MASKS = path.join(SRC, 'theory', 'scale', 'masks.ts');

/** The module that asks the same question of a whole key, for the layers above. */
const MINOR_KEY_HOME = path.join(SRC, 'analyze', 'functional', 'function.ts');

/**
 * The bit test that answers "is this key minor": a minor third present and a
 * major third absent, read off a twelve-bit mode mask. Matched as text rather
 * than by name, since a copy written inline inside some other function carries
 * no name to look for.
 */
const MINOR_MASK_TEST = />>\s*3\s*\)?\s*&\s*1[\s\S]{0,64}?>>\s*4\s*\)?\s*&\s*1/;

describe('the minor-key question', () => {
  it('is answered in one place, which every other module imports', () => {
    // The check is worth nothing unless it still recognises the body it guards,
    // so the owning module has to match both the name and the test itself.
    const masks = readFileSync(MASKS, 'utf8');
    expect(functionBodies(masks).has('isMinorMask'), 'theory/scale/masks.ts defines it').toBe(true);
    expect(MINOR_MASK_TEST.test(masks), 'the mask test is written as this check reads it').toBe(
      true,
    );
    expect(
      functionBodies(readFileSync(MINOR_KEY_HOME, 'utf8')).has('isMinorKey'),
      'analyze/functional/function.ts defines the key-level question',
    ).toBe(true);

    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file);
      const source = readFileSync(file, 'utf8');
      const bodies = functionBodies(source);
      if (file !== MASKS) {
        if (MINOR_MASK_TEST.test(source)) {
          offenders.push(`${rel} reads the mode mask itself`);
        }
        if (bodies.has('isMinorMask')) {
          offenders.push(`${rel} defines isMinorMask`);
        }
      }
      if (file !== MINOR_KEY_HOME && bodies.has('isMinorKey')) {
        offenders.push(`${rel} defines isMinorKey`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
