# @libraz/libcantus

TypeScript だけで書かれた音楽理論エンジンです。MIDI ノート番号とコードネームを受け取って和声的な意味（ローマ数字、和声機能、終止、キー）を返し、その結果を土台にして新しいパートを生成します。実行時依存はありません。

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus)](https://www.npmjs.com/package/@libraz/libcantus)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![docs](https://img.shields.io/badge/docs-API%20reference-b5892e)](https://libraz.github.io/libcantus/)

## 何に使うか

作るときに想定していた 3 つの用途です。以下のコードはそのまま動きます。

### DAW の隣に置く

マルチトラックのノートイベントを渡すと和声が返り、その上に新しいパートを書けます。

```ts
import {
  chordTimelineFromNotes, chordToRoman, detectCadence, generateBassLine,
} from '@libraz/libcantus';

// DAW が渡してくるままの、和音で置いた 4 小節:
const harmony = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey } = chordTimelineFromNotes(harmony);
timeline.segments.map((s) => chordToRoman(s.chord, prevailingKey)); // ['I', 'IV', 'V7', 'I']

const [, , penultimate, final] = timeline.segments;
detectCadence(penultimate.chord, final.chord, prevailingKey).type; // 'authentic'

// いま復元した和声の上を歩くベース:
generateBassLine({ segments: timeline.segments, key: prevailingKey, style: 'walking', seed: 1 });
// [{ pitch: 36, startBeat: 0, durationBeat: 1, velocity: 100 }, ...16 音]
```

和音の切れ目もキーも決め打ちではなく探索されるので、転調する曲を最初のキーのまま解析してしまうことがありません。

### 和声課題を採点する

課題は書かれているとおりの形で渡せます。独語や日本語の音名、数字付き低音、大譜表上の 4 声。返ってくるのは、その答案が何を犯しているかと、該当する声部と理由です。次の例では属七の第 7 音が下行せずに上行しています。コラール課題でまず指摘される誤りです。

```ts
import { Chord, Key, checkPartWriting, parseNote } from '@libraz/libcantus';

Key.parse('gis moll').toString(); // 'G# minor'
Key.parse('嬰ト短調').toString({ system: 'german' }); // 'gis moll'

const line = (names: string) => names.split(' ').map((name) => parseNote(name));

// V7 から I へ。ソプラノの F を E に下げず、G に上げてしまった答案:
checkPartWriting(
  [line('G2 B3 D4 F4'), line('C3 C4 E4 G4')],
  [Chord.of('G', 'dom7').data, Chord.of('C', 'maj').data],
  Key.major('C').scale,
);
// [{ kind: 'unresolvedSeventh', voices: [3], fromIndex: 0, toIndex: 1,
//    rationale: 'The chordal seventh does not fall by step' }]
```

その F を E に解決させれば、同じ呼び出しが `[]` を返します。2 声対位法は `checkSpecies` が第 1 種から第 5 種まで採点します。禁則の語彙は共通なので、課題の並行 5 度もコラールの並行 5 度も同じ形で返ります。

### 曲を読む

`reduceProgression` は各和音を `structural`、`passing`、`auxiliary` のいずれかに分類します。装飾は、それが飾っている和音と同格ではないからです。

```ts
import { chordTimelineFromChords, majorKey, reduceProgression } from '@libraz/libcantus';

// Cmaj7 -> C#dim7 -> Dm7 を 1 小節ずつ:
const changes = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj7', startBeat: 0 },
    { rootPc: 1, quality: 'dim7', startBeat: 4 },
    { rootPc: 2, quality: 'min7', startBeat: 8 },
  ],
  12,
);

reduceProgression(changes, majorKey(0)).map((entry) => entry.level);
// ['structural', 'passing', 'structural']  —— それぞれに根拠が付く
```

`phrasesFromTimeline` は終止・休符・反復・ハイパーメーター上の位置から曲をフレーズに分けます。形式まわりの残りは `hypermeter`、`sectionsFromNotes`、`extractMotifs` が担当します。

## どう答えるか

ライブラリ全体を貫く 4 つの方針です。理論のヘルパー関数を集めたものとの違いはここにあります。

**推測しません。** 完全終止と判定するにはソプラノに主音が必要で、ソプラノがどこにあるかはボイシングだけが知っています。渡されなければ、もっともらしい答えではなく `null` が返ります。

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const [G, C] = [Chord.of('G', 'maj').data, Chord.of('C', 'maj').data];
const key = Key.major('C').scale;

detectCadence(G, C, key).strength; // null —— ソプラノを名指すものが何もない
detectCadence(G, C, key, { voicing: [[55, 62, 71], [48, 64, 67, 72]] }).strength; // 'perfect'
```

**根拠を返します。** `analyzeChord`、`detectCadence`、`detectKey`、`explainRoman` はいずれも判断の根拠を `rationale` として持ち、`alternatives` を要求すれば退けた解釈も返します。根拠は答えを出したのと同じ処理から導かれるので、両者が食い違うことはありません。

```ts
import { Chord, Key, explainRoman } from '@libraz/libcantus';

explainRoman(Chord.of('G', 'dom7').data, Key.major('C').scale).rationale;
// 'V7: the root is the fifth degree of the key, the case and suffix come from
//  the dom7 quality, and the chord stands on its own root'
```

**綴りを保ちます。** 対斜は同じ音名字が別の変化記号を持つことであり、増 2 度は響きの上では短 3 度です。どちらも音高だけからは判定できません。声部書法と対位法の検査が綴られた音を受け取るのはこのためで、`spellLine` も 1 音ずつではなく声部全体を 1 本の経路として解きます。

**当てはまらないときは引き下がります。** ローマ数字と機能和声は西洋の共通実践を前提にしています。その外にある音組織は `WORLD_SCALES` にあり（日本の陰音階と陽音階、4 つのマカーム、ヒンドゥスターニー音楽のターット群）、`supportsFunctionalHarmony` がその読みを当てはめてよいかを答えます。

```ts
import { Key, supportsFunctionalHarmony } from '@libraz/libcantus';

Key.named('miyakoBushi', 'E').noteNames(); // ['E', 'F', 'A', 'B', 'C']
supportsFunctionalHarmony('miyakoBushi'); // false
supportsFunctionalHarmony('dorian'); // true
```

四分音を含む音度の上に立つマカームは、12 平均律の近い音で代用せず、収録していません。

## 何を扱わないか

- **I/O とオーディオの層ではありません。** MIDI ファイルの読み書き、記譜、オーディオ解析、再生のいずれも持ちません。パースは呼び出し側で行い、ノートイベントとして渡してください。その層も必要であれば、[libsonare](https://github.com/libraz/libsonare) が音声解析・マスタリング・音源合成・SMF の読み書きを担当していて、npm パッケージなので本ライブラリと並べて置けます。両者はコードを共有しておらず、どちらも単独で使えます。
- **音高の層より上は微分音を扱いません。** 周波数・セント・EDO・純正律は揃っていますが、解析が動くのは 12 のピッチクラスの上です。半音より細かい単位で組み立てられた音楽は範囲外です。
- **コーパスは持ちません。** 統計を取るための楽曲データは同梱していません。
- **和声解析は網羅的ではありません。** 既知の非対応は 3 点あります。カデンツ 4-6 は属機能ではなく転回した主和音として読まれます。半終止は長三和音の属和音を要求するので、旋法的な短調の v への到達は半終止になりません。偽終止は第Ⅵ音への進行だけを対象にしています。

## インストール

```sh
yarn add @libraz/libcantus
```

## サブパスインポート

パッケージのルートからはすべてがエクスポートされます。特定の層だけを取り込みたい場合は、その層のサブパスからインポートしてください。

```ts
import { Chord, Key, Note } from '@libraz/libcantus/model'; // クラス API
import { majorKey, makeChord } from '@libraz/libcantus/theory'; // スケール、コード
import { generateDrums, generateProgression } from '@libraz/libcantus/generate';
import { analyzeArrangement, detectKey } from '@libraz/libcantus/analyze';
import { parseNote, edo } from '@libraz/libcantus/core'; // 音高、拍子、音律
```

層は `core`、`theory`、`analyze`、`generate`、`model` の 5 つです。

## 2 つの API

理論の本体は tree-shaking の効く**純粋関数**として実装してあります。その上に、音楽理論の記述に近い形で書ける**不変（immutable）なクラス API**（`Note`、`Interval`、`Chord`、`Key`、`Progression`）が乗ります。どちらの形で提供されるかは一つの規則で決まります。音符・コード・キー・進行といった**値**は両方の形を持ち、相互に行き来できます。一方で**コレクションやタイムライン**を対象とする操作（パート生成、アレンジ全体の解析、キーのランキング）はノートイベントの配列を受け取るため、関数としてのみ公開されます。

```ts
import { Chord, Key, Note } from '@libraz/libcantus';

const c = Key.major('C');

c.chord(5, 'dom7').pitchClasses(); // [2, 5, 7, 11]  (G7)
c.roman('V7/V').voice(); // [ ...SATB の MIDI ノート ]  (セカンダリードミナントをボイシング)
Note.of('C4').transpose(7).name; // 'G4'

// ii–V–I を組み立てて、そのまま 1 行で解析する:
c.chord(2, 'min').progressionTo(c.chord(5, 'dom7'), c.chord(1, 'maj')).analyze();
// { chords: [...機能和声の解析...], cadence: { type: 'authentic', ... } }
```

どのクラスもプレーンなオブジェクト（`Chord.data`、`Note.data`）を包んでいるだけで、処理は純粋関数に委譲されます。そのため二つのスタイルは自由に混ぜられます。

## 音名・音程・キーを扱う

音名のパースと整形、MIDI への変換、そしてピッチクラスの層では区別できない異名同音を正しく綴り分ける音程計算ができます。どのパーサーにも例外を投げない対の関数（`tryParseNote`、`tryParseInterval`、`tryParseChordSymbol`、`Chord.tryParse`）があるので、入力欄で 1 打鍵ごとに try/catch を書く必要はありません。

```ts
import { Interval, Note, tryParseNote } from '@libraz/libcantus';

Note.of('C4').transposeBy('A4').name; // 'F#4'  (6 半音ではなく音程名で指定する)
Interval.between(Note.of('C4'), Note.of('F#4')).name; // 'A4'  (増四度)
Interval.between(Note.of('C4'), Note.of('Gb4')).name; // 'd5'  (減五度)
tryParseNote('C#b'); // { ok: false, error: InvalidInputError }
```

`KeyScale` はルートのピッチクラスと 12 ビットの `modeMask12` の組です（ビット `n` が立っていれば、ピッチクラス `(rootPc + n) % 12` がスケールに含まれます）。`majorKey`、`minorKey`、`scaleByName` が教会旋法・ペンタトニック・ブルース・ホールトーン・オクタトニックをカバーし、`MAJOR_MASK` と `NATURAL_MINOR_MASK` を使えば独自のキーも定義できます。`nearestScaleTone` は与えた音高を最も近いスケール構成音にスナップします。

キーは自分の調号と、周囲のキーと、そこへの行き方を知っています。関係の計算は五度圏の上で行うので、返ってくるキーはそのキーが実際に書かれる綴りになります。変ニ長調の平行調は変ロ短調であって嬰イ短調ではありません。音度は音楽で数えるとおり 1 から数え、音度はキーそのものを担うこともできます。転調を問う設問はたいていこの組み合わせでできています。

```ts
import { Key } from '@libraz/libcantus';

Key.major('C').relative().toString(); // 'A minor'
Key.major('C').relationTo(Key.minor('A')); // 'relative'
Key.minor('D').transposeBy('A4').toString(); // 'G# minor'
Key.minor('D').transposeBy('d5').toString(); // 'Ab minor'
Key.minor('A').keyOnDegree(4).toString(); // 'D minor'  調性はその度数の三和音から読む

// 「ある曲の調が、その平行調の第Ⅳ音を主音とする調に転調し、
//   さらに増四度高い調に移調された結果 gis moll となった。元の調は何か」
Key.minor('G#').transposeBy('-A4').keyHavingTonicAsDegree(4).relative().toString(); // 'C major'
```

## コードと進行を組み立てる

スケール度数、ローマ数字、リードシート記号のいずれからでも組み立てられ、逆方向にも戻せます。コードは、名前の固定リストではなく、基本形に 7th と変化音・付加音・省略音の集合を重ねた構造（`ChordSpec`）として持っています。そのため、リードシートには書かれるのに名前のないコードもパースできます。

```ts
import { Chord, Key, chordSpecOf } from '@libraz/libcantus';

Key.major('C').roman('V7/V').symbol(); // 'D7'  (セカンダリードミナント)
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]
Chord.parse('C7(b9,#11)').pitchClasses(); // [0, 1, 4, 6, 7, 10]
chordSpecOf(Chord.parse('C7(b9,#11)').data).alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
```

名前のついたコードもそのまま揃っています。`dim7`、`m7b5`、`minMaj7`、`aug7`、6th 系、オルタードドミナント、13th までの拡張が使え、`Chord.quality` はそのうち最も近いものを返します。構成音・転回・記号の整形はすべてこの構造を通るので、名前はコードに貼るラベルであって、綴れる範囲の上限ではありません。

進行そのものをスタイルのプリセットから生成することもできます。

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

// 1 小節につき 1 コード。収まる箇所にはセカンダリードミナントを挿入する:
generateProgression({ key: majorKey(0), style: 'idol', bars: 8, reharmonize: true, seed: 1 });
```

## 和声を解析する

和声機能・終止・モーダルインターチェンジつきのローマ数字解析を返します。長調と短調の双方に対応し、転回形も反映されます。

```ts
import { Chord, Key } from '@libraz/libcantus';

// 長調に現れる短調の iv は、借用されたサブドミナントとして解釈される:
Chord.of('F', 'min').analyze(Key.major('C'));
// { function: 'subdominant', borrowed: true, source: 'parallelMinor', roman: 'iv',
//   rationale: 'Subdominant: iv takes the subdominant function of its degree in
//   the key, borrowed from the parallel minor', alternatives: [] }
```

`detectCadence` は終止の種類（authentic, plagal, half, deceptive, phrygian, modal）を答え、正格終止については完全か不完全かまで判定します。根音の動きを伴わない V から V への繰り返しは終止ではないので、種類は null になります。

## 和声課題を解き、対位法を書く

数字の付かない音程は調から取るので、同じ 6 でも度数ごとに別の和音になります。独6の和音は、響きの上では属七でも増 6 度として綴られます。移調楽器は自分の調で読みます。

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, romanToChord, spellChord } from '@libraz/libcantus';

const sixth = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(sixth, parseNote('B'), Key.major('C').scale).map((note) => formatNote(note));
// ['B', 'D', 'F'] —— 導音上の三和音が、その第 3 音を低音にして鳴っている

romanToChord('Ger6', Key.major('C').scale).bassPc; // 8 —— 下げられた第Ⅵ音
Key.major('C').forInstrument('clarinetA').toString(); // 'Eb major'
```

`checkSpecies` は第 1 種から第 5 種までを採点します。`imitate` はカノン的な応答を書きます。real なら音程をそのまま保ち、tonal なら調が用意する音度を取るので、上行 5 度が 4 度になって返ります。

```ts
import { checkSpecies, imitate, majorKey, parseNote, scaleByName } from '@libraz/libcantus';

const line = (names: string) => names.split(' ').map((name) => parseNote(name));

// ドリア調の第 1 種、定旋律の上に対旋律を置いた教科書の課題:
checkSpecies(
  line('D4 F4 E4 D4 G4 F4 A4 G4 F4 E4 D4'),
  line('A4 A4 G4 A4 B4 C5 C5 B4 D5 C#5 D5'),
  1,
  scaleByName('dorian', 2),
); // []  —— 何も犯していない

const subject = [60, 62, 64, 67].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
imitate(subject, { atBeat: 4, interval: 'P5', key: majorKey(0), answer: 'tonal' })
  .map((note) => note.pitch); // [67, 69, 71, 74]
```

`voiceIndependence` は 2 声のあいだの動き、リズムの相補性、音域の隔たり、完全協和音程の連続の長さを測り、可否ではなく数値を返します。対位法の規則をそのままポピュラー音楽に当てると並行 3 度もペダルポイントも誤りになってしまうので、それをどう扱うかは書き手が決めるものだからです。

## コードとキーを判定し、音を綴る

ノートを入れるとコードやキーが返ります。組み立てとちょうど逆方向の処理です。キーは、重みづけしたピッチクラス分布と候補キーのプロファイルとの相関で順位づけされます。`score` はその相関値（-1 から 1）で、どのプロファイルを使うかは `profile` オプションで選べます。要求すれば教会旋法も 24 の長短調と一緒に順位を争います。

```ts
import { Chord, detectKey } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'

// D ドリアのリフ。D-F-A の輪郭に B ナチュラルが鳴り、B フラットはどこにもない。
detectKey([2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2], { modes: true })[0].scaleName; // 'dorian'

detectKey([0, 2, 4, 5, 7, 9, 11], { explain: true })[0].rationale;
// 'C major: profile correlation 0.76, with 7 of 7 input pitch classes in the scale'
```

`Key` は綴りを持ったトニックを保持しているので、ピッチクラスで動くコア部分からでも音名の文字列が得られます。`spellLine` は声部全体を 1 本の経路として解くので、同じ動きがシャープ系とフラット系で書き分けられてしまうことがなくなります。上行する半音階はシャープを、下行する半音階はフラットを取り、コードが名指す音はコードの綴りに従います。

```ts
import { Key, majorKey, noteNames, spellLine } from '@libraz/libcantus';

Key.named('harmonicMinor', 'A').noteNames(); // ['A', 'B', 'C', 'D', 'E', 'F', 'G#']

const rising = [60, 61, 62, 63, 64].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
noteNames(spellLine(rising, null, majorKey(0))); // ['C4', 'C#4', 'D4', 'D#4', 'E4']
```

第 2 引数はコードタイムラインです。`null` を渡せばキーだけから綴ります。

## リハーモナイズしてボイシングする

代理コードの候補（裏コード、平行調、借用、クロマチックメディアント、モーダルインターチェンジのパレット）、コードに使えるスケールとそのアボイドノートおよびテンション、そして 4 声からコンピングスタイルまでのボイシングを扱います。

```ts
import { Chord, Key, majorKey, parseChordSymbol, substituteChord } from '@libraz/libcantus';

substituteChord(parseChordSymbol('G7'), majorKey(0)); // [{ chord: Db7, type: 'tritone', ... }, ...]
Key.major('C').chord(5, 'dom7').negativeHarmony().symbol(); // 'Dm7b5'

Chord.of('C', 'dom7').scales()[0]; // { name: 'mixolydian', rootPc: 0 }
Chord.of('C', 'maj7').tensions('ionian'); // [2, 9]  (9th と 13th。11th はアボイドノート)

const c = Key.major('C');
c.chord(1, 'maj').progressionTo(c.chord(6, 'min'), c.chord(5, 'dom7'), c.chord(1, 'maj')).voice();
// [[48, 60, 64, 67], [45, 60, 64, 69], [43, 62, 65, 71], [48, 60, 64, 72]]

Chord.of('C', 'maj7').styledVoicing({ style: 'shell' }); // ルート、3rd、7th
```

コード進行全体を通して繋がりが最適になるスケール選択は `scalesForChanges` が返します。声部の進行を細かく制御したい場合は `voiceLeadingCost` と `nextVoicing` を、結果を検証したい場合は `counterpoint` の述語群を使います。

## 音楽を時間の上に置く

拍子は曲の途中で変わります。解析の入口が受け取るのは `MeterMap`（`{ startBeat, ts }[]`）で、`ts` は要素 1 つのマップの糖衣として受け付けます。位置にかかわるものはすべて、単一の剰余ではなくその時点で有効な小節から位置を導きます。アウフタクトは小節線の前で鳴ります。小節頭が拍 0、弱起は小節 -1 で、`pickupBeats` がどこまで前から始めてよいかを宣言します。

```ts
import { formatBarPosition, metricWeight, parseTimeSignature } from '@libraz/libcantus';

// 4/4 が 2 小節、8 拍目から 3/4:
const meters = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 8, ts: parseTimeSignature('3/4') },
];

metricWeight(11, meters); // 3 —— 3/4 の小節頭
metricWeight(12, meters); // 1 —— 4/4 のまま読んだときだけ小節頭に見える位置

formatBarPosition(-1, parseTimeSignature('4/4')); // '0.4'  楽譜では弱起の小節を 0 と数える
```

テンポは区分定数の `TempoMap` で、変化点をまたいでも正確に積分されます。長さは記譜どおりの音価として綴られます。

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

// 120 で 4 拍、続いて 60 で 4 拍。全体を 60 で読むと 8 秒になってしまう。
beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6

beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
```

同じ拍を PPQ のグリッドに載せるのが `beatsToTicks` と `ticksToBeats` です。残りの拍子ヘルパーは単純拍子・複合拍子・加法拍子を扱います。

## パートを生成する

ベースライン、対旋律、ドラム、リズム、モチーフ、装飾を、同じシードに対して常に同じ結果で生成します。プロジェクトのシード、テンポ、楽器、そしてどれだけ凝った結果を求めるかは、1 つの `GenerationContext` が持ちます。`complexity` の `rhythmic`、`harmonic`、`ornament` は 0..1 の連続値で、上げても要素が増えるだけで、すでに鳴っているものは動きません。`difficulty` は 1 から 5 の上限であって強度ではなく、候補を減らす方向にしか働きません。「凝っているが易しい」も「素直だが難しい」もどちらも実在する注文だからです。

```ts
import { generateDrums, generateMotif, majorKey } from '@libraz/libcantus';

generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', seed: 1 });

generateDrums({
  bars: 4,
  style: 'funk',
  section: 'chorus',
  ctx: { seed: 1, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});
```

数値を 1 つ渡せば `{ seed }` の糖衣になります。乱数は小節・拍・声部という位置で引かれ、シードはパートごとに導出されるので、曲の途中でパラメーターを変えても他の場所は動きません。出力を固定したい場合に指定するのが `algorithmVersion` です。

装飾はすでにある素材に対する独立したパスです。フィルを易しくするために生成し直す必要はありません。

```ts
import { ornament } from '@libraz/libcantus';

// 8 分音符で埋めた 1 小節。ゴーストは弱い位置に付く。
const eighths = [60, 62, 64, 65, 67, 65, 64, 62];
const notes = eighths.map((pitch, i) => ({ pitch, startBeat: i * 0.5, durationBeat: 0.5 }));

ornament(notes, { style: 'ghost', amount: 0.6, seed: 4 }).map((note) => note.articulation);
// [undefined, 'ghost', 'ghost', undefined, undefined, 'ghost', 'ghost', undefined]
```

ドラムのフィル、キックの図形、ベースのリックは分岐ではなく辞書として持っています。`Vocabulary<T>` の各項目は適用条件（ジャンル、セクション、テンポ域、拍子、難度）を宣言するので、選択は引き当てになります。`GenerationContext.vocabulary` には自前の辞書を渡せます。

`InstrumentProfile` は楽器の物理的な姿を記述するので、音域はそこから導かれます。`playability` は、書き換えも却下もせずに、何が障害になるかだけを報告します。

```ts
import { BASS_4_STRING, GUITAR_DROP_D, GUITAR_STANDARD, canSound, playability } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true   (D2)
canSound(GUITAR_STANDARD, 38); // false  (レギュラーチューニングは E2 まで)

playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING).issues;
// [{ type: 'noteOutOfRange', layer: 1, notes: [0], startBeat: 0, impossible: true,
//    message: '4-string bass cannot sound MIDI 27' }]
```

コンテキストで楽器を指名することが、そのパートをその楽器で弾けるように書けという要求そのものです。音域から外れたベースラインは、奏者がそうするようにオクターブ単位で折り返されます。

## アレンジを解析して足す

`analyzeArrangement` はマルチトラックの `NoteEvent` をそのまま受け取り、推定されたコード、曲が経由するキー、ノート単位の理論ラベル、そして鳴っている和声とぶつかるノートを返します。

```ts
import { analyzeArrangement, generateCounterMelody } from '@libraz/libcantus';

const report = analyzeArrangement([
  { role: 'melody', notes: melodyNotes },
  { role: 'harmony', notes: chordNotes },
]);
report.conflicts; // [{ beat, trackName, pitch, safety, reasons, rationale }, ...]

report.keys.map((region) => region.modulation); // [undefined, 'dominant', ...]
report.keys[1]?.pivot; // { chord, romanFrom: 'I', romanTo: 'IV' }

generateCounterMelody({ melody: melodyNotes, timeline: report.timeline, key: report.prevailingKey });
```

キーの探索は `keyTimelineFromNotes` と `detectModulations` として単体でも使えます。`pivotChords(from, to)` は任意の 2 つのキーが共有する三和音を、それぞれのローマ数字つきで返します。

`harmonizeMelody` は逆方向を担当します。装飾音はコードを選ぶ前に旋律と拍子から分類されるので、和声は旋律の構造音に従い、強拍に置かれた非和声音に引きずられません。

```ts
import { harmonizeMelody, majorKey } from '@libraz/libcantus';

// 「きらきら星」の C C G G A A G / F F E E D D C。各半分の終わりの音だけ 2 倍の長さで置く。
let beat = 0;
const twinkle = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60].map((pitch, i) => {
  const durationBeat = i === 6 || i === 13 ? 2 : 1;
  const note = { pitch, startBeat: beat, durationBeat };
  beat += durationBeat;
  return note;
});

harmonizeMelody({ melody: twinkle, key: majorKey(0), harmonicRhythm: 2 })
  .chords.map((chord) => chord.rootPc); // [0, 5, 0, 5, 0, 7, 0]  (C F C F C G C)
```

1 打鍵ごとに解析し直すホストは、セッションを持てます。編集が影響する拍だけを計算し直して前回の解析に継ぎ足し、全体を解析し直した結果と一致させられない場合は、近い答えを返すのではなく全体の再解析に切り替えます。

```ts
import { chordTimelineFromNotes, createArrangementSession } from '@libraz/libcantus';

// C F G7 C を 1 小節ずつ和音で置き、その上に旋律を重ねた 4 小節:
const harmony = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);
const melody = [72, 69, 71, 72].map((pitch, bar) => ({ pitch, startBeat: bar * 4, durationBeat: 4 }));
const { prevailingKey } = chordTimelineFromNotes(harmony);

const session = createArrangementSession(
  [{ role: 'melody', notes: melody }, { role: 'harmony', notes: harmony }],
  { key: prevailingKey },
);

// 動かすのは最終小節の 1 音だけなので、計算し直されるのもその周辺だけ:
const editedNotes = melody.map((note, i) => (i === 3 ? { ...note, pitch: 76 } : note));
const next = session.update([{ trackIndex: 0, notes: editedNotes }]);
next.analysis.timeline.segments.map((s) => s.chord.rootPc); // [0, 5, 7, 0]  (全体を解析し直した結果と同じ)
session.analysis.timeline.segments; // 編集前の解析はそのまま残るので、取り消しに使える
```

やり取りするノートイベントは `NoteEvent`（`{ pitch, startBeat, durationBeat, velocity?, articulation? }`。音高は MIDI ノート番号、時間は 4 分音符を 1 とする拍数で、アウフタクトは負の値）の一種類に統一されています。

## 楽曲の形式を読む

和音の上には、聴き手が実際に聴き取っている単位があります。`phrasesFromTimeline` は終止・休符・反復・ハイパーメーター上の位置から曲をフレーズに分け、それぞれに終止形と分割の根拠と確信度を持たせます。`structuralCadences` はそれらを重みで順位づけするので、「この曲の終止はどれか」に答えられます。

```ts
import {
  chordTimelineFromChords, majorKey, phrasesFromTimeline, structuralCadences,
} from '@libraz/libcantus';

// 8 小節の大楽節。前半は属和音に向かってそこで止まり、後半は下属和音から始めて主和音で閉じる。
const period = [
  [0, 'maj'], [5, 'maj'], [2, 'min'], [7, 'maj'],
  [5, 'maj'], [2, 'min'], [7, 'maj'], [0, 'maj'],
] as const;
const timeline = chordTimelineFromChords(
  period.map(([rootPc, quality], bar) => ({ rootPc, quality, startBeat: bar * 4 })),
  32,
);

const quarters = (pitches: number[], at: number) =>
  pitches.map((pitch, i) => ({ pitch, startBeat: at + i, durationBeat: 1 }));
const tune = [
  ...quarters([60, 62, 64, 65], 0), ...quarters([67, 65, 64, 62], 4),
  ...quarters([64, 65, 67, 69], 8), { pitch: 71, startBeat: 12, durationBeat: 4 },
  ...quarters([69, 67, 65, 64], 16), ...quarters([62, 64, 65, 67], 20),
  ...quarters([65, 64, 62, 59], 24), { pitch: 60, startBeat: 28, durationBeat: 4 },
];

const phrases = phrasesFromTimeline(timeline, tune, { key: majorKey(0) });
phrases.map((phrase) => phrase.cadence?.cadence.type); // ['half', 'authentic']
phrases[0]?.signals; // ['cadence', 'longNote', 'hypermeter']

structuralCadences(phrases)[0]; // { cadence: {...}, weight: 1, phraseIndex: 1 }
```

`hypermeter` は小節がいくつずつまとまるかを推定し、`sectionsFromNotes` は反復から形式を復元します。セクションには名前ではなく記号が付きます。反復だけでは、サビと 2 番の A メロを見分けられないからです。

```ts
import { hypermeter, sectionsFromNotes } from '@libraz/libcantus';

const held = (pitches: number[], at: number) =>
  pitches.map((pitch) => ({ pitch, startBeat: at, durationBeat: 16 }));
const perBar = (pitches: number[], at: number) =>
  pitches.map((pitch, i) => ({ pitch, startBeat: at + i * 4, durationBeat: 4 }));
const strain = (at: number, chord: number[], line: number[]) => [
  ...held(chord, at),
  ...perBar(line, at),
];

// 12 小節。C の上の 4 小節、対照的な F の上の 4 小節、そして最初の 4 小節の再現。
const notes = [
  ...strain(0, [48, 55, 64], [72, 69, 71, 67]),
  ...strain(16, [53, 60, 69], [65, 72, 74, 69]),
  ...strain(32, [48, 55, 64], [72, 69, 71, 67]),
];

hypermeter(notes).groupBars; // 4  —— 小節頭の位置と確信度も一緒に返る
sectionsFromNotes(notes, { unitBars: 4 }).map((section) => section.label); // ['A', 'B', 'A']
```

進行を支える和音と装飾する和音を分けるのは、前に挙げた `reduceProgression` です。既定では、装飾だと示せない限り和音は構造的とみなします。`basis: 'duration'` を渡せば同じ進行を保持時間の側から読みます。

`extractMotifs` は音程の輪郭とリズムの形から反復する断片を見つけるので、別の音高で言い直された形も、音価を引き伸ばした形も同じ figure として認識されます。`relateMotifs` は 2 つの提示がどう関係するか（反復、移高、反行、逆行、逆行反行、拡大、縮小）を名指し、音程をそのまま保つ real な反復と、調の音度に合わせる tonal な反復を区別します。この違いを生むのが調です。

```ts
import { majorKey, motifFromNotes, relateMotifs } from '@libraz/libcantus';

const cell = (pitches: number[]) =>
  pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));

// C D E を 1 度上で答える。字義どおりの応答は長 2 度を保つので F# を要求し、
// 全音階の応答はハ長調に留まって 2 度を短くする。
const subject = motifFromNotes(cell([60, 62, 64]));
relateMotifs(subject, motifFromNotes(cell([62, 64, 66])), majorKey(0))?.kind; // 'transposition'
relateMotifs(subject, motifFromNotes(cell([62, 64, 65])), majorKey(0))?.kind; // 'tonalTransposition'
```

厳密な変形では説明のつかない場合を扱うのが `melodicSimilarity` と `melodicContour` です。

## 音高を音響として扱う

```ts
import { edo, frequencyOf, justDeviationCents } from '@libraz/libcantus';
```

周波数、セント、EDO、純正律を扱えます。音律の設計と解析に使えます。

## ドキュメント

すべてのエクスポートをシグネチャつきで、領域ごとに分類し、動かせる例を添えた API リファレンスをソースから生成して **[libraz.github.io/libcantus](https://libraz.github.io/libcantus/)** に公開しています。

## ライセンス

Apache-2.0
