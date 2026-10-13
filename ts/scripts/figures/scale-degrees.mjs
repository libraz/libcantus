// A scale, its degrees, and its modes. On a staff the step pattern stops being
// a claim about letters and becomes something to look at: the half steps are
// where two noteheads sit on adjacent positions.

import { barline, clefGlyph, makeStaff, notes, staffLines, svgDocument } from './staff.mjs';

const W = 960;
const H = 574;
const SPACE = 8;

const MAJOR = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const STEPS_MAJOR = ['W', 'W', 'H', 'W', 'W', 'W', 'H'];

const MODES = [
  { scale: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], steps: STEPS_MAJOR },
  {
    scale: ['D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5'],
    steps: ['W', 'H', 'W', 'W', 'W', 'H', 'W'],
  },
  {
    scale: ['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5'],
    steps: ['W', 'H', 'W', 'W', 'H', 'W', 'W'],
  },
];

const LOCALES = {
  en: {
    title: 'A scale, its degrees, and its modes',
    legend: 'H = half step (one semitone) · W = whole step (two)',
    scaleLabel: 'C major',
    degrees: [
      ['1', 'tonic'],
      ['2', 'supertonic'],
      ['3', 'mediant'],
      ['4', 'subdominant'],
      ['5', 'dominant'],
      ['6', 'submediant'],
      ['7', 'leading tone'],
    ],
    modesLabel: 'the same seven notes, a different note treated as home',
    modeNames: ['Ionian, from C', 'Dorian, from D', 'Aeolian, from A'],
    foot: 'A mode is a rotation of the same material; which degree is home is what changes.',
    desc: 'The upper staff writes the C major scale, C D E F G A B C, with the step between each pair of noteheads marked W for a whole step and H for a half step, giving W W H W W W H. Under the first seven notes are the degree numbers one to seven with their names, from tonic to leading tone. Below, three more staves write the same seven notes read from three different homes: Ionian from C, Dorian from D and Aeolian from A, each with its own pattern of whole and half steps.',
  },
  ja: {
    title: '音階・度数・旋法',
    legend: 'H = 半音（半音1つ）· W = 全音（半音2つ）',
    scaleLabel: 'C メジャー',
    degrees: [
      ['1', '主音'],
      ['2', '上主音'],
      ['3', '中音'],
      ['4', '下属音'],
      ['5', '属音'],
      ['6', '下中音'],
      ['7', '導音'],
    ],
    modesLabel: '同じ7音、どの音を中心にするか',
    modeNames: ['イオニア（C）', 'ドリア（D）', 'エオリア（A）'],
    foot: '旋法は同じ素材の回転であり、どの度数を中心とするかだけが変わります。',
    desc: '上段の譜表は C メジャースケール C D E F G A B C を書き、隣り合う音符の間隔を全音 W・半音 H で示します（W W H W W W H）。その下に最初の 7 音の度数 1 から 7 と、主音から導音までの名称を並べます。さらに下の 3 段は同じ 7 音を別の音から読んだもので、C から始まるイオニア、D から始まるドリア、A から始まるエオリアを、それぞれの全音・半音の並びとともに示します。',
  },
};

function line(st, xs, scale) {
  return [
    staffLines(st),
    clefGlyph(st),
    barline(st, st.end - 1, { thick: true }),
    ...scale.flatMap((n, i) => notes(st, xs[i], [n])),
  ].join('\n    ');
}

/** The step markers sit under the staff, each spanning the pair it measures. */
function steps(xs, labels, y) {
  return labels
    .map((label, i) => {
      const a = xs[i];
      const b = xs[i + 1];
      const mid = (a + b) / 2;
      return `  <path class="rule" d="M${a + 10} ${y - 4}H${mid - 9}M${mid + 9} ${y - 4}H${b - 10}"/>
  <text class="lbl" x="${mid}" y="${y}" text-anchor="middle">${label}</text>`;
    })
    .join('\n');
}

function render(loc) {
  const topStaff = makeStaff({ x: 48, width: 864, top: 104, space: SPACE, clef: 'treble' });
  const topX = MAJOR.map((_, i) => 140 + i * 102);

  const modeTops = [292, 376, 460];
  const modeX = MAJOR.map((_, i) => 230 + i * 90);
  const modeStaves = modeTops.map((top) =>
    makeStaff({ x: 150, width: 762, top, space: SPACE, clef: 'treble' }),
  );

  const body = `  <text class="h" x="24" y="42">${loc.title}</text>
  <text class="lbl" x="936" y="42" text-anchor="end">${loc.legend}</text>

  <!-- the scale and its degrees -->
  <rect class="grp" x="24" y="64" width="912" height="166" rx="10"/>
  <text class="lbl" x="48" y="88">${loc.scaleLabel}</text>
  <g class="glyph">
    ${line(topStaff, topX, MAJOR)}
  </g>
${steps(topX, STEPS_MAJOR, 168)}
${loc.degrees
  .map(
    ([n, name], i) => `  <text class="h" x="${topX[i]}" y="196" text-anchor="middle">${n}</text>
  <text class="s" x="${topX[i]}" y="212" text-anchor="middle">${name}</text>`,
  )
  .join('\n')}

  <!-- the same notes, three homes -->
  <rect class="grp" x="24" y="246" width="912" height="282" rx="10"/>
  <text class="lbl" x="48" y="270">${loc.modesLabel}</text>
${MODES.map(
  (
    mode,
    i,
  ) => `  <text class="s" x="140" y="${modeTops[i] + 20}" text-anchor="end">${loc.modeNames[i]}</text>
  <g class="glyph">
    ${line(modeStaves[i], modeX, mode.scale)}
  </g>
${steps(modeX, mode.steps, modeTops[i] + 56)}`,
).join('\n\n')}

  <text class="s" x="480" y="558" text-anchor="middle">${loc.foot}</text>`;

  return svgDocument({
    width: W,
    height: H,
    title: loc.title,
    desc: loc.desc,
    glyphs: ['gClef', 'noteheadHalf'],
    body,
  });
}

export default { base: 'scale-degrees', locales: LOCALES, render };
