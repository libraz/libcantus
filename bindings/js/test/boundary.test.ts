/**
 * The op boundary as the facade sees it, through the builtin `$` ops.
 *
 * One file for every backend: `CANTUS_BOUNDARY_BACKEND` names it (default `ts`, the pure TS
 * backend); any other name loads `backend` from bindings/<name>/dist/backend.js.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { replayCorpus } from '../../../tools/corpus/replay_js.mjs';
import type { Backend } from '../src/backend.js';
import {
  BudgetExceededError,
  InvalidInputError,
  isLibcantusError,
  NoSolutionError,
} from '../src/errors.js';
import { Runtime } from '../src/runtime.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const NAME = process.env.CANTUS_BOUNDARY_BACKEND ?? 'ts';

async function loadBackend(name: string): Promise<Backend> {
  if (name === 'ts') return (await import('../src/backends/ts.js')).backend;
  const file = path.join(REPO, 'bindings', name, 'dist/backend.js');
  return ((await import(/* @vite-ignore */ pathToFileURL(file).href)) as { backend: Backend })
    .backend;
}

const backend = await loadBackend(NAME);
const rt = new Runtime(backend);
const echo = (v: unknown) => rt.call('$echo', [v]);
const raw = (op: string, args: string) => backend.call(op, args, null);
const live = () => rt.call('$live', []) as number;

type Counter = { next(): number; readonly value: { count: number } } & Disposable;
const counter = (start?: number) =>
  rt.call('$counter', start === undefined ? [] : [start]) as Counter;

/** The error a call throws. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe(`boundary (${NAME} backend)`, () => {
  describe('tags', () => {
    it('keeps the numbers JSON cannot hold', () => {
      expect(Object.is(echo(-0), -0)).toBe(true);
      expect(echo(Number.NaN)).toBeNaN();
      expect(echo(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
      expect(echo(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
      expect(echo([0, -0, 5e-324, 1.7976931348623157e308])).toEqual([
        0, -0, 5e-324, 1.7976931348623157e308,
      ]);
      expect(raw('$echo', '[-0]').json).toBe('{"$n":"-0"}');
      expect(raw('$echo', '[1e400]').json).toBe('{"$n":"Infinity"}');
    });

    it('carries undefined inside arrays, drops it from objects, and returns it at the top', () => {
      // biome-ignore lint/suspicious/noSparseArray: a hole crosses as undefined.
      const out = echo([1, undefined, , 3]) as unknown[];
      expect(out).toHaveLength(4);
      expect(1 in out && out[1] === undefined && out[2] === undefined).toBe(true);
      expect(Object.keys(echo({ a: undefined, b: 1 }) as object)).toEqual(['b']);
      expect(echo(undefined)).toBeUndefined();
      expect(rt.call('$echo', [])).toBeUndefined();
    });

    it('carries bigint, Symbol and toJSON-bearing values as tags', () => {
      expect(echo(12345678901234567890n)).toBe(12345678901234567890n);
      const sym = echo(Symbol('tag')) as symbol;
      expect(typeof sym).toBe('symbol');
      expect(sym.description).toBe('tag');
      const custom = { toJSON: () => ({ x: [1, 2] }), toString: () => 'custom' };
      const back = echo(custom) as { toJSON(): unknown; toString(): string };
      expect(back.toJSON()).toEqual({ x: [1, 2] });
      expect(String(back)).toBe('custom');
    });

    it('escapes user keys beginning with $', () => {
      const value = { $n: 'NaN', $$x: 1, plain: { $h: 1, $cb: [{ $id: 2 }] }, $: 0 };
      expect(echo(value)).toEqual(value);
      expect(raw('$echo', '[{"$$a":1}]').json).toBe('{"$$a":1}');
    });

    it('keeps __proto__ as an ordinary key', () => {
      const value = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as object;
      const out = echo(value) as Record<string, unknown>;
      expect(Object.keys(out)).toEqual(['__proto__', 'a']);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    });

    it('round-trips lone surrogates and non-ASCII text', () => {
      for (const s of ['\ud800', 'a\udfffb', '\udc00\ud800', 'café ♫ 🎵', '\u0000 ']) {
        expect(echo(s)).toBe(s);
      }
      expect(raw('$echo', '["\\ud800"]').json).toBe('"\\ud800"');
    });

    it('leaves results writable, as the pure package does', () => {
      const out = echo({ a: [{ b: 1 }] }) as { a: { b: number }[] };
      expect(Object.isFrozen(out) || Object.isFrozen(out.a) || Object.isFrozen(out.a[0])).toBe(
        false,
      );
      out.a.push({ b: 2 });
      expect(echo({ a: [{ b: 1 }] })).toEqual({ a: [{ b: 1 }] });
    });

    it('cuts a cycle in an argument to an empty object', () => {
      const cyclic: Record<string, unknown> = { a: 1 };
      cyclic.self = cyclic;
      expect(echo(cyclic)).toEqual({ a: 1, self: {} });
    });

    it('rejects unknown and malformed tags', () => {
      for (const args of [
        '[{"$zz":1}]',
        '[{"$n":"1"}]',
        '[{"a":{"$u":1}}]',
        '[{"$big":"01"}]',
        '[{"$h":0,"$type":"$counter"}]',
        '[{"$cb":-1}]',
        '{}',
      ]) {
        const reply = raw('$echo', args);
        expect(reply.status, args).toBe(11);
        expect(JSON.parse(reply.json).code, args).toBe('BAD_REQUEST');
      }
    });
  });

  describe('errors', () => {
    const fail = (code: string, at?: number) =>
      thrown(() =>
        rt.call('$throw', [{ code, message: `m ${code}`, ...(at === undefined ? {} : { at }) }]),
      );

    it('raises the library classes for the library codes', () => {
      const invalid = fail('INVALID_INPUT');
      expect(invalid).toBeInstanceOf(InvalidInputError);
      expect(invalid).toBeInstanceOf(RangeError);
      expect(invalid).toMatchObject({
        code: 'INVALID_INPUT',
        name: 'InvalidInputError',
        message: 'm INVALID_INPUT',
      });
      const none = fail('NO_SOLUTION', 3) as NoSolutionError;
      expect(none).toBeInstanceOf(NoSolutionError);
      expect(none.at).toBe(3);
      expect((fail('NO_SOLUTION') as NoSolutionError).at).toBeUndefined();
      expect(fail('BUDGET_EXCEEDED')).toBeInstanceOf(BudgetExceededError);
      for (const e of [invalid, none, fail('BUDGET_EXCEEDED')])
        expect(isLibcantusError(e)).toBe(true);
    });

    it('raises TypeError for HOST_TYPE_ERROR and a coded Error for the boundary codes', () => {
      const type = fail('HOST_TYPE_ERROR');
      expect(type).toBeInstanceOf(TypeError);
      expect(isLibcantusError(type)).toBe(false);
      for (const code of [
        'UNKNOWN_OP',
        'BAD_REQUEST',
        'CALLBACK_FAILED',
        'RELEASED_HANDLE',
        'INTERNAL',
      ]) {
        const e = fail(code) as Error & { code: string };
        expect(e.constructor, code).toBe(Error);
        expect(e.code, code).toBe(code);
        expect(e.message, code).toBe(`m ${code}`);
        expect(isLibcantusError(e), code).toBe(false);
      }
    });

    it('reports every code with its fixed status', () => {
      const statuses: Record<string, number> = {
        INVALID_INPUT: 1,
        NO_SOLUTION: 2,
        BUDGET_EXCEEDED: 3,
        HOST_TYPE_ERROR: 4,
        UNKNOWN_OP: 10,
        BAD_REQUEST: 11,
        CALLBACK_FAILED: 12,
        RELEASED_HANDLE: 13,
        INTERNAL: 99,
      };
      for (const [code, status] of Object.entries(statuses)) {
        const reply = raw('$throw', JSON.stringify([{ code, message: 'x' }]));
        expect(reply.status, code).toBe(status);
        expect(JSON.parse(reply.json).code, code).toBe(code);
      }
    });

    it('reports an unknown op', () => {
      expect(thrown(() => rt.call('noSuchOp', []))).toMatchObject({
        code: 'UNKNOWN_OP',
        message: 'unknown op "noSuchOp"',
      });
    });
  });

  describe('callbacks', () => {
    it('calls a function argument and returns its result', () => {
      expect(rt.call('$call', [(a: number, b: number) => a + b, 1, 2])).toBe(3);
      expect(rt.call('$call', [(x: number) => Object.is(x, -0), -0])).toBe(true);
      expect(rt.call('$call', [() => undefined])).toBeUndefined();
    });

    it('rethrows the exact exception a callback raised', () => {
      const error = new SyntaxError('from the callback');
      expect(
        thrown(() =>
          rt.call('$call', [
            () => {
              throw error;
            },
          ]),
        ),
      ).toBe(error);
      const thrownValue = { not: 'an error' };
      expect(
        thrown(() =>
          rt.call('$call', [
            () => {
              throw thrownValue;
            },
          ]),
        ),
      ).toBe(thrownValue);
    });

    it('re-enters the core from inside a callback', () => {
      const inner = (x: number) => rt.call('$echo', [x * 2]);
      expect(rt.call('$call', [inner, 21])).toBe(42);
      const depth = (n: number): unknown => (n === 0 ? 'bottom' : rt.call('$call', [depth, n - 1]));
      expect(depth(5)).toBe('bottom');
    });

    it('keeps each frame its own error when calls nest', () => {
      const innerError = new Error('inner');
      const outer = () => {
        expect(
          thrown(() =>
            rt.call('$call', [
              () => {
                throw innerError;
              },
            ]),
          ),
        ).toBe(innerError);
        return 'outer survived';
      };
      expect(rt.call('$call', [outer])).toBe('outer survived');
    });

    // The pure backend answers with a timeline object of its own rather than echoing the input.
    it.runIf(NAME !== 'ts')('hands back the caller function a result echoes', () => {
      const at = () => null;
      const segments = [{ startBeat: 0, endBeat: 4, chord: null }];
      const result = rt.call('assertChordTimeline', [{ segments, at }]) as {
        segments: unknown;
        at: unknown;
      };
      expect(result.segments).toEqual(segments);
      expect(result.at).toBe(at);
      expect(echo(at)).toBe(at);
    });

    it('needs a host function for $cb arguments', () => {
      const reply = raw('$call', '[{"$cb":0}]');
      expect(reply.status).toBe(11);
    });
  });

  describe('handles', () => {
    it('calls methods and getters on a handle', () => {
      const c = counter(5);
      expect(c.next()).toBe(6);
      expect(c.value).toEqual({ count: 6 });
      c[Symbol.dispose]();
    });

    it('returns the same object for an unchanged getter result ($id)', () => {
      const c = counter();
      const first = c.value;
      expect(c.value).toBe(first);
      c.next();
      const second = c.value;
      expect(second).not.toBe(first);
      expect(second).toEqual({ count: 1 });
      // The pure package freezes the shared $counter state, so the facade does too.
      expect(Object.isFrozen(second)).toBe(true);
      c[Symbol.dispose]();
    });

    it('releases on dispose, and refuses a released handle', () => {
      const before = live();
      const c = counter();
      expect(live()).toBe(before + 1);
      c[Symbol.dispose]();
      expect(live()).toBe(before);
      expect(thrown(() => c.next())).toMatchObject({ code: 'RELEASED_HANDLE' });
      expect(thrown(() => c.value)).toMatchObject({ code: 'RELEASED_HANDLE' });
    });

    it('releases a handle the program dropped', async () => {
      const gc = (globalThis as { gc?: () => void }).gc;
      expect(typeof gc).toBe('function');
      const before = live();
      (() => {
        counter().next();
      })();
      for (let i = 0; i < 100 && live() > before; i += 1) {
        gc?.();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(live()).toBe(before);
    });
  });

  describe('retained values', () => {
    const notes = [60, 64].map((pitch) => ({ pitch, startBeat: 0, durationBeat: 4 }));
    const score = () => raw('Score.of', JSON.stringify([notes])).json;
    const retain = (value: string) => raw('$retain', `[${value}]`);
    const idOf = (reply: { json: string }) => (JSON.parse(reply.json) as { $ref: number }).$ref;
    const rejected = (reply: { status: number; json: string }, code: string, message: RegExp) => {
      expect(JSON.parse(reply.json).code).toBe(code);
      expect(JSON.parse(reply.json).message).toMatch(message);
    };

    it('holds a value under a reference that stands for its data', () => {
      const reply = retain(score());
      expect(reply.status).toBe(0);
      const id = idOf(reply);
      expect(reply.json).toBe(`{"$class":"Score","$ref":${id}}`);
      const byRef = raw('Score#secondsAt', `[{"$class":"Score","$ref":${id}},1.5]`);
      const byData = raw('Score#secondsAt', `[${score()},1.5]`);
      expect(byRef).toEqual(byData);
    });

    it('counts a retained value as live until it is released', () => {
      const before = live();
      const id = idOf(retain(score()));
      expect(live()).toBe(before + 1);
      backend.release(id);
      expect(live()).toBe(before);
      rejected(
        raw('Score#secondsAt', `[{"$class":"Score","$ref":${id}},1]`),
        'RELEASED_HANDLE',
        /released/,
      );
    });

    it('rejects a reference that names nothing, names another class, or carries data', () => {
      const id = idOf(retain(score()));
      rejected(
        raw('Score#secondsAt', '[{"$class":"Score","$ref":999999},1]'),
        'BAD_REQUEST',
        /^unknown handle 999999$/,
      );
      rejected(
        raw('Timeline#at', `[{"$class":"Timeline","$ref":${id}},1]`),
        'BAD_REQUEST',
        /^expected a "Timeline" instance$/,
      );
      rejected(
        raw('Score#secondsAt', `[{"$class":"Score","$ref":${id},"notes":[]},1]`),
        'BAD_REQUEST',
        /^malformed "\$class" tag$/,
      );
      backend.release(id);
    });

    it('refuses what the plain path refuses, and values holding callbacks', () => {
      const broken = '{"$class":"Score","notes":"x"}';
      expect(retain(broken)).toEqual(raw('Score#totalBeats', `[${broken}]`));
      rejected(retain('{"$class":"Score","notes":[],"f":{"$cb":0}}'), 'BAD_REQUEST', /callback/);
      rejected(retain('1'), 'BAD_REQUEST', /\$retain/);
    });

    it.runIf(NAME === 'node')('releases what a terminated worker still held', async () => {
      const before = live();
      // The worker keeps the ids in no object at all, so only its teardown can release them.
      const worker = new Worker(
        `const { parentPort, workerData } = require('node:worker_threads');
        import(workerData).then(({ backend }) => {
          const score = backend.call('Score.of', ${JSON.stringify(JSON.stringify([notes]))}, null);
          for (let i = 0; i < 3; i += 1) backend.call('$retain', '[' + score.json + ']', null);
          backend.call('$counter', '[]', null);
          setInterval(() => {}, 1000);
          parentPort.postMessage('held');
        });`,
        {
          eval: true,
          workerData: pathToFileURL(path.join(REPO, 'bindings/node/dist/backend.js')).href,
        },
      );
      await new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      expect(live()).toBe(before + 4);
      await worker.terminate();
      for (let i = 0; i < 100 && live() > before; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(live()).toBe(before);
    });
  });

  it('reports the version triple', () => {
    expect(rt.call('$version', [])).toEqual({
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      algorithmVersion: expect.any(Number),
      abiVersion: 1,
    });
  });

  it('replays the fixed corpus', () => {
    const dir = path.join(REPO, 'tests/corpus/fixtures');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(dir, f));
    expect(files.length).toBeGreaterThan(0);
    const result = replayCorpus(backend, files);
    expect(result.mismatches).toEqual([]);
    expect(result.replayed).toBeGreaterThan(0);
  });
});
