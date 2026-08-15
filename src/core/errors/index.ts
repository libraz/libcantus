/**
 * The library's error taxonomy.
 *
 * Every failure this library raises falls into one of three kinds, and the kind
 * decides what a caller can do about it. Batch-voicing a lead sheet, for
 * instance, has to tell "fix the input" apart from "loosen the constraints",
 * and a message string is not a contract.
 *
 * The classes extend the built-in error types a caller would otherwise catch —
 * a rejected argument is still a `RangeError` — so the `code` narrows an
 * existing category rather than replacing it.
 */

/**
 * What kind of failure an error reports.
 *
 * - `INVALID_INPUT`: an argument is malformed or out of range. The caller's
 *   input must change.
 * - `NO_SOLUTION`: the input is valid but nothing satisfies the constraints.
 *   The constraints must change, or the failure must be accepted.
 * - `BUDGET_EXCEEDED`: the requested work is larger than the synchronous
 *   generation budget. The request must be smaller, or the budget larger.
 *
 * @category Core
 */
export type LibcantusErrorCode = 'INVALID_INPUT' | 'NO_SOLUTION' | 'BUDGET_EXCEEDED';

/**
 * Any error this library raises, as a union of its three classes.
 *
 * The type a non-throwing entry point reports its failure as: a caller that
 * holds one of these already knows it carries a {@link LibcantusErrorCode} and
 * a message worth showing.
 *
 * @category Core
 */
export type LibcantusError = InvalidInputError | NoSolutionError | BudgetExceededError;

/**
 * The outcome of a parse that reports failure instead of throwing it.
 *
 * A text field is parsed on every keystroke, and most of those keystrokes are
 * halfway through a valid symbol, so failure is the normal case rather than an
 * exceptional one. The error travels in the result — not as `null` — because an
 * input field has to say what is wrong with what was typed.
 *
 * @typeParam T The value a successful parse produces.
 * @category Core
 * @example
 * ```ts
 * import { tryParseChordSymbol } from '@libraz/libcantus';
 * const result = tryParseChordSymbol('Cmaj');
 * const label = result.ok ? result.value.quality : result.error.message;
 * ```
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: LibcantusError };

/**
 * Report a caught value as a failed parse, or re-throw what is not ours.
 *
 * Not part of the package's public surface: the non-throwing parsers share it
 * so that a bug inside one of them surfaces as the crash it is instead of being
 * reported as invalid input.
 *
 * @param error The caught value.
 * @returns The failed parse result.
 */
export function parseFailure(error: unknown): { ok: false; error: LibcantusError } {
  if (isLibcantusError(error)) {
    return { ok: false, error };
  }
  throw error;
}

/**
 * Read a parse result, throwing its error when it failed.
 *
 * Not part of the package's public surface: it is how each throwing parser is
 * written on top of its non-throwing sibling, so the two cannot disagree about
 * what is valid.
 *
 * @param result The result to read.
 * @returns The parsed value.
 * @throws The result's own error when the parse failed.
 */
export function unwrapParse<T>(result: ParseResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

/**
 * A rejected argument: malformed, out of range, or naming something unknown.
 *
 * @category Core
 */
export class InvalidInputError extends RangeError {
  readonly code = 'INVALID_INPUT' as const;
  override readonly name = 'InvalidInputError';
}

/**
 * A valid request with no answer: no voicing fits the given ranges, no chord
 * matches the pitches, no preset claims the style.
 *
 * @category Core
 */
export class NoSolutionError extends Error {
  readonly code = 'NO_SOLUTION' as const;
  override readonly name = 'NoSolutionError';

  /**
   * Where in a sequence the failure occurred, when the operation was working
   * through one — the chord index of a progression, say.
   */
  readonly at: number | undefined;

  constructor(message: string, options: { at?: number } = {}) {
    super(message);
    this.at = options.at;
  }
}

/**
 * Work that would exceed the synchronous generation budget.
 *
 * @category Core
 */
export class BudgetExceededError extends RangeError {
  readonly code = 'BUDGET_EXCEEDED' as const;
  override readonly name = 'BudgetExceededError';
}

/**
 * Whether a caught value is one of this library's coded errors.
 *
 * @param value The caught value.
 * @returns True when it carries a {@link LibcantusErrorCode}.
 * @example
 * ```ts
 * import { isLibcantusError, voiceChord, parseChordSymbol } from '@libraz/libcantus';
 * try {
 *   voiceChord(parseChordSymbol('C'), { ranges: [] });
 * } catch (error) {
 *   if (isLibcantusError(error) && error.code === 'NO_SOLUTION') {
 *     // loosen the constraints rather than blaming the input
 *   }
 * }
 * ```
 * @category Core
 */
export function isLibcantusError(
  value: unknown,
): value is InvalidInputError | NoSolutionError | BudgetExceededError {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return false;
  }
  const code = value.code;
  return code === 'INVALID_INPUT' || code === 'NO_SOLUTION' || code === 'BUDGET_EXCEEDED';
}
