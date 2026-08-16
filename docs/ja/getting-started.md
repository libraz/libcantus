# はじめかた

## 動作環境とインストール

Node.js 22 以降を使用します。

```sh
yarn add @libraz/libcantus
```

パッケージに実行時依存はありません。手軽に使うならルートから、インポート境界を絞りたい場合はレイヤーのサブパスからインポートします。

## コードを組み立てて調べる

クラス API は、値を組み立ててそれについて問い合わせるための簡潔な手段です。

```ts
import { Chord, Key } from '@libraz/libcantus';

const key = Key.major('C');
const dominant = key.chord(5, 'dom7');

dominant.symbol(); // 'G7'
dominant.pitchClasses(); // [2, 5, 7, 11]
dominant.analyze(key).roman; // 'V7'
Chord.parse('C7(b9,#11)').pitchClasses(); // [0, 1, 4, 6, 7, 10]
```

`Note`、`Interval`、`Chord`、`Key`、`Progression` は不変です。変形するメソッドは新しい値を返すため、元の調やコードはそのまま残ります。

同じ値はプレーンデータとしても存在し、関数 API はそちらを受け取ります。

```ts
import { Chord, chordToRoman, majorKey } from '@libraz/libcantus';

const g7 = Chord.of('G', 'dom7');

g7.data.rootPc; // 7
chordToRoman(g7.data, majorKey(0)); // 'V7'
```

## 短いタイムラインを解析する

`Score` はノートイベントと、それを読むための文脈をひとまとめにした値です。曲に対して尋ねたいことは、そのメソッドとして並んでいます。次の例は4小節のブロックコードを渡し、その和声を読み、各区間にラベルを付けます。

```ts
import { Score } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

Score.of(notes)
  .timeline()
  .roman()
  .map((entry) => entry.roman);
// ['I', 'IV', 'V7', 'I']
```

クラスはいずれも関数コアの薄い外皮なので、同じ読み取りを関数ひとつずつでも書けます。どちらのスタイルを選ぶかは好みの問題で、できることは変わりません。

```ts
import { chordTimelineFromNotes, chordToRoman } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey } = chordTimelineFromNotes(notes);
timeline.segments.map((segment) => chordToRoman(segment.chord, prevailingKey));
// ['I', 'IV', 'V7', 'I']
```

コードの境界はイベントから推定されます。曲が転調する場合、結果は複数の調区間を含みます。呼び出し側が冒頭の調をあらかじめ決める必要はありません。

区間は範囲とコードを持ちます。各読みの信頼度は `segmentConfidence` として並んで返り、区間の順に1つずつ対応します。

```ts
import { chordTimelineFromNotes } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [43, 59, 62, 65]].flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, segmentConfidence, keys } = chordTimelineFromNotes(notes);

timeline.segments[0]?.startBeat; // 0
timeline.segments[0]?.endBeat; // 4
segmentConfidence.length === timeline.segments.length; // true
keys.length >= 1; // true
```

`keys` は解析が対象とした調区間を保持し、`prevailingKey` はもっとも長く保たれた調です。調号に表示する調や、単一の調を受け取るジェネレータに渡す調はこちらになります。

## それに対して何かを生成する

生成は同じデータとシードを受け取ります。同じシードからは常に同じ音が得られます。

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const a = generateProgression({ key, style: 'idol', bars: 4, ctx: { seed: 9 } });
const b = generateProgression({ key, style: 'idol', bars: 4, ctx: { seed: 9 } });

a.length; // 4
JSON.stringify(a) === JSON.stringify(b); // true
```

## インポート境界を選ぶ

```ts
import { parseNote, parseTimeSignature } from '@libraz/libcantus/core';
import { majorKey, makeChord } from '@libraz/libcantus/theory';
import { detectKey } from '@libraz/libcantus/analyze';
import { generateMotif } from '@libraz/libcantus/generate';
import { Note, Key } from '@libraz/libcantus/model';
```

ルートの入り口はこれらのシンボルを再エクスポートするため、サブパスは別の API ではなくパッケージングの選択です。

## 次のステップ

- [ユースケース](use-cases/index.md)には、DAW アシスタント、和声課題チェッカー、楽曲解析、生成アレンジの一連の流れがあります。
- [はじめに](introduction.md)ではデータモデルとエンジンの前提を説明します。
- 生成された TypeDoc リファレンスが全シンボルを網羅します。[API リファレンス](api-reference.md)を参照してください。
