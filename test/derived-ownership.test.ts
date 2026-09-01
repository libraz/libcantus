import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPT_OWNERS } from './support/concept-owners.js';
import { declarations, importsOf, relativeTo, resolveSpecifier } from './support/signatures.js';
import { ROOT, SRC } from './support/source-files.js';

/**
 * The ownership check: one concept, one derivation.
 *
 * A predicate written twice drifts the moment one copy is corrected, and the
 * drift shows up as a wrong note rather than as a failing build. The layer
 * check already forbids importing upward; this forbids the other half, which is
 * declaring for yourself what a module to your left already derives.
 *
 * The subject is the whole tree, so a copy written into a module that does not
 * exist yet is caught the day it lands. What the registry lists is the debt:
 * the copies that exist now, which come off the list as they are removed.
 */

describe('a musical concept has one derivation', () => {
  const declared = declarations();

  it.each(CONCEPT_OWNERS.map((owner) => [owner.concept, owner] as const))(
    'keeps %s to its owner',
    (_concept, owner) => {
      const reserved = new Set(owner.reserved);
      const allowed = new Set(owner.allowed ?? []);
      const copies = declared
        .filter((decl) => reserved.has(decl.name))
        .filter((decl) => decl.file !== owner.owner)
        .filter((decl) => !allowed.has(`${decl.file}:${decl.name}`))
        .map((decl) => `${decl.file}:${decl.line} declares ${decl.name}, owned by ${owner.owner}`);

      expect([...new Set(copies)]).toEqual([]);
    },
  );

  it.each(CONCEPT_OWNERS.map((owner) => [owner.concept, owner] as const))(
    'derives %s in the module that owns it',
    (_concept, owner) => {
      // An owner that declares none of its own reserved names owns nothing, and
      // the check above would then pass by measuring an empty set.
      const own = declared.filter(
        (decl) => decl.file === owner.owner && owner.reserved.includes(decl.name),
      );

      expect(own.length).toBeGreaterThan(0);
    },
  );

  it.each(
    CONCEPT_OWNERS.filter((owner) => (owner.private ?? []).length > 0).map(
      (owner) => [owner.concept, owner] as const,
    ),
  )('keeps the raw tables behind %s to its owner', (_concept, owner) => {
    // The other half of ownership: a sibling that reads the table directly is
    // deriving the concept for itself, whatever it calls the result.
    const hidden = new Set(owner.private ?? []);
    const reached = importsOf()
      .filter((imported) => imported.file !== owner.owner)
      .filter((imported) => imported.names.some((name) => hidden.has(name)))
      .filter((imported) => {
        const target = resolveSpecifier(path.join(ROOT, imported.file), imported.spec);
        return target !== null && relativeTo(path.dirname(SRC), target) === owner.owner;
      })
      .map(
        (imported) =>
          `${imported.file}:${imported.line} imports ${imported.names
            .filter((name) => hidden.has(name))
            .join(', ')} from ${owner.owner}`,
      );

    expect(reached).toEqual([]);
  });

  it('holds no allowance for a copy that is already gone', () => {
    const present = new Set(declared.map((decl) => `${decl.file}:${decl.name}`));
    const stale = CONCEPT_OWNERS.flatMap((owner) =>
      (owner.allowed ?? []).filter((site) => !present.has(site)),
    );

    expect(stale).toEqual([]);
  });

  it('reads a subject the tree supplies rather than a list', () => {
    expect(declared.length).toBeGreaterThan(1000);
  });
});
