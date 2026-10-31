/**
 * What the facade's encoder sends for awkward arguments: nesting past the core's limit, built-in
 * objects and getters that throw. Rejections read as they do in the pure package.
 */
import { describe, expect, it } from 'vitest';
import * as Pure from '../../../ts/src/index.js';
import type { Backend } from '../src/backend.js';
import { backend } from '../src/backends/ts.js';
import { TYPES } from '../src/generated/meta.js';
import * as Facade from '../src/index.js';
import { MAX_DEPTH, Runtime } from '../src/runtime.js';

/**
 * A runtime whose backend records the argument text of every call; `answer` replies `null`
 * instead of running the op.
 */
function recorded(answer = false) {
  const sent: string[] = [];
  const spy: Backend = {
    call(op, argsJson, cb) {
      sent.push(argsJson);
      return answer ? { status: 0, json: 'null' } : backend.call(op, argsJson, cb);
    },
    release: (id) => backend.release(id),
  };
  return { rt: new Runtime(spy, TYPES), sent };
}

/** `levels` arrays nested in one another. */
function nested(levels: number): unknown {
  let value: unknown = 0;
  for (let i = 0; i < levels; i += 1) value = [value];
  return value;
}

/** The error a call throws. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

/** Pure and facade answers for one call: the same message from the same error class. */
function sameRejection(call: (lib: typeof Pure) => unknown) {
  const pure = thrown(() => call(Pure)) as Error;
  const facade = thrown(() => call(Facade as unknown as typeof Pure)) as Error;
  expect(pure).toBeInstanceOf(Pure.InvalidInputError);
  expect(facade).toBeInstanceOf(Facade.InvalidInputError);
  expect(facade.message).toBe(pure.message);
}

describe('nesting', () => {
  it(`sends an argument ${MAX_DEPTH} levels deep`, () => {
    const { rt, sent } = recorded(true);
    expect(MAX_DEPTH).toBe(4096);
    rt.call('$echo', [nested(MAX_DEPTH)]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(`[${'['.repeat(MAX_DEPTH)}0${']'.repeat(MAX_DEPTH)}]`);
  });

  it('refuses a deeper argument with BAD_REQUEST before it is sent', () => {
    const { rt, sent } = recorded(true);
    for (const value of [nested(MAX_DEPTH + 1), nested(100_000)]) {
      const error = thrown(() => rt.call('$echo', [value])) as Error & { code?: string };
      expect(error).not.toBeInstanceOf(RangeError);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe(`invalid args JSON: nesting deeper than ${MAX_DEPTH}`);
    }
    expect(sent).toHaveLength(0);
  });

  it('counts the levels a hybrid field adds', () => {
    const { rt } = recorded();
    const timeline = (rt.call('chordTimelineFromNotes', [[]]) as { timeline: object }).timeline;
    (timeline as { segments: unknown }).segments = nested(MAX_DEPTH);
    const error = thrown(() => rt.call('$echo', [timeline])) as Error & { code?: string };
    expect(error.code).toBe('BAD_REQUEST');
  });
});

describe('a rejected value', () => {
  it('reads as the pure package reads a built-in object', () => {
    // biome-ignore lint/style/useConsistentBuiltinInstantiation: a boxed number is one of the cases.
    const boxed = new Number(60.5);
    for (const value of [new Map([[1, 2]]), new Set([1]), /x/, boxed, new Error('e')]) {
      sameRejection((lib) => lib.midiToNote(value as unknown as number));
    }
  });

  it('reads as the pure package reads an object whose getter throws', () => {
    const value = {
      get pitch(): number {
        throw new Error('read');
      },
    };
    sameRejection((lib) => lib.midiToNote(value as unknown as number));
  });

  it('still sends the fields of a user class instance and of a plain object', () => {
    class Note {
      pitch = 60;
      startBeat = 0;
      durationBeat = 1;
    }
    const FacadeScore = Facade.Score as unknown as typeof Pure.Score;
    expect(FacadeScore.of([new Note()]).totalBeats).toBe(Pure.Score.of([new Note()]).totalBeats);
    const { rt, sent } = recorded();
    rt.call('$echo', [{ a: 1 }]);
    expect(sent[0]).toBe('[{"a":1}]');
  });
});
