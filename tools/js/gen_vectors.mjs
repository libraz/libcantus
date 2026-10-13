#!/usr/bin/env node
/**
 * Generate the JS reference vectors that tests/js checks the C++ helpers against.
 *
 * Every double is written as 16 hex digits of its IEEE-754 bits (big-endian), concatenated per
 * column, so results compare bit for bit. Inputs come from a fixed splitmix64 stream, so
 * regenerating with the same Node prints the same files.
 *
 * Node's binary is compiled with floating-point contraction, so on FMA targets (arm64) a few
 * Math.exp / Math.pow results differ from the uncontracted port; tests/js accepts those only where
 * the same port built with contraction reproduces them.
 *
 * Usage: node tools/js/gen_vectors.mjs [--check]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../tests/js/vectors');
const RANDOM_POINTS = 10_000;
const FIXED_DIGITS = [0, 1, 2, 3, 4, 6, 10, 15, 20, 100];

let state = 0x5eed_c0de_2026_1013n;
const MASK64 = (1n << 64n) - 1n;

/** Next 64 random bits (splitmix64). */
function next64() {
  state = (state + 0x9e3779b97f4a7c15n) & MASK64;
  let z = state;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return z ^ (z >> 31n);
}

/** Uniform double in [0, 1). */
function unit() {
  return Number(next64() >> 11n) / 2 ** 53;
}

/** Uniform integer in [lo, hi]. */
function int(lo, hi) {
  return lo + Math.floor(unit() * (hi - lo + 1));
}

const view = new DataView(new ArrayBuffer(8));

function fromBits(bits) {
  view.setBigUint64(0, bits & MASK64);
  return view.getFloat64(0);
}

function hex(x) {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

/** A double with the given biased-exponent range and random sign/mantissa bits. */
function withExponent(lo, hi, sign = int(0, 1)) {
  const mantissa = next64() & ((1n << 52n) - 1n);
  return fromBits((BigInt(sign) << 63n) | (BigInt(int(lo, hi)) << 52n) | mantissa);
}

/** Any finite double. */
function anyFinite() {
  return withExponent(0, 2046);
}

/** One ulp step away from x (direction ±1), finite inputs only. */
function nudge(x, direction) {
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  if (x === 0) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const away = x > 0 === direction > 0;
  return fromBits(away ? bits + 1n : bits - 1n);
}

function pick(list) {
  return list[int(0, list.length - 1)];
}

const SPECIAL = [
  0,
  -0,
  NaN,
  Infinity,
  -Infinity,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  2.225073858507201e-308,
  2.2250738585072014e-308,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.EPSILON,
  1,
  -1,
  nudge(1, 1),
  nudge(1, -1),
  0.5,
  -0.5,
  2,
  -2,
  3,
  10,
  0.1,
  1e-300,
  1e300,
  2 ** 52,
  2 ** 53,
  2 ** 53 + 2,
  2 ** 31,
  2 ** 32,
  -(2 ** 31),
];

/** Edge inputs for the unary number helpers (round, toString, toFixed, max, min). */
const NUMBER_EDGES = [
  ...SPECIAL,
  1.5,
  -1.5,
  2.5,
  -2.5,
  -0.3,
  0.3,
  0.49999999999999994,
  -0.49999999999999994,
  nudge(0.5, 1),
  nudge(-0.5, -1),
  4503599627370495.5,
  -4503599627370495.5,
  4503599627370497,
  1e21,
  nudge(1e21, -1),
  -1e21,
  999999999999999900000,
  1e-7,
  1e-6,
  nudge(1e-6, -1),
  1.5e-7,
  123e-20,
  0.2 + 0.1,
  0.125,
  -0.125,
  1.005,
  1.45,
  8.345,
  1.255,
  0.000001,
  5e-324 * 3,
  123456789012345680000,
  1.7976931348623157e308,
  100,
  1e20,
  1e22,
  -1e-7,
  0.0000035,
];

function numberInput(i) {
  switch (i % 4) {
    case 0: {
      // Half-way points and their neighbours, the cases round and toFixed disagree on.
      const half = int(-1_000_000, 1_000_000) + 0.5;
      return pick([half, nudge(half, 1), nudge(half, -1), half / 10 ** int(0, 4)]);
    }
    case 1:
      return ((unit() < 0.5 ? -1 : 1) * int(0, 1_000_000_000)) / 10 ** int(0, 12);
    case 2:
      return anyFinite();
    default:
      return (unit() - 0.5) * 2000;
  }
}

function log2Input(i) {
  switch (i % 5) {
    case 0:
    case 1:
      return withExponent(0, 2046, 0);
    case 2:
      return 1 + (unit() - 0.5) * 2 ** -int(1, 50);
    case 3:
      return 2 ** int(-1074, 1023) * (1 + (unit() - 0.5) * 2 ** -int(20, 52));
    default:
      return pick([anyFinite(), unit() * 128, int(1, 1_000_000)]);
  }
}

function expInput(i) {
  switch (i % 5) {
    case 0:
    case 1:
      return -745.2 + unit() * (709.8 + 745.2);
    case 2:
      return (unit() - 0.5) * 2 ** -int(1, 60);
    case 3:
      return int(-1075, 1025) * Math.LN2 * 0.5 + (unit() - 0.5) * 1e-6;
    default:
      return pick([anyFinite(), (unit() - 0.5) * 40]);
  }
}

function powInput(i) {
  switch (i % 7) {
    case 0:
      return [withExponent(900, 1150, 0), (unit() - 0.5) * 100];
    case 1:
      return [int(-100, 100), int(-30, 30)];
    case 2:
      return [1 + (unit() - 0.5) * 2 ** -int(20, 52), (unit() < 0.5 ? -1 : 1) * 2 ** int(20, 70)];
    case 3:
      return [-withExponent(950, 1100, 0), int(-60, 60)];
    case 4:
      return [anyFinite(), anyFinite()];
    case 5:
      // Tuning-style ratios: 2 ** (cents / 1200), 440 * 2 ** ((p - 69) / 12).
      return [2, (unit() - 0.5) * 20];
    default:
      return [unit() * 1000, (unit() - 0.5) * 10];
  }
}

function column(values) {
  return values.map(hex).join('');
}

function header(name, count) {
  return {
    generator: 'tools/js/gen_vectors.mjs',
    node: process.version,
    v8: process.versions.v8,
    arch: process.arch,
    function: name,
    count,
  };
}

function unaryFile(name, edges, input, fn) {
  const xs = [...edges];
  for (let i = 0; i < RANDOM_POINTS; i++) xs.push(input(i));
  return { ...header(name, xs.length), x: column(xs), result: column(xs.map(fn)) };
}

function powFile() {
  const xs = [];
  const ys = [];
  for (const x of SPECIAL) {
    for (const y of [...SPECIAL, 0.5, -0.5, 1 / 3, 1e10, -1e10]) {
      xs.push(x);
      ys.push(y);
    }
  }
  for (let i = 0; i < RANDOM_POINTS; i++) {
    const [x, y] = powInput(i);
    xs.push(x);
    ys.push(y);
  }
  const result = xs.map((x, k) => x ** ys[k]);
  return { ...header('pow', xs.length), x: column(xs), y: column(ys), result: column(result) };
}

/** Which of a = x[i], b = x[i + 1] the result is: "a", "b", or "n" for NaN. */
function which(result, a) {
  if (Number.isNaN(result)) return 'n';
  return Object.is(result, a) ? 'a' : 'b';
}

function numberFile() {
  const xs = [...NUMBER_EDGES];
  for (let i = 0; i < RANDOM_POINTS; i++) xs.push(numberInput(i));
  const digits = xs.map((_, k) =>
    k < NUMBER_EDGES.length ? 2 : FIXED_DIGITS[k % FIXED_DIGITS.length],
  );
  const toFixed = xs.map((x, k) => x.toFixed(digits[k]));
  let max = '';
  let min = '';
  for (let k = 0; k < xs.length; k++) {
    const a = xs[k];
    const b = xs[(k + 1) % xs.length];
    max += which(Math.max(a, b), a);
    min += which(Math.min(a, b), a);
  }
  return {
    ...header('number', xs.length),
    x: column(xs),
    round: column(xs.map(Math.round)),
    to_string: xs.map(String),
    to_fixed_digits: digits,
    to_fixed: toFixed,
    max_with_next: max,
    min_with_next: min,
  };
}

const files = {
  'log2.json': unaryFile('log2', [...SPECIAL, -Number.MIN_VALUE * 7], log2Input, Math.log2),
  'exp.json': unaryFile(
    'exp',
    [...SPECIAL, 709.782712893384, 709.7827128933841, -745.1332191019411, -745.1332191019412, 1e-9],
    expInput,
    Math.exp,
  ),
  'pow.json': powFile(),
  'number.json': numberFile(),
};

const check = process.argv.includes('--check');
let stale = 0;
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  const text = `${JSON.stringify(data, null, 1)}\n`;
  const path = join(OUT_DIR, name);
  if (check) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current !== text) {
      console.error(`stale: ${path}`);
      stale++;
    }
  } else {
    writeFileSync(path, text);
  }
  process.stdout.write(`${name}: ${data.count} vectors\n`);
}
if (stale > 0) process.exit(1);
