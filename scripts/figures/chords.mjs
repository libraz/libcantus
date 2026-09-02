// Chords are stacked thirds. Written out on a staff the three ideas here are
// all visible rather than asserted: each extension adds one more third on top,
// a quality is where the third and the fifth sit, and an inversion moves the
// same notes without changing which chord they are.

import { barline, clefGlyph, makeStaff, notes, staffLines, svgDocument } from './staff.mjs';

const W = 960;
const H = 470;
const SPACE = 8;

const STACK = [
  { sym: 'C', chord: ['C4', 'E4', 'G4'] },
  { sym: 'C7', chord: ['C4', 'E4', 'G4', 'Bb4'] },
  { sym: 'C9', chord: ['C4', 'E4', 'G4', 'Bb4', 'D5'] },
  { sym: 'C9(♯11)', chord: ['C4', 'E4', 'G4', 'Bb4', 'D5', 'F#5'] },
];

const INVERSIONS = [
  { sym: 'C', chord: ['C4', 'E4', 'G4'] },
  { sym: 'C/E', chord: ['E4', 'G4', 'C5'] },
  { sym: 'C/G', chord: ['G4', 'C5', 'E5'] },
];

const QUALITIES = [
  { sym: 'C', chord: ['C4', 'E4', 'G4'], formula: 'M3, P5' },
  { sym: 'Cm', chord: ['C4', 'Eb4', 'G4'], formula: 'm3, P5' },
  { sym: 'Cdim', chord: ['C4', 'Eb4', 'Gb4'], formula: 'm3, d5' },
  { sym: 'Caug', chord: ['C4', 'E4', 'G#4'], formula: 'M3, A5' },
  { sym: 'C7', chord: ['C4', 'E4', 'G4', 'Bb4'], formula: 'M3, P5, m7' },
];

const LOCALES = {
  en: {
    title: 'Chords are stacked thirds',
    stackLabel: 'each step adds one more third on top',
    stackNotes: [['root · M3 · P5'], ['+ m7'], ['+ M9'], ['+ ♯11']],
    invLabel: 'inversion is which note is lowest',
    invNotes: [
      ['root', 'position'],
      ['first', 'inversion'],
      ['second', 'inversion'],
    ],
    invFoot: ['the same three notes, and the same chord identity'],
    qualityLabel: 'quality is the size of those thirds and the fifth',
    qualityNames: ['major', 'minor', 'diminished', 'augmented', 'dominant seventh'],
    foot: 'A symbol names the material and the bass; ',
    footCode: "Chord.parse('C7(b9,#11)')",
    footEnd: ' reads one back into that structure.',
    desc: 'Three panels. The first writes four chords on one treble staff, each adding a third above the last: C is C4 E4 G4, C7 adds B flat 4, C9 adds D5, and C9 sharp 11 adds F sharp 5, with the added interval named under each. The second panel writes the same three notes C E G three ways on a staff, root position, first inversion with E lowest and second inversion with G lowest, written C, C slash E and C slash G. The third panel writes five qualities rooted on C, major, minor, diminished, augmented and dominant seventh, each with the intervals above the root.',
  },
  ja: {
    title: '和音は3度の積み重ね',
    stackLabel: '1段ごとに3度をひとつ上へ足す',
    stackNotes: [['根音・M3・P5'], ['+ m7'], ['+ M9'], ['+ ♯11']],
    invLabel: '転回は最低音がどれか',
    invNotes: [['基本形'], ['第1転回形'], ['第2転回形']],
    invFoot: ['同じ3音であり、和音としての同一性も同じ'],
    qualityLabel: '性質は3度と5度の大きさで決まる',
    qualityNames: ['長三和音', '短三和音', '減三和音', '増三和音', '属七の和音'],
    foot: 'コードシンボルは構成音と最低音を表します。',
    footCode: "Chord.parse('C7(b9,#11)')",
    footEnd: ' はそれをこの構造へ読み戻します。',
    desc: '3つのパネルに分かれた図です。1つ目は高音部譜表に4つの和音を並べ、1段ごとに3度を上へ足していきます。C は C4 E4 G4、C7 は B♭4 を足し、C9 は D5 を、C9(♯11) は F♯5 を足し、加わった音程を各和音の下に書きます。2つ目は同じ C・E・G を積み方だけ変えた3つで、基本形、E が最低音の第1転回形、G が最低音の第2転回形をそれぞれ C、C/E、C/G と示します。3つ目は C を根音とする5つの性質、長三和音・短三和音・減三和音・増三和音・属七の和音を、根音からの音程とともに譜例で並べます。',
  },
};

function withStaff({ x, width, top }) {
  const st = makeStaff({ x, width, top, space: SPACE, clef: 'treble' });
  return { st, chrome: [staffLines(st), clefGlyph(st), barline(st, st.end - 1, { thick: true })] };
}

function render(loc) {
  const stack = withStaff({ x: 48, width: 516, top: 140 });
  const stackX = [180, 290, 400, 505];

  const inv = withStaff({ x: 620, width: 296, top: 140 });
  const invX = [710, 790, 870];

  const qual = withStaff({ x: 48, width: 864, top: 344 });
  const qualX = [180, 340, 500, 660, 820];

  const put = (r, xs, items) =>
    [...r.chrome, ...items.flatMap((it, i) => notes(r.st, xs[i], it.chord))].join('\n    ');

  const body = `  <text class="h" x="24" y="42">${loc.title}</text>

  <!-- stacking thirds -->
  <rect class="grp" x="24" y="64" width="560" height="200" rx="10"/>
  <text class="lbl" x="48" y="88">${loc.stackLabel}</text>
${STACK.map((s, i) => `  <text class="sym" x="${stackX[i]}" y="126" text-anchor="middle">${s.sym}</text>`).join('\n')}
  <g class="glyph">
    ${put(stack, stackX, STACK)}
  </g>
${STACK.map((_, i) => loc.stackNotes[i].map((t, j) => `  <text class="s" x="${stackX[i]}" y="${214 + j * 14}" text-anchor="middle">${t}</text>`).join('\n')).join('\n')}

  <!-- inversions -->
  <rect class="grp" x="600" y="64" width="336" height="200" rx="10"/>
  <text class="lbl" x="620" y="88">${loc.invLabel}</text>
${INVERSIONS.map((s, i) => `  <text class="sym" x="${invX[i]}" y="126" text-anchor="middle">${s.sym}</text>`).join('\n')}
  <g class="glyph">
    ${put(inv, invX, INVERSIONS)}
  </g>
${INVERSIONS.map((_, i) => loc.invNotes[i].map((t, j) => `  <text class="s" x="${invX[i]}" y="${214 + j * 14}" text-anchor="middle">${t}</text>`).join('\n')).join('\n')}
${loc.invFoot.map((t, j) => `  <text class="s" x="768" y="${250 + j * 14}" text-anchor="middle">${t}</text>`).join('\n')}

  <!-- qualities -->
  <rect class="grp" x="24" y="280" width="912" height="150" rx="10"/>
  <text class="lbl" x="48" y="304">${loc.qualityLabel}</text>
${QUALITIES.map((s, i) => `  <text class="sym" x="${qualX[i]}" y="330" text-anchor="middle">${s.sym}</text>`).join('\n')}
  <g class="glyph">
    ${put(qual, qualX, QUALITIES)}
  </g>
${QUALITIES.map(
  (
    s,
    i,
  ) => `  <text class="s" x="${qualX[i]}" y="404" text-anchor="middle">${loc.qualityNames[i]}</text>
  <text class="s" x="${qualX[i]}" y="420" text-anchor="middle">${s.formula}</text>`,
).join('\n')}

  <text class="s" x="480" y="454" text-anchor="middle">${loc.foot}<tspan class="mono">${loc.footCode}</tspan>${loc.footEnd}</text>`;

  return svgDocument({
    width: W,
    height: H,
    title: loc.title,
    desc: loc.desc,
    glyphs: ['gClef', 'noteheadHalf', 'accidentalSharp', 'accidentalFlat'],
    body,
  });
}

export default { base: 'chords', locales: LOCALES, render };
