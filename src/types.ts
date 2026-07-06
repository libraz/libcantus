/**
 * A key/scale definition anchored on a root pitch class.
 *
 * `modeMask12` is a 12-bit mask where bit `n` set means the pitch class
 * `(rootPc + n) % 12` belongs to the scale. Bit 0 (the root) is always set;
 * {@link maskFromOffsets} enforces this so the root is always a scale tone.
 */
export type KeyScale = {
  rootPc: number;
  modeMask12: number;
};
