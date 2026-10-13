// Staff engraving primitives for the documentation figures.
//
// Everything is emitted as plain SVG geometry plus the Bravura outlines in
// glyphs.mjs, so a figure carries no font, script or network reference and
// renders the same inside GitHub's sandboxed <img>. Colours come from the
// shared class names in STYLE, which is what keeps the figures on one palette
// and lets them follow prefers-color-scheme.

import { GLYPHS, SPACE_UNITS } from './glyphs.mjs';

const LETTERS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const ACCIDENTAL = { '#': 'accidentalSharp', b: 'accidentalFlat', n: 'accidentalNatural' };

/** Diatonic index and alteration of a spelled note such as `C4`, `F#4`, `Bb3`. */
export function parsePitch(name) {
  const m = name.match(/^([A-G])([#bn]?)(-?\d+)$/);
  if (!m) throw new Error(`not a spelled note: ${name}`);
  const [, letter, alter, octave] = m;
  return { idx: Number(octave) * 7 + LETTERS[letter], alter };
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * One five-line staff. `top` is the y of its top line, `space` the distance
 * between two lines; every pitch is placed from the line the clef fixes.
 */
export function makeStaff({ x, width, top, space, clef }) {
  const anchor = clef === 'bass' ? 'G2' : 'E4';
  const ref = parsePitch(anchor).idx; // diatonic index sitting on the bottom line
  const bottom = top + 4 * space;
  return {
    x,
    width,
    top,
    bottom,
    space,
    clef,
    ref,
    end: x + width,
    /** Vertical position of a spelled note. */
    y(name) {
      return bottom - (parsePitch(name).idx - ref) * (space / 2);
    },
    /** Steps away from the middle line — the sign decides stem direction. */
    pos(name) {
      return parsePitch(name).idx - ref - 4;
    },
  };
}

const use = (id, x, y, sx, sy) =>
  `<use href="#${id}" transform="translate(${round(x)} ${round(y)}) scale(${round(sx)} ${round(-sy)})"/>`;

export function staffLines(st) {
  const d = [];
  for (let i = 0; i < 5; i++)
    d.push(`M${round(st.x)} ${round(st.top + i * st.space)}H${round(st.end)}`);
  return `<path class="staff" d="${d.join('')}"/>`;
}

export function clefGlyph(st) {
  const k = st.space / SPACE_UNITS;
  return st.clef === 'bass'
    ? use('fClef', st.x + 0.5 * st.space, st.y('F3'), k, k)
    : use('gClef', st.x + 0.5 * st.space, st.y('G4'), k, k);
}

export function barline(st, x, { thick = false, from = st.top, to = st.bottom } = {}) {
  const w = thick ? 2 : 1.2;
  return `<path class="bar" style="stroke-width:${w}" d="M${round(x)} ${round(from)}V${round(to)}"/>`;
}

/**
 * A grand staff: two staves joined by a brace and a system line, with the
 * treble and bass exposed for placing notes.
 */
export function makeGrandStaff({ x, width, top, space, gap = 4 }) {
  const treble = makeStaff({ x, width, top, space, clef: 'treble' });
  const bass = makeStaff({ x, width, top: treble.bottom + gap * space, space, clef: 'bass' });
  const render = () =>
    [
      staffLines(treble),
      staffLines(bass),
      barline(treble, x, { from: treble.top, to: bass.bottom }),
      use(
        'brace',
        x - 0.9 * space,
        bass.bottom,
        0.085,
        (bass.bottom - treble.top) / GLYPHS.brace.h,
      ),
      clefGlyph(treble),
      clefGlyph(bass),
    ].join('\n    ');
  return { treble, bass, render, x, width, end: x + width, top: treble.top, bottom: bass.bottom };
}

const HEADS = { whole: 'noteheadWhole', half: 'noteheadHalf', quarter: 'noteheadBlack' };
const STEM_WIDTH = 1.1;

function range(from, to, step) {
  const out = [];
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(i);
  return out;
}

function ledgers(st, cx, names, headWidth) {
  const out = [];
  const reach = headWidth / 2 + 0.4 * st.space;
  const seen = new Set();
  for (const name of names) {
    const p = parsePitch(name).idx - st.ref;
    const steps = p < 0 ? range(-2, p, -2) : p > 8 ? range(10, p, 2) : [];
    for (const s of steps) {
      if (seen.has(s)) continue;
      seen.add(s);
      const y = st.bottom - s * (st.space / 2);
      out.push(`<path class="ledger" d="M${round(cx - reach)} ${round(y)}h${round(2 * reach)}"/>`);
    }
  }
  return out;
}

/**
 * Accidentals sit left of the noteheads. Two of them a third apart would
 * collide vertically, so they are dealt into columns: a glyph joins the first
 * column that has room for its full height, and each further column is pushed
 * one glyph width further from the chord.
 */
function accidentals(st, cx, names, headWidth, k) {
  const marked = names
    .map((name) => ({ name, ...parsePitch(name) }))
    .filter((n) => n.alter)
    .map((n) => ({ y: st.y(n.name), id: ACCIDENTAL[n.alter], g: GLYPHS[ACCIDENTAL[n.alter]] }))
    .sort((a, b) => a.y - b.y);

  const columns = [];
  for (const acc of marked) {
    const clears = (col) => col.every((b) => Math.abs(b.y - acc.y) >= ((b.g.h + acc.g.h) / 2) * k);
    let i = 0;
    while (i < columns.length && !clears(columns[i])) i++;
    if (!columns[i]) columns[i] = [];
    columns[i].push(acc);
  }

  const out = [];
  let right = cx - headWidth / 2 - 0.2 * st.space;
  for (const col of columns) {
    const width = Math.max(...col.map((a) => a.g.w * k));
    for (const acc of col) out.push(use(acc.id, right - acc.g.w * k, acc.y, k, k));
    right -= width + 0.25 * st.space;
  }
  return out;
}

/**
 * A chord or single note at `cx`. Stem direction defaults to the note furthest
 * from the middle line, a tie resolving downward, and the stem is measured from
 * the notehead it starts on rather than across the chord.
 */
export function notes(st, cx, names, { dur = 'half', stem = 'auto', cls = '' } = {}) {
  const k = st.space / SPACE_UNITS;
  const glyph = GLYPHS[HEADS[dur]];
  const hw = glyph.w * k;
  const ys = names.map((n) => st.y(n)).sort((a, b) => a - b);
  const out = [];

  for (const name of names) out.push(use(HEADS[dur], cx - hw / 2, st.y(name), k, k));
  out.push(...accidentals(st, cx, names, hw, k));
  out.push(...ledgers(st, cx, names, hw));

  if (dur !== 'whole' && stem !== 'none') {
    const far = names.reduce((m, n) => {
      const a = Math.abs(st.pos(n));
      const b = Math.abs(st.pos(m));
      return a > b || (a === b && st.pos(n) > st.pos(m)) ? n : m;
    });
    const up = stem === 'up' || (stem === 'auto' && st.pos(far) < 0);
    const len = 3.5 * st.space;
    const top = ys[0];
    const bottom = ys[ys.length - 1];
    const sx = up ? cx + hw / 2 - STEM_WIDTH / 2 : cx - hw / 2 + STEM_WIDTH / 2;
    const y1 = up ? bottom : top;
    const y2 = up ? Math.min(bottom - len, top - st.space) : Math.max(top + len, bottom + st.space);
    out.push(`<path class="stem" d="M${round(sx)} ${round(y1)}V${round(y2)}"/>`);
  }

  return out.map((s) => (cls ? s.replace(/^<(use|path)/, `<$1 class="${cls}"`) : s));
}

/** The `<defs>` entries a figure needs, given the glyph names it uses. */
export function glyphDefs(names) {
  return names.map((n) => `    <path id="${n}" d="${GLYPHS[n].d}"/>`).join('\n');
}

export const ALL_GLYPHS = [
  'brace',
  'gClef',
  'fClef',
  'noteheadWhole',
  'noteheadHalf',
  'noteheadBlack',
  'accidentalSharp',
  'accidentalFlat',
  'accidentalNatural',
];

/** Shared palette and type, including the dark-scheme overrides. */
export const STYLE = `    .bg    { fill:#f7f5f1 }
    .grp   { fill:#edeae4 }
    .chip  { fill:#ffffff; stroke:#d7d4cd }
    .card  { fill:#ffffff; stroke:#8a6a1f }
    .alt   { fill:#ffffff; stroke:#3f6b8a }
    .rule  { fill:none; stroke:#b8b4ac; stroke-width:1 }
    .ln    { fill:none; stroke:#8a6a1f; stroke-width:1.4 }
    .ln2   { fill:none; stroke:#3f6b8a; stroke-width:1.4 }
    .ah    { fill:#8a6a1f }
    .ah2   { fill:#3f6b8a }
    .warn  { fill:none; stroke:#a3401f; stroke-width:1.6 }
    .warnt { fill:#a3401f }
    .staff { fill:none; stroke:#1f2328; stroke-width:.9 }
    .bar   { fill:none; stroke:#1f2328; stroke-width:1.2 }
    .ledger{ fill:none; stroke:#1f2328; stroke-width:1.3 }
    .stem  { fill:none; stroke:#1f2328; stroke-width:${STEM_WIDTH} }
    .glyph { fill:#1f2328 }
    .mark  { fill:#a3401f; stroke:none }
    .markl { fill:none; stroke:#a3401f; stroke-width:1.1 }
    text   { font-family:Inter,"Helvetica Neue","Hiragino Sans","Noto Sans JP",Arial,sans-serif; fill:#1f2328 }
    .h     { font-size:12.5px }
    .lbl   { font-size:11px; fill:#6e7781; letter-spacing:.06em }
    .s     { font-size:10.5px; fill:#6e7781 }
    .sym   { font-size:12.5px; fill:#8a6a1f }
    .rn    { font-size:13px }
    .mono  { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:10.5px; fill:#8a6a1f }
    @media (prefers-color-scheme: dark) {
      .bg{fill:#0d1117} .grp{fill:#12171d}
      .chip{fill:#161b22;stroke:#30363d} .card{fill:#161b22;stroke:#d9b45c} .alt{fill:#161b22;stroke:#7fb3d5}
      .rule{stroke:#484f58}
      .ln{stroke:#d9b45c} .ln2{stroke:#7fb3d5} .ah{fill:#d9b45c} .ah2{fill:#7fb3d5}
      .warn{stroke:#e08a68} .warnt{fill:#e08a68} .mark{fill:#e08a68} .markl{stroke:#e08a68}
      .staff{stroke:#e6edf3} .bar{stroke:#e6edf3} .ledger{stroke:#e6edf3}
      .stem{stroke:#e6edf3} .glyph{fill:#e6edf3}
      text{fill:#e6edf3} .lbl{fill:#8b949e} .s{fill:#8b949e} .sym{fill:#d9b45c} .mono{fill:#d9b45c}
    }`;

/** Wrap a figure body in the shared document shell. */
export function svgDocument({ width, height, title, desc, glyphs = ALL_GLYPHS, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="ttl dsc">
  <title id="ttl">${title}</title>
  <desc id="dsc">${desc}</desc>

  <style>
${STYLE}
  </style>

  <defs>
    <!-- Music glyphs from Bravura, (c) Steinberg Media Technologies GmbH, SIL Open Font License 1.1. See NOTICE. -->
${glyphDefs(glyphs)}
    <marker id="a" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
      <path class="ah" d="M0,0 L9,4.5 L0,9 z"/>
    </marker>
    <marker id="b" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
      <path class="ah2" d="M0,0 L9,4.5 L0,9 z"/>
    </marker>
    <marker id="w" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
      <path class="mark" d="M0,0 L9,4.5 L0,9 z"/>
    </marker>
  </defs>

  <rect class="bg" x="0" y="0" width="${width}" height="${height}" rx="12"/>

${body}
</svg>
`;
}
