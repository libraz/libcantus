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
    // What the walk found, so the check below cannot pass by finding nothing:
    // a renamed directory or a changed extension would empty the loop, and an
    // empty violation list reads exactly like a tree that obeys the rule.
    const files = walk(SRC);
    let crossings = 0;
    for (const file of files) {
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
        if (to !== from) {
          crossings += 1;
        }
        if (toRank > fromRank) {
          violations.push(`${path.relative(SRC, file)} (${from}) -> ${spec} (${to})`);
        }
      }
    }
    expect(files.length).toBeGreaterThan(100);
    // And that the classifier reached the imports as well as the files: the
    // layers are built on one another, so a tree with no import crossing a
    // layer at all is one this walk failed to read.
    expect(crossings).toBeGreaterThan(50);
    expect(violations).toEqual([]);
  });
});

/** The unit whose modules share their helpers through one internal module. */
const FUNCTIONAL = path.join(SRC, 'analyze', 'functional');

/**
 * Every syntax a top-level function is declared under here.
 *
 * A declaration is the form this codebase writes, and an arrow assigned to a
 * `const` is the form a second copy of a predicate would most easily arrive in
 * — so the ownership rules would have been silent about exactly the case they
 * exist for. `async` and `export default` are read for the same reason: the
 * rule is about what a module defines, not about how it spells the definition.
 */
const DECLARATION_RE =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\(|function\b)/;

/** Top-level function bodies of a module, by the name they are declared under. */
function functionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const start = (lines[index] ?? '').match(DECLARATION_RE);
    if (start === null) {
      continue;
    }
    const name = start[1] ?? start[2];
    if (name === undefined) {
      continue;
    }
    // From under the declaration to the line that closes it: what the function
    // does, not how it was spelled. A copy written as an arrow assigned to a
    // `const` states the same body under a different first line, and comparing
    // the whole of it would read the two as different functions — which is the
    // one shape a second copy is likely to arrive in.
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (line === '}' || line === '};') {
        index = cursor;
        break;
      }
      body.push(line.trim());
    }
    bodies.set(name, body.join(' '));
  }
  return bodies;
}

/**
 * Every unit split across modules over a shared `internal.ts`.
 *
 * Read from the tree rather than listed: a unit split later is held to the same
 * rule the moment its `internal.ts` is written, which is the point at which the
 * rule starts to mean something for it.
 */
function splitUnits(): string[] {
  return walk(SRC)
    .filter((file) => path.basename(file) === 'internal.ts')
    .map((file) => path.dirname(file))
    .sort();
}

describe('shared helpers in a unit split across modules', () => {
  it('finds the units to check', () => {
    // A walk that stopped matching would leave the check below passing over
    // nothing, and the units it covers are the ones the splits produced.
    const units = splitUnits().map((unit) => path.relative(SRC, unit));
    expect(units.length).toBeGreaterThan(5);
    expect(units).toContain(path.join('analyze', 'functional'));
    expect(units).toContain(path.join('generate', 'harmonize'));
  });

  it('keeps one definition of a body, in the module the siblings import', () => {
    // A predicate written twice drifts the moment one copy is corrected. The
    // bodies are compared rather than the names, since two modules may name
    // different things alike — `bassPcOf` is a key's flat submediant in one
    // module and a chord's sounding bass in another.
    const copied: string[] = [];
    let found = 0;
    for (const unit of splitUnits()) {
      const byBody = new Map<string, string[]>();
      for (const file of readdirSync(unit).filter((name) => name.endsWith('.ts'))) {
        for (const [name, body] of functionBodies(readFileSync(path.join(unit, file), 'utf8'))) {
          const key = `${name} ${body}`;
          byBody.set(key, [...(byBody.get(key) ?? []), file]);
        }
      }
      // The bodies this unit contributed, so a parser that stopped recognising
      // a declaration leaves the copy list empty for the right reason.
      found += byBody.size;
      for (const [key, files] of byBody) {
        if (files.length > 1) {
          copied.push(
            `${path.relative(SRC, unit)}: ${key.split(' ')[0]} in ${files.sort().join(', ')}`,
          );
        }
      }
    }
    expect(found).toBeGreaterThan(20);
    expect(copied.sort()).toEqual([]);
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

/**
 * The modules allowed to declare a beat-axis tolerance, and what each answers.
 *
 * `core/meter/internal.ts` declares the number, because the meter layer sits
 * below every other reader of the beat axis and has to compare beats to place a
 * bar line. `analyze/adjacency.ts` re-exports it beside the tolerance a played
 * onset is read with, which is the other question the axis is asked.
 */
const BEAT_TOLERANCE_HOMES = [
  path.join('core', 'meter', 'internal.ts'),
  path.join('analyze', 'adjacency.ts'),
];

/**
 * Constants that carry one of these values without being a beat tolerance.
 *
 * A number is not a concept: an epsilon over a quantity that is not a position
 * on the beat axis may be the same size by coincidence, and collapsing it into
 * the shared one would carry a correction where it does not belong. Each entry
 * says what the quantity is.
 */
const NOT_A_BEAT_TOLERANCE: Readonly<Record<string, string>> = {
  SCORE_EPS: 'a sum of weighted preferences, not a position on the beat axis',
};

/** Every `const NAME = <literal>;` a module declares, with the literal. */
function declaredConstants(source: string): { name: string; value: string }[] {
  const found: { name: string; value: string }[] = [];
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)(?::[^=]+)?\s*=\s*([\d.e-]+);/g)) {
    found.push({ name: m[1] ?? '', value: m[2] ?? '' });
  }
  return found;
}

describe('the beat axis is compared with one tolerance', () => {
  // Two numbers that happen to be equal are not one tolerance. The adjacency
  // module was written to hold both of them — "Both are answered here" — and the
  // consolidation reached four of the fourteen sites that needed it, so the
  // rest agreed by coincidence and a correction to any one of them would have
  // left the others behind without a failure anywhere.
  const VALUES = new Set(['1e-9', '0.05']);

  const declarations = walk(SRC).flatMap((file) => {
    const rel = path.relative(SRC, file);
    if (BEAT_TOLERANCE_HOMES.includes(rel)) {
      return [];
    }
    return declaredConstants(readFileSync(file, 'utf8'))
      .filter((declaration) => VALUES.has(declaration.value))
      .map((declaration) => ({ ...declaration, rel }));
  });

  it('finds the tree to check', () => {
    // The scan reads sources rather than a list, so a parser that stopped
    // matching would leave the check below passing over nothing.
    expect(walk(SRC).length).toBeGreaterThan(50);
    expect(
      declaredConstants('const A = 1e-9;\nconst B: number = 0.05;\nconst C = 3;'),
    ).toHaveLength(3);
  });

  it('is declared nowhere but the two modules that own it', () => {
    const copies = declarations
      .filter(({ name }) => !(name in NOT_A_BEAT_TOLERANCE))
      .map(({ rel, name, value }) => `${rel}: ${name} = ${value}`)
      .sort();
    expect(copies).toEqual([]);
  });

  it('lists nothing as exempt that no longer exists', () => {
    // The exemption list decays the same way any other registry does: an entry
    // whose constant is gone describes nothing and is trusted anyway.
    const live = new Set(declarations.map(({ name }) => name));
    expect(Object.keys(NOT_A_BEAT_TOLERANCE).filter((name) => !live.has(name))).toEqual([]);
  });
});

/**
 * Buffers sized by a product without being a search table a budget must cap.
 *
 * A table whose size is a product of two counts the caller controls is what a
 * budget stands for, and the charge belongs at the allocation rather than at
 * whichever entry point last remembered to estimate it. A buffer bounded by
 * something the module itself fixes is not that, and each entry says what
 * bounds it.
 */
const SELF_BOUNDED_BUFFERS: Readonly<Record<string, string>> = {
  [path.join('theory', 'voicing', 'internal.ts')]:
    'the candidate buffer of the voicing search, capped by maxCandidates and grown towards it',
  [path.join('analyze', 'arrange', 'internal.ts')]:
    'the lane assignment of one onset, sized by the notes struck together and the lanes free at it',
};

/** Every `new <TypedArray>(...)` a module writes, with its argument text. */
function typedArrayAllocations(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(
    /\bnew\s+(?:Float|Int|Uint)(?:8|16|32|64)(?:Clamped)?Array\(/g,
  )) {
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
      index += 1;
    }
    found.push(source.slice(start, index - 1));
  }
  return found;
}

describe('a search table is charged where it is allocated', () => {
  // The budget of a search was checked at its entry point and its table was
  // allocated deep inside it, so the two drifted apart as the table grew: three
  // passes charged for their slots and then filled a row of two dozen
  // candidates per slot. Charging at the allocation is what keeps them
  // together, so a table obtained any other way is a table nothing bounded.
  const offenders = walk(SRC).flatMap((file) => {
    const rel = path.relative(SRC, file);
    if (rel in SELF_BOUNDED_BUFFERS) {
      return [];
    }
    return typedArrayAllocations(readFileSync(file, 'utf8'))
      .filter((argument) => argument.includes('*'))
      .map((argument) => `${rel}: new …Array(${argument})`);
  });

  it('finds the allocations to check', () => {
    // The scan reads sources rather than a list, so a parser that stopped
    // matching would leave the check below passing over nothing.
    expect(
      typedArrayAllocations('new Float64Array((a + 1) * b);\nnew Int32Array(12);').map((a) => a),
    ).toEqual(['(a + 1) * b', '12']);
    const allocations = walk(SRC).flatMap((file) =>
      typedArrayAllocations(readFileSync(file, 'utf8')),
    );
    expect(allocations.length).toBeGreaterThan(5);
  });

  it('allocates every table through the charging helpers', () => {
    expect(offenders.sort()).toEqual([]);
  });

  it('lists nothing as self-bounded that no longer allocates one', () => {
    const stale = Object.keys(SELF_BOUNDED_BUFFERS).filter((rel) => {
      const source = readFileSync(path.join(SRC, rel), 'utf8');
      return !typedArrayAllocations(source).some((argument) => argument.includes('*'));
    });
    expect(stale).toEqual([]);
  });

  it('has more than one search reaching for the helpers', () => {
    // A helper one module uses is that module's private shape; the point of
    // this one is that every search reaches for it, so a second search added
    // later finds the charged way already laid out.
    const users = walk(SRC).filter((file) =>
      /allocate(?:Candidate|Choice)Table\(/.test(readFileSync(file, 'utf8')),
    );
    expect(users.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Functions a module declares as its own exports.
 *
 * Only declarations, not the re-exports a barrel writes: a barrel passing a
 * name on is what publishing looks like, and counting those would make every
 * published name look like a declaration of its own.
 */
function exportedFunctions(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(
    /^export (?:declare )?(?:async )?function\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    found.push(match[1] ?? '');
  }
  return found;
}

/** Names an import statement brings in, wherever it came from. */
function importedNames(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:import|export)[\s\S]{0,600}?from\s+['"][^'"]+['"]/g)) {
    const clause = match[0].match(/\{([\s\S]*?)\}/);
    if (clause?.[1] === undefined) {
      continue;
    }
    for (const part of clause[1].split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && name !== '') {
        found.push(name);
      }
    }
  }
  return found;
}

describe("a unit's entry module carries nothing only a test reaches", () => {
  // A function widened to `export` on the module a caller imports is part of
  // that module's interface to everyone after, whatever it was widened for.
  // What a test needs instead is the module that owns the thing — which the
  // library's own passes then import too, so the export answers to something.
  // Derived from the tree, because a list would only ever describe the exports
  // somebody remembered.
  const entries = walk(SRC).filter((file) => path.basename(file) === 'index.ts');
  const usedElsewhere = (file: string): Set<string> =>
    new Set(
      walk(SRC)
        .filter((other) => other !== file)
        .flatMap((other) => importedNames(readFileSync(other, 'utf8'))),
    );
  const usedInTests = new Set(
    walk(fileURLToPath(new URL('.', import.meta.url))).flatMap((file) =>
      importedNames(readFileSync(file, 'utf8')),
    ),
  );

  it('finds the exports to check', () => {
    expect(entries.length).toBeGreaterThan(20);
    expect(usedElsewhere(entries[0] ?? '').size).toBeGreaterThan(100);
    expect(usedInTests.size).toBeGreaterThan(100);
    expect(
      exportedFunctions('export function a() {}\nexport type B = 1;\nfunction c() {}'),
    ).toEqual(['a']);
  });

  it('is reached by the library itself wherever a test reaches it', () => {
    const testOnly: string[] = [];
    for (const file of entries) {
      const rel = path.relative(SRC, file);
      const reached = usedElsewhere(file);
      for (const name of exportedFunctions(readFileSync(file, 'utf8'))) {
        if (usedInTests.has(name) && !reached.has(name)) {
          testOnly.push(`${rel}: ${name}`);
        }
      }
    }
    expect(testOnly.sort()).toEqual([]);
  });
});
