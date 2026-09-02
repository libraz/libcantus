// Four voices, and what part-writing checks. Written in closed score, soprano
// and alto sharing the treble staff and tenor and bass the bass staff, with
// stems apart so each voice stays a line rather than part of a chord.

import {
  barline,
  clefGlyph,
  makeGrandStaff,
  makeStaff,
  notes,
  staffLines,
  svgDocument,
} from './staff.mjs';

const W = 960;
const H = 368;
const SPACE = 8.5;

// I to V in C major. The bass rises, so the upper voices fall or hold: the
// motion the checker is happy with.
const ACCEPTED = [
  { treble: { S: 'G4', A: 'E4' }, bass: { T: 'C4', B: 'C3' } },
  { treble: { S: 'G4', A: 'D4' }, bass: { T: 'B3', B: 'G3' } },
];

// Only the two voices that break the rule: a perfect fifth in both chords,
// moved the same way.
const REJECTED = [
  { T: 'G3', B: 'C3' },
  { T: 'A3', B: 'D3' },
];

const LOCALES = {
  en: {
    title: 'Four voices, and what part-writing checks',
    voices: 'S A T B — soprano, alto, tenor, bass',
    accepted: 'accepted',
    chordLabels: ['I — C', 'V — G'],
    acceptedNotes: [
      'the bass rises while the upper voices fall or hold',
      '— contrary and oblique motion',
    ],
    rejected: 'rejected',
    rejectedLabels: ['chord 1', 'chord 2'],
    rejectedWarn: ['parallel fifths: the same perfect', 'fifth moved in the same direction'],
    rejectedNotes: ['reported with the rule, the two voices, and where it happened'],
    foot: [
      'reports and returns the exercise unchanged; it takes spelled notes,',
      'because a diminished fifth and an augmented fourth are not the same interval.',
    ],
    footCode: 'checkPartWriting',
    desc: 'Two panels in closed score. The accepted panel writes I to V in C major on a grand staff, soprano and alto on the treble with stems apart, tenor and bass on the bass staff: soprano G4 held, alto E4 down to D4, tenor C4 down to B3, bass C3 up to G3, so the bass rises while the upper voices fall or hold. The rejected panel writes only the two voices that break the rule, on a bass staff: tenor G3 up to A3 over bass C3 up to D3, a perfect fifth in both chords marked on each and joined by arrows showing both voices moving the same way.',
  },
  ja: {
    title: '4声と、声部書法が見るもの',
    voices: 'S ソプラノ・A アルト・T テノール・B バス',
    accepted: '許容',
    chordLabels: ['I — C', 'V — G'],
    acceptedNotes: ['バスが上行し、上声は下行または保持', '— 反行と斜行'],
    rejected: '不可',
    rejectedLabels: ['第1和音', '第2和音'],
    rejectedWarn: ['並行5度 — 同じ完全5度が', '同じ方向へ動いている'],
    rejectedNotes: ['規則・該当する2声・発生位置を添えて報告される'],
    foot: [
      'は違反を報告するだけで、渡した課題はそのまま返します。減5度と増4度は',
      '同じ音程ではないため、綴りを持つ音を入力に取ります。',
    ],
    footCode: 'checkPartWriting',
    desc: '閉じた総譜で書いた2つのパネルです。左（許容）は大譜表にハ長調の I→V を書き、高音部譜表にソプラノとアルトを符尾の向きを分けて置き、低音部譜表にテノールとバスを置きます。ソプラノは G4 を保持、アルトは E4→D4、テノールは C4→B3、バスは C3→G3 で、バスが上行し上声は下行または保持しています。右（不可）は規則に触れる2声だけを低音部譜表に書き、テノール G3→A3 とバス C3→D3 が、どちらの和音でも完全5度をなし、同じ方向へ動いていることを印と矢印で示します。',
  },
};

const VOICE_ORDER = { S: 'up', A: 'down', T: 'up', B: 'down' };

function render(loc) {
  const gs = makeGrandStaff({ x: 110, width: 340, top: 132, space: SPACE, gap: 6 });
  const accX = [230, 350];

  const rej = makeStaff({ x: 610, width: 290, top: 217, space: SPACE, clef: 'bass' });
  const rejX = [720, 820];

  const voices = (st, cx, map) =>
    Object.entries(map)
      .map(([v, note]) => notes(st, cx, [note], { stem: VOICE_ORDER[v] }).join('\n    '))
      .join('\n    ');

  // Voice names sit outside the system, on the line each voice occupies. Two
  // voices a third apart would print on top of each other, so the labels are
  // pushed to a readable minimum spacing; the order still reads top to bottom.
  const label = (st, x, map) => {
    const rows = Object.entries(map)
      .map(([v, note]) => ({ v, y: st.y(note) + 4 }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < rows.length; i++) {
      rows[i].y = Math.max(rows[i].y, rows[i - 1].y + 13);
    }
    return rows
      .map((r) => `  <text class="lbl" x="${x}" y="${r.y}" text-anchor="end">${r.v}</text>`)
      .join('\n');
  };

  // The fifth is marked at both chords, and the two voices joined so that
  // "same interval, same direction" is one shape rather than two claims.
  const fifth = (cx, top, bottom) =>
    `  <path class="markl" d="M${cx - 14} ${top} L${cx - 20} ${top} L${cx - 20} ${bottom} L${cx - 14} ${bottom}"/>
  <text class="warnt" font-size="10.5" x="${cx}" y="${rej.bottom + 26}" text-anchor="middle">P5</text>`;

  const arrow = (y1, y2) =>
    `  <path class="markl" d="M${rejX[0] + 14} ${y1} L${rejX[1] - 28} ${y2}" marker-end="url(#w)"/>`;

  const body = `  <text class="h" x="24" y="42">${loc.title}</text>
  <text class="lbl" x="936" y="42" text-anchor="end">${loc.voices}</text>

  <!-- accepted -->
  <rect class="card" x="24" y="64" width="480" height="240" rx="10"/>
  <text class="lbl" x="48" y="88">${loc.accepted}</text>
${accX.map((x, i) => `  <text class="sym" x="${x}" y="112" text-anchor="middle">${loc.chordLabels[i]}</text>`).join('\n')}
  <g class="glyph">
    ${gs.render()}
    ${barline(gs.treble, gs.end - 1, { thick: true, from: gs.top, to: gs.bottom })}
    ${ACCEPTED.map((c, i) => `${voices(gs.treble, accX[i], c.treble)}\n    ${voices(gs.bass, accX[i], c.bass)}`).join('\n    ')}
  </g>
${label(gs.treble, 96, ACCEPTED[0].treble)}
${label(gs.bass, 96, ACCEPTED[0].bass)}
${loc.acceptedNotes.map((t, j) => `  <text class="s" x="264" y="${274 + j * 14}" text-anchor="middle">${t}</text>`).join('\n')}

  <!-- rejected -->
  <rect class="alt" x="520" y="64" width="416" height="240" rx="10"/>
  <text class="lbl" x="544" y="88">${loc.rejected}</text>
${rejX.map((x, i) => `  <text class="s" x="${x}" y="112" text-anchor="middle">${loc.rejectedLabels[i]}</text>`).join('\n')}
${loc.rejectedWarn.map((t, j) => `  <text class="warnt" font-size="10.5" x="728" y="${160 + j * 14}" text-anchor="middle">${t}</text>`).join('\n')}
  <g class="glyph">
    ${[staffLines(rej), clefGlyph(rej), barline(rej, rej.end - 1, { thick: true })].join('\n    ')}
    ${REJECTED.map((c, i) => voices(rej, rejX[i], c)).join('\n    ')}
  </g>
${REJECTED.map((c, i) => fifth(rejX[i], rej.y(c.T), rej.y(c.B))).join('\n')}
${arrow(rej.y(REJECTED[0].T), rej.y(REJECTED[1].T))}
${arrow(rej.y(REJECTED[0].B), rej.y(REJECTED[1].B))}
${label(rej, 596, REJECTED[0])}
${loc.rejectedNotes.map((t, j) => `  <text class="s" x="728" y="${294 + j * 14}" text-anchor="middle">${t}</text>`).join('\n')}

${loc.foot.map((t, j) => `  <text class="s" x="480" y="${334 + j * 16}" text-anchor="middle">${j === 0 ? `<tspan class="mono">${loc.footCode}</tspan> ` : ''}${t}</text>`).join('\n')}`;

  return svgDocument({
    width: W,
    height: H,
    title: loc.title,
    desc: loc.desc,
    glyphs: ['brace', 'gClef', 'fClef', 'noteheadHalf'],
    body,
  });
}

export default { base: 'voice-leading', locales: LOCALES, render };
