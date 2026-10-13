// An interval is a number and a quality. The right panel is the reason the
// library spells notes instead of storing semitones: an augmented fourth and a
// diminished fifth cover the same distance and are not the same interval, and
// only notation shows why.

import { barline, clefGlyph, makeStaff, notes, staffLines, svgDocument } from './staff.mjs';

const W = 960;
const H = 360;
const SPACE = 9;

const LOCALES = {
  en: {
    title: 'An interval is a number and a quality',
    desc: 'On the left, a treble staff carries C4 and E4, joined below by a bracket showing that the interval between them has a number, a 3rd counted over the letters C D E, and a quality, major, meaning four semitones; together they give M3. On the right, two more staves: C4 up to F sharp 4 is an augmented 4th, and C4 up to G flat 4 is a diminished 5th, each written with its accidental. A bracket marks that both cover six semitones on a keyboard yet are not the same interval.',
    number: 'number: 3rd',
    numberSub: 'count the letters, both ends included: C, D, E',
    quality: 'quality: major',
    qualitySub: 'the exact distance, four semitones',
    rightLabel: 'six semitones, two different intervals',
    rows: [
      { chip: 'A4', text: 'augmented 4th — letters C to F, widened' },
      { chip: 'd5', text: 'diminished 5th — letters C to G, narrowed' },
    ],
    warn: 'the same distance on a keyboard; not the same interval',
    foot: [
      'keeps the difference, because the part-writing and counterpoint checkers depend on it.',
    ],
  },
  ja: {
    title: '音程は度数と性質の組み合わせ',
    desc: '左側は高音部譜表に C4 と E4 を置き、下の括弧で、音程が度数（両端を含めて C, D, E と数えるので 3 度）と性質（半音 4 つ分なので長）からなり、合わせて M3 になることを示します。右側は 2 段の譜表で、C4 から F♯4 が増 4 度、C4 から G♭4 が減 5 度であることを臨時記号つきで書き、鍵盤上の距離はどちらも半音 6 つ分でも同じ音程ではないことを角括弧で示します。',
    number: '度数：3度',
    numberSub: '両端を含めて音名を数える：C, D, E',
    quality: '性質：長（メジャー）',
    qualitySub: '実際の距離は半音4つ分',
    rightLabel: '同じ半音6つ分でも別の音程',
    rows: [
      { chip: 'A4', text: '増4度 — C から F を広げた形' },
      { chip: 'd5', text: '減5度 — C から G を狭めた形' },
    ],
    warn: '鍵盤上の距離は同じでも別の音程',
    foot: ['はこの違いを保持します。声部書法と対位法のチェックがこの区別に依存するためです。'],
  },
};

function shortStaff({ x, width, top }) {
  const st = makeStaff({ x, width, top, space: SPACE, clef: 'treble' });
  return { st, chrome: [staffLines(st), clefGlyph(st), barline(st, st.end - 1, { thick: true })] };
}

function render(loc) {
  // left: the two halves of an interval name
  const left = shortStaff({ x: 52, width: 176, top: 104 });
  const cxA = 140;
  const cxB = 190;

  // right: two spellings of six semitones
  const rowA = shortStaff({ x: 386, width: 176, top: 106 });
  const rowB = shortStaff({ x: 386, width: 176, top: 178 });
  const cx1 = 455;
  const cx2 = 505;

  const row = (r, cxs, pitches) => `    ${r.chrome.join('\n    ')}
    ${notes(r.st, cxs[0], [pitches[0]]).join('\n    ')}
    ${notes(r.st, cxs[1], [pitches[1]]).join('\n    ')}`;

  const body = `  <text class="h" x="32" y="40">${loc.title}</text>

  <!-- left: number and quality -->
  <rect class="grp" x="32" y="64" width="300" height="232" rx="10"/>
  <g class="glyph">
${row(left, [cxA, cxB], ['C4', 'E4'])}
  </g>
  <path class="ln" d="M${cxA},162 L${cxA},170 L${cxB},170 L${cxB},162"/>
  <path class="ln" d="M165,170 L165,178"/>
  <rect class="chip" x="133" y="178" width="64" height="26" rx="6"/>
  <text class="mono" x="165" y="195" text-anchor="middle">M3</text>

  <text class="h" x="52" y="230">${loc.number}</text>
  <text class="s" x="52" y="246">${loc.numberSub}</text>
  <text class="h" x="52" y="268">${loc.quality}</text>
  <text class="s" x="52" y="284">${loc.qualitySub}</text>

  <!-- right: six semitones, two intervals -->
  <rect class="grp" x="356" y="64" width="572" height="232" rx="10"/>
  <text class="lbl" x="386" y="88">${loc.rightLabel}</text>
  <path class="warn" d="M376,100 L368,100 L368,250 L376,250"/>

  <g class="glyph">
${row(rowA, [cx1, cx2], ['C4', 'F#4'])}
${row(rowB, [cx1, cx2], ['C4', 'Gb4'])}
  </g>

  <rect class="chip" x="580" y="111" width="52" height="26" rx="6"/>
  <text class="mono" x="606" y="128" text-anchor="middle">${loc.rows[0].chip}</text>
  <text class="s" x="652" y="128">${loc.rows[0].text}</text>

  <rect class="chip" x="580" y="183" width="52" height="26" rx="6"/>
  <text class="mono" x="606" y="200" text-anchor="middle">${loc.rows[1].chip}</text>
  <text class="s" x="652" y="200">${loc.rows[1].text}</text>

  <text class="warnt" font-size="10.5" x="386" y="274">${loc.warn}</text>

  <text class="s" x="480" y="330" text-anchor="middle"><tspan class="mono">parseInterval</tspan> ${loc.foot[0]}</text>`;

  return svgDocument({
    width: W,
    height: H,
    title: loc.title,
    desc: loc.desc,
    glyphs: ['gClef', 'noteheadHalf', 'accidentalSharp', 'accidentalFlat'],
    body,
  });
}

export default { base: 'interval', locales: LOCALES, render };
