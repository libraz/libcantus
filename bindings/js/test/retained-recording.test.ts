/**
 * What the corpus recorder is handed when the facade sends values by reference: the arguments
 * written out as the data the references stand for, as if every call had sent its data.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../src/backend.js';
import type { RecordedCall } from '../src/backends/ts.js';
import { BY_REFERENCE, CLASSES, TYPES } from '../src/generated/meta.js';
import { Runtime, type RuntimeOptions } from '../src/runtime.js';

const note = (pitch: number) => ({ pitch, startBeat: 0, durationBeat: 4 });
const NOTES = [60, 64, 67].map(note);
const TRACKS = [{ role: 'melody', notes: NOTES }];
const EDITS = [{ trackIndex: 0, notes: NOTES.slice(0, 2) }];

const recorded: RecordedCall[] = [];
vi.stubEnv('CANTUS_RECORD', '1');
vi.doMock('../../../tools/corpus/record.mjs', () => ({
  createRecorder: () => (call: RecordedCall) => recorded.push(call),
}));
const { backend } = (await import('../src/backends/ts.js')) as { backend: Backend };
afterAll(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('../../../tools/corpus/record.mjs');
});

function runtime(options: RuntimeOptions): Runtime {
  const rt = new Runtime(backend, TYPES, options);
  for (const name of CLASSES) {
    const cls = class {};
    Object.defineProperty(cls, 'name', { value: name });
    rt.registerClass(name, cls);
  }
  return rt;
}

/** The recorder's view of a call: its arguments with every `$ref` key removed, as it writes them. */
const stripRefs = (text: string): unknown =>
  JSON.parse(text, (key, value) => (key === '$ref' ? undefined : value));
const written = (call: RecordedCall): unknown => stripRefs(call.argsJson);

/** Run `scenario` and return the calls the recorder saw for the ops it names. */
function record(options: RuntimeOptions, scenario: (rt: Runtime) => void, ops: string[]) {
  recorded.length = 0;
  scenario(runtime(options));
  return recorded.filter((c) => ops.includes(c.op));
}

describe('recording calls that send references', () => {
  it('hands the recorder a retained class receiver as its data', () => {
    const scenario = (rt: Runtime) => {
      const score = rt.call('Score.of', [NOTES]);
      rt.call('Score#secondsAt', [score, 1.5]);
      rt.call('Score#secondsAt', [score, 2]);
    };
    const ops = ['Score#secondsAt'];
    const byRef = record({ byReference: BY_REFERENCE }, scenario, ops);
    const plain = record({}, scenario, ops);
    expect(byRef).toHaveLength(2);
    expect(byRef.map((c) => c.argsJson)).toEqual(plain.map((c) => c.argsJson));
    for (const call of byRef) expect(call.argsJson).not.toContain('$ref');
    expect(byRef.map((c) => c.incomplete)).toEqual([false, false]);
  });

  it('hands the recorder a retained hybrid receiver as its payload', () => {
    const scenario = (rt: Runtime) => {
      const { timeline } = rt.call('chordTimelineFromNotes', [NOTES, { key: 'C major' }]) as {
        timeline: object;
      };
      rt.call('ChordTimeline#at', [timeline, 0]);
      rt.call('ChordTimeline#at', [timeline, 1]);
    };
    const ops = ['ChordTimeline#at'];
    const byRef = record({ byReference: BY_REFERENCE }, scenario, ops);
    const plain = record({}, scenario, ops);
    expect(byRef.map(written)).toEqual(plain.map(written));
    for (const call of byRef) {
      expect(call.argsJson).toContain('"segments"');
      expect(call.argsJson).not.toMatch(/\{"\$hy":"ChordTimeline","\$ref":\d+\}/);
      expect(call.incomplete).toBe(false);
    }
  });

  it('hands the recorder the data of an arrangement an update retained', () => {
    const scenario = (rt: Runtime) => {
      const arrangement = rt.call('Arrangement.of', [TRACKS]);
      rt.call('Arrangement#tracks', [arrangement]);
      const next = rt.call('Arrangement#update', [arrangement, EDITS]);
      rt.call('Arrangement#analysis', [next]);
    };
    const ops = ['Arrangement#tracks', 'Arrangement#update', 'Arrangement#analysis'];
    const byRef = record({ byReference: BY_REFERENCE }, scenario, ops);
    const plain = record({}, scenario, ops);
    expect(byRef.map((c) => c.op)).toEqual(ops);
    expect(byRef.map(written)).toEqual(plain.map(written));
    expect(byRef.map((c) => stripRefs(c.reply.json))).toEqual(
      plain.map((c) => stripRefs(c.reply.json)),
    );
    expect(byRef[0]?.argsJson).not.toContain('$ref');
    expect(byRef[1]?.reply.json).toMatch(/"\$class":"Arrangement".*"\$ref":\d+\}$/);
  });
});
