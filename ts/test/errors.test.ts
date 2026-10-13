import { describe, expect, it, vi } from 'vitest';
import type * as errors from '../src/core/errors/index.js';
import { isLibcantusError, NoSolutionError } from '../src/core/errors/index.js';

/** Run `fn` and return whatever it threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('failures are told apart by code, not by message', () => {
  it('recognizes the coded error contract across a second module copy', async () => {
    // A CommonJS build without shared chunks emits the error classes twice, once
    // for the root entry and once for a subpath. Resetting the registry gives the
    // same two identities here: `instanceof` cannot answer across them, so the
    // structural check is the only thing a host can catch by.
    vi.resetModules();
    const other = (await import('../src/core/errors/index.js')) as typeof errors;
    expect(other.NoSolutionError).not.toBe(NoSolutionError);

    const foreign = thrown(() => {
      throw new other.NoSolutionError('no voicing satisfies the constraints', { at: 2 });
    });
    expect(foreign).not.toBeInstanceOf(NoSolutionError);
    expect(foreign).toBeInstanceOf(other.NoSolutionError);
    expect(isLibcantusError(foreign)).toBe(true);
    expect(isLibcantusError(foreign) && foreign.code).toBe('NO_SOLUTION');
    expect(isLibcantusError(foreign) && foreign.code === 'NO_SOLUTION' && foreign.at).toBe(2);

    // The check stays a structural one in both directions: this copy's error is
    // recognized by the other copy's predicate too.
    const mine = new NoSolutionError('no voicing satisfies the constraints');
    expect(mine).not.toBeInstanceOf(other.NoSolutionError);
    expect(other.isLibcantusError(mine)).toBe(true);
  });
});
