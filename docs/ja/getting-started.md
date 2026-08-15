# はじめに使う

## 必要環境とインストール

Node.js 22 以降が必要です。

```sh
yarn add @libraz/libcantus
```

実行時依存はありません。ルートからまとめてインポートするか、必要ならレイヤーのサブパスを選べます。

## コードを作り、解析する

クラス API では値を作ってそのまま問いかけられます。

```ts
import { Chord, Key } from '@libraz/libcantus';

const key = Key.major('C');
const dominant = key.chord(5, 'dom7');

dominant.symbol(); // 'G7'
dominant.pitchClasses(); // [2, 5, 7, 11]
dominant.analyze(key).roman; // 'V7'
Chord.parse('C7(b9,#11)').pitchClasses(); // [0, 1, 4, 6, 7, 10]
```

`Note`、`Interval`、`Chord`、`Key`、`Progression` は不変です。変形するメソッドは元の値を変えず、新しい値を返します。

## 短いタイムラインを解析する

関数 API はノートイベントを受け取ります。4 小節のブロックコードから境界と主調を推定し、各区間をローマ数字で読みます。

```ts
import { chordTimelineFromNotes, chordToRoman } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);
const { timeline, prevailingKey } = chordTimelineFromNotes(notes);
timeline.segments.map((segment) => chordToRoman(segment.chord, prevailingKey));
// ['I', 'IV', 'V7', 'I']
```

コード境界はイベントから推定されます。転調があれば、結果は複数のキー領域を持てます。

## インポート境界

```ts
import { parseNote, parseTimeSignature } from '@libraz/libcantus/core';
import { majorKey, makeChord } from '@libraz/libcantus/theory';
import { detectKey } from '@libraz/libcantus/analyze';
import { generateMotif } from '@libraz/libcantus/generate';
import { Note, Key } from '@libraz/libcantus/model';
```

ルートはこれらを再エクスポートするため、サブパスは別 API ではなくパッケージング上の選択です。
