// Degrees, numerals, and function. The seven triads a major key builds on its
// own scale, written out so that the qualities the numerals encode — three
// major, three minor, one diminished — are visible rather than asserted.

import { barline, clefGlyph, makeStaff, notes, staffLines, svgDocument } from './staff.mjs';

const W = 960;
const H = 452;
const SPACE = 8;

const DEGREES = [
  { rn: 'I', sym: 'C', deg: '1', chord: ['C4', 'E4', 'G4'] },
  { rn: 'ii', sym: 'Dm', deg: '2', chord: ['D4', 'F4', 'A4'] },
  { rn: 'iii', sym: 'Em', deg: '3', chord: ['E4', 'G4', 'B4'] },
  { rn: 'IV', sym: 'F', deg: '4', chord: ['F4', 'A4', 'C5'] },
  { rn: 'V', sym: 'G', deg: '5', chord: ['G4', 'B4', 'D5'] },
  { rn: 'vi', sym: 'Am', deg: '6', chord: ['A4', 'C5', 'E5'] },
  { rn: 'vii°', sym: 'Bdim', deg: '7', chord: ['B4', 'D5', 'F5'] },
];

const BANDS = [
  { x: 24, members: ['I', 'iii', 'vi'] },
  { x: 332, members: ['ii', 'IV'] },
  { x: 640, members: ['V', 'vii°'] },
];

const LOCALES = {
  en: {
    title: 'Degrees, numerals, and function',
    caption: 'chord symbol above; numeral and degree below',
    note: 'uppercase = major triad, lowercase = minor, ° = diminished',
    secondary: 'V/V — a secondary dominant',
    secondaryLines: [
      'In C major that is D7: the dominant',
      'of G, read in the key it points at',
      'rather than in C.',
    ],
    bandNames: ['tonic', 'predominant (subdominant)', 'dominant'],
    bandNotes: [
      'home; where a phrase comes to rest',
      'leads to the dominant',
      'pulls back to the tonic',
    ],
    foot: 'A functional reading presupposes tonal material; ',
    footCode: 'supportsFunctionalHarmony',
    footEnd: ' says whether a named scale admits one at all.',
    desc: 'A treble staff carries the seven triads a C major scale builds on its own degrees, each with its chord symbol above and its Roman numeral and degree number below: I is C on degree one, ii is D minor on two, iii is E minor on three, IV is F on four, V is G on five, vi is A minor on six and vii diminished is B diminished on seven. A card on the right writes D7, the secondary dominant V of V. Three panels below group the numerals by function: tonic gathers I, iii and vi; predominant gathers ii and IV; dominant gathers V and vii diminished.',
  },
  ja: {
    title: '度数・ローマ数字・機能',
    caption: '上にコードネーム、下にローマ数字と度数',
    note: '大文字＝長三和音、小文字＝短三和音、° ＝減三和音',
    secondary: 'V/V — 副属和音',
    secondaryLines: ['C メジャーでは D7。G のドミナントを、', 'C ではなく向かう先の調で読む。'],
    bandNames: ['トニック', 'サブドミナント', 'ドミナント'],
    bandNotes: ['フレーズが落ち着く場所', 'ドミナントへ進む', 'トニックへ引き戻す'],
    foot: '機能的な読みは調的な素材を前提とします。ある音階がそれを許すかどうかは ',
    footCode: 'supportsFunctionalHarmony',
    footEnd: ' が答えます。',
    desc: '高音部譜表に、C メジャースケールが自身の各度数の上に作る7つの三和音を並べ、上にコードネーム、下にローマ数字と度数を添えます。I は C で 1 度、ii は Dm で 2 度、iii は Em で 3 度、IV は F で 4 度、V は G で 5 度、vi は Am で 6 度、vii° は Bdim で 7 度です。右のカードは副属和音 V/V にあたる D7 を譜例で示します。下の3つのパネルはローマ数字を機能ごとにまとめ、トニックが I・iii・vi、サブドミナントが ii・IV、ドミナントが V・vii° を集めます。',
  },
};

function render(loc) {
  const st = makeStaff({ x: 48, width: 632, top: 132, space: SPACE, clef: 'treble' });
  const xs = DEGREES.map((_, i) => 130 + i * 80);

  const card = makeStaff({ x: 740, width: 170, top: 120, space: SPACE, clef: 'treble' });

  const band = (b, i) => {
    const chips = b.members
      .map((m, j) => {
        const x = b.x + 24 + j * 52;
        return `  <rect class="chip" x="${x}" y="336" width="44" height="26" rx="6"/>
  <text class="rn" x="${x + 22}" y="354" text-anchor="middle">${m}</text>`;
      })
      .join('\n');
    return `  <rect class="grp" x="${b.x}" y="288" width="296" height="114" rx="10"/>
  <text class="lbl" x="${b.x + 24}" y="312">${loc.bandNames[i]}</text>
${chips}
  <text class="s" x="${b.x + 24}" y="386">${loc.bandNotes[i]}</text>`;
  };

  const body = `  <text class="h" x="24" y="42">${loc.title}</text>
  <text class="lbl" x="936" y="42" text-anchor="end">${loc.caption}</text>

  <!-- the seven degrees -->
  <rect class="grp" x="24" y="64" width="680" height="208" rx="10"/>
${DEGREES.map((d, i) => `  <text class="sym" x="${xs[i]}" y="118" text-anchor="middle">${d.sym}</text>`).join('\n')}
  <g class="glyph">
    ${[staffLines(st), clefGlyph(st), barline(st, st.end - 1, { thick: true }), ...DEGREES.flatMap((d, i) => notes(st, xs[i], d.chord))].join('\n    ')}
  </g>
${DEGREES.map(
  (d, i) => `  <text class="rn" x="${xs[i]}" y="204" text-anchor="middle">${d.rn}</text>
  <text class="s" x="${xs[i]}" y="220" text-anchor="middle">${d.deg}</text>`,
).join('\n')}
  <text class="s" x="48" y="252">${loc.note}</text>

  <!-- secondary dominant -->
  <rect class="card" x="720" y="64" width="216" height="208" rx="10"/>
  <text class="h" x="740" y="94">${loc.secondary}</text>
  <text class="sym" x="850" y="112" text-anchor="middle">D7</text>
  <g class="glyph">
    ${[staffLines(card), clefGlyph(card), ...notes(card, 850, ['D4', 'F#4', 'A4', 'C5'])].join('\n    ')}
  </g>
${loc.secondaryLines.map((t, j) => `  <text class="s" x="740" y="${188 + j * 16}">${t}</text>`).join('\n')}

  <!-- function -->
${BANDS.map(band).join('\n\n')}

  <text class="s" x="480" y="432" text-anchor="middle">${loc.foot}<tspan class="mono">${loc.footCode}</tspan>${loc.footEnd}</text>`;

  return svgDocument({
    width: W,
    height: H,
    title: loc.title,
    desc: loc.desc,
    glyphs: ['gClef', 'noteheadHalf', 'accidentalSharp'],
    body,
  });
}

export default { base: 'roman-function', locales: LOCALES, render };
