# 解析

解析関数はプレーンな値を受け、構造化した結果を返します。答えだけでなく、選択の根拠と、対応する API では退けた候補も保持します。

## コードとキーの認識

`Chord.detectBest` は MIDI ピッチからコードを認識します。`detectKey` は重み付けしたピッチクラス分布からキーを順位付けし、`modes: true` で教会旋法も候補に含めます。

```ts
import { Chord, detectKey } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'
detectKey([2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2], { modes: true })[0].scaleName;
// 'dorian'
```

詳しい一致情報には `detectChord`、`detectChordBest`、`detectKeyBest`、`detectKeyFromNotes` を使います。

## タイムラインと終止

`chordTimelineFromNotes` はノートイベントからコード区間と主調を探します。既知のルートと長さがあれば `chordTimelineFromChords` を使います。

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const key = Key.major('C').scale;
detectCadence(Chord.of('G', 'maj').data, Chord.of('C', 'maj').data, key).type;
// 'authentic'
```

ボイシングを渡すと正格終止を完全・不完全まで評価できます。根音進行のない V の反復は終止になりません。

## 縮約と形式

`reduceProgression` は和音を `structural`、`passing`、`auxiliary` に分けます。`phrasesFromTimeline`、`structuralCadences`、`hypermeter`、`sectionsFromNotes` はフレーズと形式を扱います。

## アレンジ報告

`analyzeArrangement` はトラック役割、コードタイムライン、キー領域、理論ラベル、衝突報告をまとめます。全体が不要なら `tensionCurve` と `analyzeVoice` で一部を取得できます。
