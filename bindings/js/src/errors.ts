/**
 * The facade's error classes and the mapping from a failed call to the error
 * it raises.
 *
 * The three library classes mirror the pure TS ones member for member, so a
 * caller written against either package catches the same things. Codes the op
 * boundary adds (`HOST_TYPE_ERROR` onwards) surface as the language error the
 * pure package would have raised, or as an `Error` carrying the code.
 */

/**
 * What kind of failure an error reports.
 *
 * - `INVALID_INPUT`: an argument is malformed or out of range.
 * - `NO_SOLUTION`: the input is valid but nothing satisfies the constraints.
 * - `BUDGET_EXCEEDED`: the requested work is larger than the generation budget.
 */
export type LibcantusErrorCode = 'INVALID_INPUT' | 'NO_SOLUTION' | 'BUDGET_EXCEEDED';

/** Any error this library raises, as a union of its three classes. */
export type LibcantusError = InvalidInputError | NoSolutionError | BudgetExceededError;

/** A rejected argument: malformed, out of range, or naming something unknown. */
export class InvalidInputError extends RangeError {
  readonly code = 'INVALID_INPUT' as const;
  override readonly name = 'InvalidInputError';
}

/** A valid request with no answer. */
export class NoSolutionError extends Error {
  readonly code = 'NO_SOLUTION' as const;
  override readonly name = 'NoSolutionError';

  /** Where in a sequence the failure occurred, when the operation was working through one. */
  readonly at: number | undefined;

  constructor(message: string, options: { at?: number } = {}) {
    super(message);
    this.at = options.at;
  }
}

/** Work that would exceed the synchronous generation budget. */
export class BudgetExceededError extends RangeError {
  readonly code = 'BUDGET_EXCEEDED' as const;
  override readonly name = 'BudgetExceededError';
}

/**
 * Whether a caught value is one of this library's coded errors.
 *
 * @param value The caught value.
 * @returns True when it carries a {@link LibcantusErrorCode}.
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

/** C ABI status of every failure code (`CantusStatus`); 0 is success. */
export const ERROR_CODES = {
  INVALID_INPUT: 1,
  NO_SOLUTION: 2,
  BUDGET_EXCEEDED: 3,
  HOST_TYPE_ERROR: 4,
  UNKNOWN_OP: 10,
  BAD_REQUEST: 11,
  CALLBACK_FAILED: 12,
  RELEASED_HANDLE: 13,
  INTERNAL: 99,
} as const;

/** A failure code of the op boundary. */
export type ErrorCodeName = keyof typeof ERROR_CODES;

/** The `name` field the boundary reports for each code: the JS class the facade raises. */
export const ERROR_NAMES: Readonly<Record<ErrorCodeName, string>> = Object.freeze({
  INVALID_INPUT: 'InvalidInputError',
  NO_SOLUTION: 'NoSolutionError',
  BUDGET_EXCEEDED: 'BudgetExceededError',
  HOST_TYPE_ERROR: 'TypeError',
  UNKNOWN_OP: 'Error',
  BAD_REQUEST: 'Error',
  CALLBACK_FAILED: 'Error',
  RELEASED_HANDLE: 'Error',
  INTERNAL: 'Error',
});

/** The wire form of a failed call: `{"code","name","message","at"?}`. */
export type ErrorReply = {
  code: ErrorCodeName;
  name: string;
  message: string;
  at?: number;
};

/** An `Error` raised for a boundary code that has no library class. */
export type BoundaryError = Error & { code: ErrorCodeName };

/**
 * The error a failed call raises in JS.
 *
 * `CALLBACK_FAILED` is not handled here: the caller rethrows the exception the
 * callback raised, which only it holds.
 *
 * @param reply The parsed error reply.
 * @returns The error to throw.
 */
export function errorFromReply(reply: ErrorReply): Error {
  switch (reply.code) {
    case 'INVALID_INPUT':
      return new InvalidInputError(reply.message);
    case 'NO_SOLUTION':
      return new NoSolutionError(reply.message, reply.at === undefined ? {} : { at: reply.at });
    case 'BUDGET_EXCEEDED':
      return new BudgetExceededError(reply.message);
    case 'HOST_TYPE_ERROR':
      return new TypeError(reply.message);
    case 'UNKNOWN_OP':
    case 'BAD_REQUEST':
    case 'CALLBACK_FAILED':
    case 'RELEASED_HANDLE':
    case 'INTERNAL':
      return Object.assign(new Error(reply.message), { code: reply.code });
  }
  return Object.assign(new Error(reply.message), { code: 'INTERNAL' as const });
}
