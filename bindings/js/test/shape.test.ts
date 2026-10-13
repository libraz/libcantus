/**
 * The facade's runtime shape equals the pure package's: the export names of
 * every subpath, the kind of each export, and for each class the string-named
 * members it and its prototype own. Function and const types are checked by
 * tsc instead (generated/api.ts declares each as `typeof Pure.x`).
 */
import { describe, expect, it } from 'vitest';
import * as PureAnalyze from '../../../ts/src/analyze/index.js';
import * as PureCore from '../../../ts/src/core/index.js';
import * as PureGenerate from '../../../ts/src/generate/index.js';
import * as Pure from '../../../ts/src/index.js';
import * as PureModel from '../../../ts/src/model/index.js';
import * as PureTheory from '../../../ts/src/theory/index.js';
import * as FacadeAnalyze from '../src/analyze.js';
import * as FacadeCore from '../src/core.js';
import * as FacadeGenerate from '../src/generate.js';
import * as Facade from '../src/index.js';
import * as FacadeModel from '../src/model.js';
import * as FacadeTheory from '../src/theory.js';

type Namespace = Record<string, unknown>;

const SUBPATHS: [string, Namespace, Namespace][] = [
  ['.', Pure, Facade],
  ['core', PureCore, FacadeCore],
  ['theory', PureTheory, FacadeTheory],
  ['analyze', PureAnalyze, FacadeAnalyze],
  ['generate', PureGenerate, FacadeGenerate],
  ['model', PureModel, FacadeModel],
];

const pure = Pure as Namespace;
const facade = Facade as Namespace;

/** Exports that are classes: functions with a prototype that are not plain functions. */
const CLASSES = Object.keys(pure).filter((name) => {
  const value = pure[name];
  return typeof value === 'function' && /^class\b/.test(Function.prototype.toString.call(value));
});

function stringNames(object: object): string[] {
  return Object.getOwnPropertyNames(object).sort();
}

describe('facade shape', () => {
  it.each(SUBPATHS)('exports the same names from %s', (_subpath, p, f) => {
    expect(Object.keys(f).sort()).toEqual(Object.keys(p).sort());
  });

  it('defines each export once, shared by every subpath', () => {
    for (const [subpath, , f] of SUBPATHS) {
      for (const name of Object.keys(f)) {
        expect(f[name], `${subpath} ${name}`).toBe(facade[name]);
      }
    }
  });

  it('exports each name as the same kind of value', () => {
    for (const name of Object.keys(pure)) {
      expect(typeof facade[name], name).toBe(typeof pure[name]);
    }
  });

  it('finds every class', () => {
    expect(CLASSES.length).toBe(20);
  });

  it.each(CLASSES)('%s has the same static and prototype members', (name) => {
    const p = pure[name] as { prototype: object };
    const f = facade[name] as { prototype: object };
    expect(stringNames(f), `${name} statics`).toEqual(stringNames(p));
    expect(stringNames(f.prototype), `${name} prototype`).toEqual(stringNames(p.prototype));
    expect(Symbol.iterator in f.prototype, `${name} iterable`).toBe(Symbol.iterator in p.prototype);
    expect((f as unknown as () => void).length, `${name} constructor length`).toBe(
      (p as unknown as () => void).length,
    );
    for (const member of stringNames(p.prototype)) {
      const pd = Object.getOwnPropertyDescriptor(p.prototype, member);
      const fd = Object.getOwnPropertyDescriptor(f.prototype, member);
      expect(typeof fd?.get, `${name}#${member} getter`).toBe(typeof pd?.get);
      if (typeof pd?.value === 'function' && member !== 'constructor') {
        expect((fd?.value as (() => void) | undefined)?.length, `${name}#${member} length`).toBe(
          (pd.value as () => void).length,
        );
      }
    }
  });

  it('builds errors with the same own members', () => {
    for (const name of ['InvalidInputError', 'NoSolutionError', 'BudgetExceededError']) {
      const P = pure[name] as new (message: string) => Error;
      const F = facade[name] as new (message: string) => Error;
      expect(stringNames(new F('x')), name).toEqual(stringNames(new P('x')));
      expect(Object.getPrototypeOf(F.prototype), name).toBe(Object.getPrototypeOf(P.prototype));
    }
  });

  it('builds hybrids and handles with the same own members', () => {
    const cases: [string, (api: Namespace) => object][] = [
      ['PositionalRng', (api) => (api.createPositionalRng as (seed: number) => object)(1)],
      ['ResolvedContext', (api) => (api.resolveContext as (seed: number) => object)(1)],
      [
        'Draw',
        (api) => (api.resolveContext as (seed: number) => { part(n: string): object })(1).part('x'),
      ],
      [
        'ChordTimeline',
        (api) =>
          (api.chordTimelineFromChords as (chords: unknown[], total: number) => object)([], 4),
      ],
      ['Rng', (api) => (api.createRng as (seed: number) => object)(1)],
      ['NoteEventIndex', (api) => (api.createNoteEventIndex as (notes: unknown[]) => object)([])],
    ];
    for (const [type, make] of cases) {
      expect(Object.keys(make(facade)), type).toEqual(Object.keys(make(pure)));
    }
  });
});
