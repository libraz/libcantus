/**
 * Where the facade freezes results, and what its handles accept, against the pure package: for the
 * same call, every object on the result is frozen on the facade exactly when it is on the pure side.
 */
import { describe, expect, it } from 'vitest';
import * as Pure from '../../../ts/src/index.js';
import { backend } from '../src/backends/ts.js';
import * as Facade from '../src/index.js';
import { Runtime } from '../src/runtime.js';

// biome-ignore lint/suspicious/noExplicitAny: the two packages are driven through one loose view.
type Fn = (...args: any[]) => any;
type Fns = Record<
  | 'chordTimelineFromNotes'
  | 'createArrangementSession'
  | 'analyzeArrangement'
  | 'createNoteEventIndex'
  | 'createRng',
  Fn
>;
const pure = Pure as unknown as Fns;
const facade = Facade as unknown as Fns;

const NOTES = [60, 64, 67].map((pitch) => ({ pitch, startBeat: 0, durationBeat: 4 }));
const TRACKS = [{ role: 'melody', notes: NOTES }];

/** Whether each object reachable from `value` is frozen, by path; instances of classes are leaves. */
function frozenMap(value: unknown, at = '$', out: Record<string, boolean> = {}) {
  if (typeof value !== 'object' || value === null) return out;
  out[at] = Object.isFrozen(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && !Array.isArray(value)) return out;
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (typeof child !== 'function') frozenMap(child, `${at}.${key}`, out);
  }
  return out;
}

/** Run `scenario` on the pure package and on the facade and compare the frozen maps it returns. */
function same(scenario: (api: Fns) => Record<string, unknown>): void {
  const want = scenario(pure);
  const got = scenario(facade);
  for (const name of Object.keys(want)) {
    expect(frozenMap(got[name]), name).toEqual(frozenMap(want[name]));
  }
}

describe('frozen results match the pure package', () => {
  it('chords a timeline analysis shares are frozen with their intervals', () => {
    same((api) => {
      const result = api.chordTimelineFromNotes(NOTES, { key: 'C major' });
      return { result, at: result.timeline.at(0), segments: result.timeline.segments };
    });
  });

  it('an arrangement analysis and its session', () => {
    same((api) => {
      const session = api.createArrangementSession(TRACKS);
      const next = session.update([{ trackIndex: 0, notes: NOTES.slice(0, 2) }]);
      return {
        analyzed: api.analyzeArrangement(TRACKS),
        tracks: session.tracks,
        analysis: session.analysis,
        updated: next.analysis,
      };
    });
  });

  it('a note index freezes its notes and not its onset lists', () => {
    same((api) => {
      const index = api.createNoteEventIndex(NOTES);
      return {
        notes: index.notes,
        at: index.at(1),
        onsets: index.onsetsBetween(0, 4),
        attacks: index.attacksAt(0),
      };
    });
  });
});

describe('handles', () => {
  it('accept the writes the pure object accepts', () => {
    for (const api of [pure, facade]) {
      const rng = api.createRng(1);
      rng.extra = 1;
      expect(rng.extra).toBe(1);
      delete rng.extra;
      expect('extra' in rng).toBe(false);
      const index = api.createNoteEventIndex(NOTES);
      index.notes = [];
      expect(index.notes).toEqual([]);
      expect(typeof index.at).toBe('function');
    }
  });
});

describe('handle bookkeeping', () => {
  it('forgets handles that were disposed', () => {
    const rt = new Runtime(backend);
    const before = rt.trackedHandles;
    const handles = Array.from({ length: 20 }, () => rt.call('$counter', []) as Disposable);
    expect(rt.trackedHandles).toBe(before + 20);
    for (const handle of handles) handle[Symbol.dispose]();
    expect(rt.trackedHandles).toBe(before);
  });
});

describe('arguments', () => {
  it('pass a class instance by the methods it inherits', () => {
    class Rng {
      at(): number {
        return 0.1;
      }
    }
    expect(Facade.includeAt(new Rng(), 0.3, 'g', 4)).toBe(Pure.includeAt(new Rng(), 0.3, 'g', 4));
  });

  it('call back a hybrid method passed as a function', () => {
    const outcome = (api: typeof Pure) => {
      try {
        return api.Score.of(NOTES).filter(api.createPositionalRng(1).at as never);
      } catch (error) {
        return { name: (error as Error).name, message: (error as Error).message };
      }
    };
    expect(outcome(Facade as unknown as typeof Pure)).toEqual(outcome(Pure));
  });
});
