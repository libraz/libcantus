/**
 * Deep freezing for the built-in dictionaries.
 *
 * A dictionary is one object for the whole process, read by the generators on
 * every call. Freezing only the outer container leaves an entry — or a stroke
 * inside one — writable by a caller, and that edit is then seen by every later
 * generation rather than by the caller alone.
 */

/** Freeze one object and descend into the values reachable from it. */
function freezeReachable(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  const object = value as object;
  if (seen.has(object)) {
    return;
  }
  seen.add(object);
  Object.freeze(object);
  for (const child of Object.values(object)) {
    freezeReachable(child, seen);
  }
}

/**
 * Freeze a value and everything reachable from it.
 *
 * Re-entry is stopped by the set of values already seen rather than by
 * `Object.isFrozen`, so a container that was frozen shallowly before it reached
 * here still has its contents descended into.
 *
 * @param value The value to freeze.
 * @returns The same value, frozen through.
 */
export function deepFreeze<T>(value: T): T {
  freezeReachable(value, new WeakSet<object>());
  return value;
}
