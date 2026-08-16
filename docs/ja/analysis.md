# 解析

解析関数はプレーンな値を受け取り、構造化された結果を返します。答えに加えて、その選択に使った根拠と、対応する API では退けた候補も保持します。

このページの結果はいずれも、根拠に支えられた読みであって、音符から復元された事実ではありません。結果を提示する UI は、根拠となる数値をあわせて表示し、上書きできるようにしてください。

## コードの認識

`Chord.detectBest` は MIDI ピッチからコードを認識します。関数 API はクラス値の代わりに一致の詳細を返します。

```ts
import { Chord, detectChord, detectChordBest } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'

detectChordBest([60, 64, 67])?.rootPc; // 0

const match = detectChord([60, 64, 67])[0];
match?.quality; // 'maj'
match?.exact; // true
match?.inversion; // 0

detectChord([64, 67, 72])[0]?.inversion; // 1
```

`detectChordBest` はそのまま使えるコードを返し、`detectChord` は順位づけされた `ChordMatch` を返します。答えと同じくらい根拠が重要な場面では後者を使います。`ChordMatch` は、入力に含まれないコード構成音を `missingPcs`、コードに属さない入力ピッチを `extraPcs` として報告し、両者の集合が一致する場合に `exact` が真になります。`inversion` は転回形を特定できない場合に null になります。ベースのない順序なしピッチクラス集合の場合や、ベースがコード構成音でない場合で、後者では `bassPc` に値が入ります。

`input` は数値の読み方を決めます。`midi` は数値上もっとも低いピッチをベースとして扱い、`pitchClass` は順序なしとして扱います。既定の `auto` は、すべての値が 0..11 にある場合にのみピッチクラスとして解釈します。

## 調の認識

`detectKey` は重み付きのピッチクラス分布から調を順位づけます。

```ts
import { detectKey, detectKeyBest } from '@libraz/libcantus';

const histogram = [2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2];

detectKey(histogram, { modes: true })[0]?.scaleName; // 'dorian'
detectKeyBest(histogram)?.mode; // 'minor'
```

`KeyMatch` は、もっとも高く評価されたスケール、それにもっとも近い長調または短調、使っているスケール形（`variant`）、`NAMED_SCALES` 上の正確な名前、そしてスコアを持ちます。`modes: true` は教会旋法を候補に加えます。指定しない場合の候補は長調と3種類の短調です。

`profile` は、観測された分布を何と相関させるかを選びます。既定は `krumhansl`、コーパスの比率を使う場合は `temperley`、重みなしの比較には `flat` を指定します。`weights` は各ピッチの重みです。`detectKeyFromNotes` は長さ × ベロシティを重みとして渡します。これはコード推定が自身のヒストグラムに使う重み付けと同じで、入力がヒストグラムではなくノートイベントの場合はこちらが適切な入り口になります。

## タイムラインと終止

`chordTimelineFromNotes` はノートイベントからコード区間と、その時点で効いている調を探します。`chordTimelineFromChords` はすでに分かっているルートと長さを受け取ります。

```ts
import { chordTimelineFromChords, chordToRoman, majorKey } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
    { rootPc: 7, quality: 'dom7', startBeat: 8 },
  ],
  12,
);

timeline.segments.length; // 3
timeline.segments.map((segment) => chordToRoman(segment.chord, majorKey(0)));
// ['I', 'IV', 'V7']
```

`chordTimelineFromNotes` はタイムライン以外も返します。`keys` は解析が対象とした調区間、`prevailingKey` はもっとも長く保たれた調、`segmentConfidence` は区間順に1つずつの信頼度です。`key` を渡さないことで、転調する曲をその時点で実際に効いている調に対して解析できます。渡した場合は区間が1つになります。呼び出し側がすでに答えを出しているためです。

`detectCadence` は2つのコードにラベルを付け、`detectCadences` はタイムライン全体を走査します。

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const key = Key.major('C').scale;
const g = Chord.of('G', 'maj').data;
const c = Chord.of('C', 'maj').data;

detectCadence(g, c, key).type; // 'authentic'
detectCadence(g, c, key).strength; // null
```

ソプラノを特定できるボイシングがない場合、`strength` は null になります。ボイシングを渡すと、正格終止が完全・不完全に分類されます。根音進行のない V の反復は終止として報告されません。

## 縮約と形式

`reduceProgression` は各コードを `structural`、`passing`、`auxiliary` に分類し、理由を付けます。

```ts
import { chordTimelineFromChords, majorKey, reduceProgression } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj7', startBeat: 0 },
    { rootPc: 1, quality: 'dim7', startBeat: 4 },
    { rootPc: 2, quality: 'min7', startBeat: 8 },
  ],
  12,
);

reduceProgression(timeline, majorKey(0)).map((entry) => entry.level);
// ['structural', 'passing', 'structural']
```

`phrasesFromTimeline` は終止、休符、反復、ハイパーメーター上の位置からフレーズ境界を提案し、各フレーズはどの信号が寄与したかを記録します。`structuralCadences` はフレーズ終止を順位づけます。`hypermeter` は小節より上の拍節構造を求め、`sectionsFromNotes` は繰り返される単位を A、B などのラベルとして識別します。A が Verse だという主張はしません。

## 転調

`keyTimelineFromNotes` と `detectModulations` は曲を調区間に分割します。各区間は信頼度を持ち、コードが支持する場合はピボットも持ちます。[調関係と転調](key-relations-and-modulation.md)を参照してください。

## 旋律の解析

`melodicContour`、`extractMotifs`、`relateMotifs`、`melodicSimilarity` は、繰り返しや変形を伴う旋律素材を扱います。[旋律とモチーフ](melody-and-motifs.md)を参照してください。

## アレンジのレポート

`analyzeArrangement` は、トラックの役割、コードタイムライン、調区間、理論ラベル、テンション、音符と現在の和声の衝突をまとめます。

```ts
import { analyzeArrangement } from '@libraz/libcantus';

const report = analyzeArrangement([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
]);

report.timeline.segments.length >= 1; // true
Array.isArray(report.conflicts); // true
```

アレンジ全体の結果が不要な場合は、`tensionCurve` と `analyzeVoice` がその一部を返します。`toVoiceNotes` は単一トラックを声部レベルの解析向けに整えます。編集をまたいで解析を保持する `createArrangementSession` については[パフォーマンス](performance.md)を参照してください。
