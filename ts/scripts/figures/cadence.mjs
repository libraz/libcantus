// The four standard cadences, each written on a grand staff in C major as two
// root-position chords: the triad in the treble over its root in the bass.

import { barline, makeGrandStaff, notes, svgDocument } from './staff.mjs';

const W = 960;
const H = 380;
const SPACE = 8.5;
const TOP = 122;

const C = ['C4', 'E4', 'G4'];
const G = ['G4', 'B4', 'D5'];
const F = ['F4', 'A4', 'C5'];
const Am = ['A4', 'C5', 'E5'];

const SHAPES = [
  { x: 24, a: { t: G, b: 'G2', rn: 'V', sym: 'G' }, z: { t: C, b: 'C3', rn: 'I', sym: 'C' } },
  { x: 256, a: { t: F, b: 'F2', rn: 'IV', sym: 'F' }, z: { t: C, b: 'C3', rn: 'I', sym: 'C' } },
  { x: 488, a: { t: C, b: 'C3', rn: 'I', sym: 'C' }, z: { t: G, b: 'G2', rn: 'V', sym: 'G' } },
  { x: 720, a: { t: G, b: 'G2', rn: 'V', sym: 'G' }, z: { t: Am, b: 'A2', rn: 'vi', sym: 'Am' } },
];

const LOCALES = {
  en: {
    title: 'Four ways a phrase can end',
    desc: 'Four panels side by side, one for each cadence type, each written on a grand staff in C major as two root-position chords, a triad in the treble over its root in the bass, with the chord symbol above and the Roman numeral below. Authentic is V to I, G to C; plagal is IV to I, F to C; half is I to V, C to G, stopping on the dominant; deceptive is V to vi, G to A minor. One line under each panel describes the effect of the ending.',
    caption: 'chord symbol above, Roman numeral below, in C major',
    names: ['authentic', 'plagal', 'half', 'deceptive'],
    notes: [
      ['the strongest close'],
      ['a softer close'],
      ['the phrase stops on the', 'dominant and stays open'],
      ['the dominant resolves', 'somewhere other than home'],
    ],
    foot: [
      'An inversion, or a leading-tone chord standing in for the dominant, grades an authentic cadence imperfect on the chords alone;',
      'where neither holds, only a voicing names the soprano, and without one the grade comes back null.',
    ],
  },
  ja: {
    title: 'フレーズの終わり方 — 4つの終止形',
    desc: 'ハ長調で書いた4種類の終止形を、大譜表の譜例で1つずつパネルに並べた図です。各パネルは基本形の和音を2つ、高音部譜表に三和音、低音部譜表にその根音を置き、上にコードネーム、下にローマ数字を添えます。完全終止は V→I（G→C）、変格終止は IV→I（F→C）、半終止は I→V（C→G）でドミナントに止まり、偽終止は V→vi（G→Am）です。パネルの下の一行は終わり方の印象を表します。',
    caption: '上にコードネーム、下にローマ数字（ハ長調）',
    names: ['完全終止', '変格終止', '半終止', '偽終止'],
    notes: [
      ['最も強い終止'],
      ['やわらかい終止'],
      ['ドミナントで止まり', '開いたままになる'],
      ['ドミナントが主和音以外へ', '解決する'],
    ],
    foot: [
      '転回形や、ドミナントの代わりに置かれた導音上の和音は、和音だけで不完全形と判定されます。',
      'どちらでもない場合はソプラノを決めるボイシングが要るので、それが無ければ判定は null のまま返ります。',
    ],
  },
};

function panel(shape, loc, k) {
  const gs = makeGrandStaff({ x: shape.x + 16, width: 172, top: TOP, space: SPACE });
  const cx1 = shape.x + 84;
  const cx2 = shape.x + 152;
  const mid = shape.x + 108;
  const chord = (cx, c) =>
    [...notes(gs.treble, cx, c.t), ...notes(gs.bass, cx, [c.b])].join('\n    ');

  return `  <!-- ${LOCALES.en.names[k]} -->
  <rect class="card" x="${shape.x}" y="68" width="216" height="244" rx="8"/>
  <text class="lbl" x="${mid}" y="92" text-anchor="middle">${loc.names[k]}</text>
  <text class="sym" x="${cx1}" y="110" text-anchor="middle">${shape.a.sym}</text>
  <text class="sym" x="${cx2}" y="110" text-anchor="middle">${shape.z.sym}</text>
  <g class="glyph">
    ${gs.render()}
    ${barline(gs.treble, gs.end - 1, { thick: true, from: gs.top, to: gs.bottom })}
    ${chord(cx1, shape.a)}
    ${chord(cx2, shape.z)}
  </g>
  <text class="rn" x="${cx1}" y="252" text-anchor="middle">${shape.a.rn}</text>
  <text class="rn" x="${cx2}" y="252" text-anchor="middle">${shape.z.rn}</text>
  <line class="ln" x1="${cx1 + 16}" y1="248" x2="${cx2 - 16}" y2="248" marker-end="url(#a)"/>
${loc.notes[k].map((n, j) => `  <text class="s" x="${mid}" y="${280 + j * 14}" text-anchor="middle">${n}</text>`).join('\n')}`;
}

function render(loc) {
  const body = `  <text class="h" x="24" y="42">${loc.title}</text>
  <text class="lbl" x="936" y="42" text-anchor="end">${loc.caption}</text>

${SHAPES.map((s, k) => panel(s, loc, k)).join('\n\n')}

${loc.foot.map((f, j) => `  <text class="s" x="480" y="${342 + j * 16}" text-anchor="middle">${f}</text>`).join('\n')}`;

  return svgDocument({
    width: W,
    height: H,
    title: loc.title,
    desc: loc.desc,
    glyphs: ['brace', 'gClef', 'fClef', 'noteheadHalf'],
    body,
  });
}

export default { base: 'cadence', locales: LOCALES, render };
