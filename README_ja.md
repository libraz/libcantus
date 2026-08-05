# @libraz/libcantus

TypeScript だけで書かれた音楽理論エンジンです。MIDI ノート番号とコードネームを受け取り、和声的な意味（ローマ数字、和声機能、終止、キー）を返します。さらにその解析結果を土台にして新しいパートを生成します。DAW の隣に置くツール（解析器、ジェネレーター、作曲アシスタント）で使うことを想定しています。

扱うのは理論の層だけで、I/O やオーディオには踏み込みません。MIDI ファイルの読み書き、オーディオ解析、再生のいずれも持たないので、パースは呼び出し側で行い、ノートイベントとして渡してください。実行時依存はありません。その層も必要であれば、[libsonare](https://github.com/libraz/libsonare) が音声解析・マスタリング・音源合成・SMF の読み書きを担当していて、npm パッケージなので本ライブラリと並べて置けます。両者はコードを共有しておらず、どちらも単独で使えます。

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus)](https://www.npmjs.com/package/@libraz/libcantus)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![docs](https://img.shields.io/badge/docs-API%20reference-b5892e)](https://libraz.github.io/libcantus/)

## 何ができるか

- **音名を扱う** — `C4` のパース、移調、MIDI との相互変換、異名同音を区別した音程の綴り（`F#` と `Gb`）。
- **コードと進行を組み立てる** — スケール度数、ローマ数字（`V7/V`）、リードシート記号（`Cmaj7`, `F#m7b5`, `C/G`）のいずれからでも。
- **和声を解析する** — ローマ数字解析、和声機能、終止形の検出、借用和音とモーダルインターチェンジ。
- **コードとキーを判定する** — ノートを入れるとコードやキーが返る、組み立ての逆方向の処理。
- **リハーモナイズする** — 裏コード、クロマチックメディアント、ネガティブハーモニー、モーダルインターチェンジのパレット。
- **コードをボイシングする** — 声部の動きを最小化した 4 声（SATB）に加えて、drop-2/3、シェル、ルートレスのコンピングスタイル。
- **パートを生成する** — ベースライン、対旋律、ドラム、リズム、モチーフ、進行全体。シードを与えれば結果は決定的になります。
- **アレンジ全体を解析する** — マルチトラックのノートイベントを渡すと和声を復元し、曲全体の解析（ノート単位の衝突検出つき）を返します。そこから足りないパートを生成できます。
- **音高を音響として扱う** — 周波数、セント、EDO、純正律。

理論の本体は tree-shaking の効く純粋関数として実装してあります。その上に、音楽理論の記述に近い形で書ける不変（immutable）なクラス API（`Note`, `Interval`, `Chord`, `Key`, `Progression`）が乗ります。どちらの形で提供されるかは一つの規則で決まります。音符・コード・キー・進行といった値は両方の形を持ち、相互に行き来できます。一方でコレクションやタイムラインを対象とする操作（パート生成、アレンジ全体の解析、キーのランキング）はノートイベントの配列を受け取るため、関数としてのみ公開されます。

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

層は `core`, `theory`, `analyze`, `generate`, `model` の 5 つです。

## クイックスタート

クラス API は不変のままメソッドチェーンでき、キーの文脈を持ち回るので、解析のたびにキーを渡し直す必要はありません。

```ts
import { Chord, Key, Note } from '@libraz/libcantus';

const c = Key.major('C');

c.chord(4, 'dom7').pitchClasses(); // [2, 5, 7, 11]  (G7)
c.roman('V7/V').voice(); // [ ...SATB の MIDI ノート ]  (セカンダリードミナントをボイシング)
Note.of('C4').transpose(7).name; // 'G4'

// ii–V–I を組み立てて、そのまま 1 行で解析する:
c.chord(1, 'min').progressionTo(c.chord(4, 'dom7'), c.chord(0, 'maj')).analyze();
// { chords: [...機能和声の解析...], cadence: 'authentic' }

Chord.detect([60, 64, 67])[0].quality; // 'maj'
```

どのクラスもプレーンなオブジェクト（`Chord.data`, `Note.data`）を包んでいるだけで、処理は純粋関数に委譲されます。そのため二つのスタイルは自由に混ぜられます。同じ処理を関数 API で書くとこうなります。

```ts
import { chordFromDegree, chordPitchClasses, classifyInterval, ConsonanceClass, majorKey } from '@libraz/libcantus';

const cMajor = majorKey(0);

classifyInterval(7); // ConsonanceClass.PerfectConsonance
chordPitchClasses(chordFromDegree(4, 'dom7', cMajor)); // [2, 5, 7, 11]  (G7)
```

## 音名を扱う

音名のパースと整形、MIDI への変換、そしてピッチクラスの層では区別できない異名同音を正しく綴り分ける音程計算ができます。

```ts
import { Interval, Note } from '@libraz/libcantus';

Note.of('C4').transpose(7).name; // 'G4'
Note.of('C4').midi; // 60
Interval.between(Note.of('C4'), Note.of('F#4')).name; // 'A4'  (増四度)
Interval.between(Note.of('C4'), Note.of('Gb4')).name; // 'd5'  (減五度)
```

## キーとスケール

`KeyScale` はルートのピッチクラスと 12 ビットの `modeMask12` の組です（ビット `n` が立っていれば、ピッチクラス `(rootPc + n) % 12` がスケールに含まれます）。`majorKey`, `minorKey`, `scaleByName` が教会旋法・ペンタトニック・ブルース・ホールトーン・オクタトニックをカバーし、`MAJOR_MASK` と `NATURAL_MINOR_MASK` を使えば独自のキーも定義できます。

`nearestScaleTone` は与えた音高を最も近いスケール構成音の MIDI ノートにスナップします（同距離なら低い方を優先）。生成した音をキーに収める場面で使えます。

## コードと進行を組み立てる

スケール度数、ローマ数字、リードシート記号のいずれからでも組み立てられ、逆方向にも戻せます。

```ts
import { Chord, Key } from '@libraz/libcantus';

const c = Key.major('C');

c.roman('V7/V').symbol(); // 'D7'  (セカンダリードミナント)
c.chord(4, 'dom7').roman(); // 'V7'
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]
```

コードの語彙は三和音から 13th までを網羅していて、`dim7`, `m7b5`, `minMaj7`, `aug7`、6th 系、オルタードドミナントも含みます。

スタイルのプリセットから進行そのものを生成することもできます（コレクション単位の操作なので関数として提供されます）。

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

// 1 小節につき 1 コード。収まる箇所にはセカンダリードミナントを挿入する:
generateProgression({ key: majorKey(0), style: 'idol', bars: 8, reharmonize: true, seed: 1 });
```

## 和声を解析する

コードを、和声機能・終止・モーダルインターチェンジつきのローマ数字解析に変換します。長調と短調の双方に対応し、転回形も反映されます。

```ts
import { Chord, Key } from '@libraz/libcantus';

// 長調に現れる短調の iv は、借用されたサブドミナントとして解釈される:
Chord.of('F', 'min').analyze(Key.major('C'));
// { function: 'subdominant', borrowed: true, source: 'parallelMinor', roman: 'iv' }
```

## コードとキーを判定する

ノートを入れるとコードやキーが返ります。組み立てとちょうど逆方向の処理です。

```ts
import { Chord, detectKey } from '@libraz/libcantus';

Chord.detect([60, 64, 67])[0].symbol(); // 'C'
Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'
detectKey([0, 0, 0, 4, 7])[0]; // 最も適合する C メジャー  (キーのランキングは関数として提供)
```

## コードとスケールを綴る

`Key` は綴りを持ったトニックを保持しているので、ピッチクラスで動くコア部分からでも音名の文字列が得られます。長調でも短調でも綴りは正しくなります。

```ts
import { Chord, Key } from '@libraz/libcantus';

Key.named('harmonicMinor', 'A').noteNames(); // ['A', 'B', 'C', 'D', 'E', 'F', 'G#']
Key.minor('E').noteNames(); // ['E', 'F#', 'G', 'A', 'B', 'C', 'D']

// コードもキーの文脈に沿って綴られる:
Key.major('C').chord(4, 'dom7').spell().map((n) => n.name); // ['G', 'B', 'D', 'F']
```

## リハーモナイズする

クラス側ではネガティブハーモニーによる反転を、関数側では代理コードの候補（裏コード、平行調、借用、クロマチックメディアント、およびモーダルインターチェンジのパレット）の列挙を扱います。

```ts
import { Chord, Key, majorKey, parseChordSymbol, substituteChord } from '@libraz/libcantus';

Key.major('C').chord(4, 'dom7').negativeHarmony().symbol(); // 'Dm7b5'

// 代理コードやパレットの検索はリストを返すので関数として提供される:
substituteChord(parseChordSymbol('G7'), majorKey(0));
// [{ chord: Db7, type: 'tritone', ... }, ...]
```

## スケールとテンションを選ぶ

クラス側で、あるコードに使えるスケールと、そこで利用できるテンションおよびアボイドノートを求められます。`scalesForChanges` を使えば、コード進行全体を通して繋がりが最適になるスケール選択が得られます。

```ts
import { Chord } from '@libraz/libcantus';

Chord.of('C', 'dom7').scales()[0]; // { name: 'mixolydian', rootPc: 0 }
Chord.of('C', 'maj7').tensions('ionian'); // [2, 9]  (9th と 13th。11th はアボイドノート)
```

## コードをボイシングする

進行全体を、声部の動きが最小になる 4 声（SATB）の MIDI ボイシングに展開できます。単体のコードをコンピングスタイル（drop-2/3、シェル、ルートレス）でボイシングすることもできます。

```ts
import { Chord, Key } from '@libraz/libcantus';

const c = Key.major('C');

// 進行全体を、動きが最小になるようボイシングする:
c.chord(0, 'maj').progressionTo(c.chord(5, 'maj'), c.chord(4, 'dom7'), c.chord(0, 'maj')).voice();
// [[...], [...], [...], [...]]  (各声部の音高が昇順に並ぶ)

// 単体のコードをシェルボイシングで:
Chord.of('C', 'maj7').styledVoicing({ style: 'shell' }); // ルート、3rd、7th
```

声部の進行を細かく制御したい場合は `voiceLeadingCost` と `nextVoicing` を、結果を検証したい場合は `counterpoint` の述語群（並行・隠伏の完全音程、音域の間隔、声部の交差、導音の解決など）を使います。

## パートを生成する

旋律と伴奏のジェネレーターは、いずれもシードを取り決定的に動きます。

```ts
import {
  generateBassLine, generateCounterMelody, generateDrums, generateRhythm,
  generateMotif, majorKey, parseTimeSignature,
} from '@libraz/libcantus';

generateRhythm(parseTimeSignature('4/4'), { seed: 1, density: 0.5 }); // 強拍に重みを置いた発音位置
const motif = generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', seed: 1 });
motif.notes.length > 0; // true — 決定的に生成された短い旋律の断片
```

`humanize`, `extractGrooveTemplate`, `applyGrooveTemplate` は拍子を踏まえたノリを付け足します。ある演奏のノリを取り出して別の演奏に移植する使い方もできます。

## アレンジを解析して足す

アレンジ層は、DAW や MIDI ファイルのパーサーが吐いたマルチトラックの `NoteEvent` をそのまま受け取り、和声を復元してから解析と生成を行います。

```ts
import {
  analyzeArrangement, chordTimelineFromNotes, generateBassLine, generateCounterMelody,
} from '@libraz/libcantus';

// 演奏されたノートからコード進行（とキー）を推定する:
const { timeline, key } = chordTimelineFromNotes(melodyAndChordNotes);

// 曲全体の解析。推定されたコード、終止、ノート単位の理論ラベル、そして
// 鳴っている和声とぶつかるノート（理由と修正候補つき）が得られる:
const report = analyzeArrangement([
  { role: 'melody', notes: melodyNotes },
  { role: 'harmony', notes: chordNotes },
]);
report.conflicts; // [{ beat, trackName, pitch, safety, reasons, rationale }, ...]

// 復元されたタイムラインから、足りないパートを生成する:
generateBassLine({ segments: timeline.segments, key, style: 'walking', seed: 1 });
generateCounterMelody({ melody: melodyNotes, timeline, key, register: 'below' });
```

`harmonizeMelody` は逆方向を担当します。旋律だけを渡すと、それを和声づけするのに最適なキー・移調量・コードの経路を（必要ならリハーモナイズも含めて）探索します。

アレンジ層と生成層のあいだでやり取りするノートイベントは `NoteEvent`（`{ pitch, startBeat, durationBeat, velocity? }`。音高は MIDI ノート番号、時間は 4 分音符を 1 とする拍数）の一種類に統一されています。シードを取るジェネレーター（`bass`, `groove`, `countermelody`, `rhythm`, `drums`, `motif`, `progression`）は、同じシードに対して常に同じ結果を返します。

## 音高を音響として扱う

周波数、セント、EDO、純正律を扱えます。音律の設計、微分音、そして解析に使えます。

```ts
import { frequencyOf, edo, justDeviationCents } from '@libraz/libcantus';
```

拍子まわりのヘルパー（`TimeSignature`, `parseTimeSignature`, `beatsPerBar`, `metricWeight`, `isStrongBeat`, `tuplet`）は単純拍子と複合拍子の両方を扱い、アクセントを考慮するジェネレーター群の土台にもなっています。

## ドキュメント

すべてのエクスポートをシグネチャつきで、領域ごとに分類し、動かせる例を添えた API リファレンスをソースから生成して **[libraz.github.io/libcantus](https://libraz.github.io/libcantus/)** に公開しています。

## ライセンス

Apache-2.0
