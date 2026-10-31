/**
 * Values the core holds by reference: what the facade sends for a retained receiver, when it
 * releases and evicts, and the handle properties it reads once. Runs against the pure TS backend.
 */
import { describe, expect, it } from 'vitest';
import * as Pure from '../../../ts/src/index.js';
import type { Backend } from '../src/backend.js';
import { backend } from '../src/backends/ts.js';
import { BY_REFERENCE, CLASSES, TYPES } from '../src/generated/meta.js';
import { Runtime, type RuntimeOptions } from '../src/runtime.js';

const note = (pitch: number) => ({ pitch, startBeat: 0, durationBeat: 4 });
const NOTES = [60, 64, 67].map(note);
const TRACKS = [{ role: 'melody' as const, notes: NOTES }];

type Event = { op: string; argsJson: string } | { release: number };

/** A runtime over the pure TS backend that logs every call and release it makes. */
function observed(options: RuntimeOptions = { byReference: BY_REFERENCE }) {
  const events: Event[] = [];
  const spy: Backend = {
    call(op, argsJson, cb) {
      events.push({ op, argsJson });
      return backend.call(op, argsJson, cb);
    },
    release(id) {
      events.push({ release: id });
      backend.release(id);
    },
  };
  const rt = new Runtime(spy, TYPES, options);
  for (const name of CLASSES) {
    const cls = class {};
    Object.defineProperty(cls, 'name', { value: name });
    rt.registerClass(name, cls);
  }
  const calls = () => events.filter((e): e is { op: string; argsJson: string } => 'op' in e);
  const last = () => calls().at(-1)?.argsJson ?? '';
  return { rt, events, calls, last };
}

/** A value as JSON text, which leaves out the functions a hybrid carries. */
const plainJson = (value: unknown) => JSON.stringify(value);

const live = () => JSON.parse(backend.call('$live', '[]', null).json) as number;

/** Collect garbage until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  for (let i = 0; i < 200 && !done(); i += 1) {
    gc?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Run the collector a few times, long enough for finalizers to have run. */
async function settle(): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  for (let i = 0; i < 10; i += 1) {
    gc?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a retained class receiver', () => {
  it('is retained on its first use as a receiver and sent as a reference after', () => {
    const { rt, calls, last } = observed();
    const score = rt.call('Score.of', [NOTES]);
    const data = backend.call('Score.of', JSON.stringify([NOTES]), null).json;

    expect(rt.call('Score#secondsAt', [score, 1.5])).toBe(Pure.Score.of(NOTES).secondsAt(1.5));
    expect(calls().map((c) => c.op)).toEqual(['Score.of', '$retain', 'Score#secondsAt']);
    expect(calls()[1]?.argsJson).toBe(`[${data}]`);
    expect(last()).toMatch(/^\[\{"\$class":"Score","\$ref":[1-9]\d*\},1\.5\]$/);

    const ref = last();
    expect(rt.call('Score#secondsAt', [score, 1.5])).toBe(Pure.Score.of(NOTES).secondsAt(1.5));
    expect(
      calls()
        .map((c) => c.op)
        .slice(3),
    ).toEqual(['Score#secondsAt']);
    expect(last()).toBe(ref);
  });

  it('answers as the plain path does, errors included', () => {
    const byRef = observed();
    const plain = observed({});
    const outcome = (rt: Runtime, beat: number) => {
      const score = rt.call('Score.of', [NOTES]);
      try {
        return rt.call('Score#secondsAt', [score, beat]);
      } catch (error) {
        return (error as Error).message;
      }
    };
    for (const beat of [0, 2.5, 100, -1, Number.NaN]) {
      expect(outcome(byRef.rt, beat)).toEqual(outcome(plain.rt, beat));
    }
    expect(plain.calls().some((c) => c.op === '$retain' || c.argsJson.includes('$ref'))).toBe(
      false,
    );
  });

  it('is sent as a reference in any position once retained', () => {
    const { rt, last } = observed();
    const a = rt.call('Score.of', [NOTES]);
    const b = rt.call('Score.of', [[note(62)]]);
    rt.call('Score#totalBeats', [a]);
    rt.call('Score#totalBeats', [b]);
    expect(rt.call('Score#equals', [a, b])).toBe(false);
    expect(last()).toMatch(
      /^\[\{"\$class":"Score","\$ref":\d+\},\{"\$class":"Score","\$ref":\d+\}\]$/,
    );
  });

  it('sends data for a type that is not by reference', () => {
    const { rt, calls } = observed({ byReference: ['Timeline'] });
    const score = rt.call('Score.of', [NOTES]);
    rt.call('Score#totalBeats', [score]);
    expect(calls().map((c) => c.op)).toEqual(['Score.of', 'Score#totalBeats']);
    expect(calls()[1]?.argsJson).toContain('"notes"');
  });
});

describe('a retained hybrid receiver', () => {
  const timelineOf2 = (rt: Runtime, notes: readonly object[]) =>
    (rt.call('chordTimelineFromNotes', [notes, { key: 'C major' }]) as { timeline: object })
      .timeline;
  const timelineOf = (rt: Runtime) => timelineOf2(rt, NOTES);

  it('is sent as a reference only to its own methods', () => {
    const { rt, calls, last } = observed();
    const timeline = timelineOf(rt);
    const want = Pure.chordTimelineFromNotes(NOTES, { key: 'C major' }).timeline.at(0);

    expect(rt.call('ChordTimeline#at', [timeline, 0])).toEqual(want);
    expect(
      calls()
        .slice(-2)
        .map((c) => c.op),
    ).toEqual(['$retain', 'ChordTimeline#at']);
    expect(last()).toMatch(/^\[\{"\$hy":"ChordTimeline","\$ref":[1-9]\d*\},0\]$/);

    rt.call('ChordTimeline#at', [timeline, 0]);
    expect(calls().at(-1)?.op).toBe('ChordTimeline#at');
    expect(calls().at(-2)?.op).toBe('ChordTimeline#at');

    rt.call('analyzeArrangement', [TRACKS, { key: 'C major', timeline }]);
    expect(last()).toMatch(/"timeline":\{"\$hy":"ChordTimeline","segments":\[/);
    expect(last()).not.toMatch(/\{"\$hy":"ChordTimeline","\$ref":\d+\}/);
  });

  it('is retained with the fields written before its first method call', () => {
    const { rt, calls } = observed();
    type Segments = { segments: { chord: unknown }[] };
    const timeline = timelineOf(rt) as Segments;
    const g = (timelineOf2(rt, [67, 71, 74].map(note)) as Segments).segments[0]?.chord;
    (timeline.segments[0] as { chord: unknown }).chord = g;
    rt.call('ChordTimeline#at', [timeline, 0]);
    const [retain, at] = calls().slice(-2);
    expect(retain?.op).toBe('$retain');
    // The pure backend answers from the timeline it issued; the core reads the text retained.
    expect(retain?.argsJson).toContain(`"chord":${JSON.stringify(g)}`);
    expect(at?.argsJson).toMatch(/^\[\{"\$hy":"ChordTimeline","\$ref":[1-9]\d*\},0\]$/);
  });
});

describe('release', () => {
  it('lets go of references when their instances are collected', async () => {
    await until(() => false);
    const { rt } = observed();
    const before = live();
    (() => {
      const score = rt.call('Score.of', [NOTES]);
      rt.call('Score#totalBeats', [score]);
      expect(rt.retainedRefs).toBe(1);
      expect(live()).toBe(before + 1);
    })();
    await until(() => live() === before);
    expect(live()).toBe(before);
    expect(rt.retainedRefs).toBe(0);
  });

  it('lets go of the hybrid references a result carried', async () => {
    const { rt } = observed();
    await until(() => false);
    const before = live();
    (() => {
      const result = rt.call('chordTimelineFromNotes', [NOTES]) as { timeline: object };
      rt.call('analyzeArrangement', [TRACKS, { timeline: result.timeline }]);
      expect(live()).toBeGreaterThan(before);
    })();
    await until(() => live() === before);
    expect(live()).toBe(before);
  });

  it('keeps a hybrid reference that a class instance still names', async () => {
    const { rt } = observed();
    await settle();
    const before = live();
    const composer = (() => {
      const rng = rt.call('createPositionalRng', [7]);
      return rt.call('Composer.of', [{ rng }]);
    })();
    await settle();
    expect(live()).toBe(before + 1);
    expect(rt.call('Composer#equals', [composer, composer])).toBe(true);
  });
});

describe('the reference cap', () => {
  it('releases the least recently used after the call that went over, and the instance still answers', () => {
    const { rt, events, calls, last } = observed({ byReference: BY_REFERENCE, maxRefs: 2 });
    const scores = [60, 62, 64].map((p) => rt.call('Score.of', [[note(p)]]));
    const answers = scores.map((s) => rt.call('Score#secondsAt', [s, 1]));
    expect(answers).toEqual([60, 62, 64].map((p) => Pure.Score.of([note(p)]).secondsAt(1)));
    expect(rt.retainedRefs).toBe(2);

    const at = events.findIndex((e) => 'release' in e);
    const third = events.map((e) => ('op' in e ? e.op : '')).lastIndexOf('Score#secondsAt');
    expect(at).toBeGreaterThan(third);
    expect(events.filter((e) => 'release' in e)).toHaveLength(1);

    const before = calls().length;
    const again = rt.call('Score#secondsAt', [scores[0], 1]);
    expect(again).toBe(answers[0]);
    expect(
      calls()
        .slice(before)
        .map((c) => c.op),
    ).toEqual(['$retain', 'Score#secondsAt']);
    expect(last()).toMatch(/\{"\$class":"Score","\$ref":\d+\}/);
    expect(rt.retainedRefs).toBe(2);
  });

  it('holds MAX_LIVE_REFS references and MAX_REF_BYTES of text by default', async () => {
    const { MAX_LIVE_REFS, MAX_REF_BYTES } = await import('../src/runtime.js');
    expect(MAX_LIVE_REFS).toBe(1024);
    expect(MAX_REF_BYTES).toBe(4 * 1024 * 1024);
  });

  it('holds what a synchronous loop retains to the byte budget, and every answer is right', () => {
    const text = (p: number) => backend.call('Score.of', JSON.stringify([[note(p)]]), null).json;
    const budget = 3 * text(60).length;
    const { rt, events } = observed({ byReference: BY_REFERENCE, maxRefBytes: budget });
    for (let p = 60; p < 80; p += 1) {
      const score = rt.call('Score.of', [[note(p)]]);
      expect(rt.call('Score#secondsAt', [score, 1])).toBe(Pure.Score.of([note(p)]).secondsAt(1));
      expect(rt.retainedBytes).toBeLessThanOrEqual(budget);
    }
    expect(rt.retainedRefs).toBe(3);
    expect(events.filter((e) => 'release' in e)).toHaveLength(17);
  });

  it('never retains a value larger than the byte budget', () => {
    const { rt, calls } = observed({ byReference: BY_REFERENCE, maxRefBytes: 10 });
    const score = rt.call('Score.of', [NOTES]);
    rt.call('Score#secondsAt', [score, 1]);
    expect(rt.call('Score#secondsAt', [score, 1])).toBe(Pure.Score.of(NOTES).secondsAt(1));
    expect(calls().map((c) => c.op)).toEqual(['Score.of', 'Score#secondsAt', 'Score#secondsAt']);
    expect(rt.retainedRefs).toBe(0);
  });

  it('reads no reference at a call return while under both caps', () => {
    const { rt } = observed();
    const scores = Array.from({ length: 1000 }, (_, i) => rt.call('Score.of', [[note(i % 128)]]));
    for (const score of scores) rt.call('Score#totalBeats', [score]);
    expect(rt.retainedRefs).toBe(1000);
    const deref = WeakRef.prototype.deref;
    let reads = 0;
    WeakRef.prototype.deref = function (this: WeakRef<object>) {
      reads += 1;
      return deref.call(this);
    };
    try {
      rt.call('Score#totalBeats', [scores[0]]);
    } finally {
      WeakRef.prototype.deref = deref;
    }
    expect(reads).toBe(0);
    expect(rt.retainedRefs).toBe(1000);
  });

  it('releases a reference whose instance is gone once, at a call return or by its finalizer', async () => {
    const { rt, events, last } = observed();
    (() => {
      const score = rt.call('Score.of', [[note(61)]]);
      rt.call('Score#totalBeats', [score]);
    })();
    const id = Number(/"\$ref":(\d+)/.exec(last())?.[1]);
    await until(() => {
      rt.call('$live', []);
      return rt.retainedRefs === 0;
    });
    await settle();
    expect(rt.retainedRefs).toBe(0);
    expect(rt.retainedBytes).toBe(0);
    expect(events.filter((e) => 'release' in e && e.release === id)).toHaveLength(1);
  });
});

describe('Arrangement#update', () => {
  const edits = [{ trackIndex: 0, notes: NOTES.slice(0, 2) }];

  it('retains its result when the receiver went by reference', () => {
    const { rt, calls, last } = observed();
    const arrangement = rt.call('Arrangement.of', [TRACKS]);
    rt.call('Arrangement#tracks', [arrangement]);
    const next = rt.call('Arrangement#update', [arrangement, edits]);
    const reply = backend.call(
      'Arrangement#update',
      `[${calls().at(-1)?.argsJson.slice(1, -1)}]`,
      null,
    ).json;
    expect(JSON.parse(reply).$ref).toBeTypeOf('number');
    expect(rt.retainedRefs).toBe(2);

    const before = calls().length;
    const analysis = rt.call('Arrangement#analysis', [next]);
    expect(
      calls()
        .slice(before)
        .map((c) => c.op),
    ).toEqual(['Arrangement#analysis']);
    expect(last()).toMatch(/^\[\{"\$class":"Arrangement","\$ref":\d+\}\]$/);
    expect(plainJson(analysis)).toBe(plainJson(Pure.Arrangement.of(TRACKS).update(edits).analysis));
    expect(rt.call('Arrangement#toJSON', [next])).toEqual(
      Pure.Arrangement.of(TRACKS).update(edits).toJSON(),
    );
  });

  it('answers without a reference when the receiver went as data', () => {
    const { rt, calls } = observed({});
    const arrangement = rt.call('Arrangement.of', [TRACKS]);
    rt.call('Arrangement#update', [arrangement, edits]);
    expect(calls().some((c) => c.op === '$retain')).toBe(false);
    expect(rt.retainedRefs).toBe(0);
  });
});

describe('stable handle properties', () => {
  it('are read once per handle', () => {
    const { rt, calls } = observed();
    const session = rt.call('createArrangementSession', [TRACKS]) as {
      tracks: unknown;
      analysis: unknown;
    } & Disposable;
    const first = session.analysis;
    const reads = calls().length;
    expect(session.analysis).toBe(first);
    expect(session.tracks).toBe(session.tracks);
    expect(calls().length).toBe(reads + 1);
    expect(plainJson(first)).toBe(plainJson(Pure.createArrangementSession(TRACKS).analysis));
    session[Symbol.dispose]();
  });

  it('are read from the core again after release, which fails', () => {
    const { rt } = observed();
    const session = rt.call('createArrangementSession', [TRACKS]) as {
      tracks: unknown;
    } & Disposable;
    expect(session.tracks).toBe(session.tracks);
    session[Symbol.dispose]();
    expect(() => session.tracks).toThrow(/released/);
  });

  it('do not cover the properties of a handle that changes', () => {
    const { rt, calls } = observed();
    const counter = rt.call('$counter', []) as { next(): number; value: unknown } & Disposable;
    const before = calls().length;
    expect(counter.value).toEqual({ count: 0 });
    counter.next();
    expect(counter.value).toEqual({ count: 1 });
    expect(calls().length - before).toBe(3);
    counter[Symbol.dispose]();
  });
});
