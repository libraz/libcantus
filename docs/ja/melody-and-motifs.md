# 旋律とモチーフ

モチーフは、変形されながら繰り返される短いパターンです。このライブラリはモチーフの解析と生成を、同じ語彙を2方向から読むものとして扱います。`relateMotifs` は2つの提示のあいだの変形を名指し、`transformMotif` はその変形を適用します。

## 輪郭

`melodicContour` は線を、進行方向とその総和に還元します。

```ts
import { melodicContour } from '@libraz/libcantus';

const arch = [60, 64, 67, 64, 60].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
}));

melodicContour(arch).shape; // 'arch'
melodicContour(arch).directions; // ['up', 'up', 'down', 'down']
melodicContour(arch).peakIndex; // 2
```

形状は `arch`、`ascending`、`descending`、`wave`、`static` です。最初の4つはモチーフ生成器の `contour` オプションと同じ語彙であるため、既存の線から読み取った形状をそのまま生成器に指定できます。`static` は生成側では要求されず、解析では頻繁に現れる形状で、動かない線を指します。いったん下がって戻る線は `wave` として読まれます。共有する語彙に、逆向きのアーチを表す名前がないためです。

## 旋律の中からモチーフを見つける

```ts
import { extractMotifs } from '@libraz/libcantus';

const notes = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
  { pitch: 67, startBeat: 4, durationBeat: 1 },
  { pitch: 69, startBeat: 5, durationBeat: 1 },
  { pitch: 71, startBeat: 6, durationBeat: 1 },
];

const motifs = extractMotifs(notes);

motifs.length >= 1; // true
motifs[0]?.occurrences.length >= 2; // true
```

`Motif` は音程とリズムのパターン、および各出現とその開始位置を持ちます。上の2つのフレーズは5度離れた同じ形であるため、2つのモチーフではなく、2回出現する1つのモチーフになります。

## 2つの提示の関係を名指す

```ts
import { majorKey, motifFromNotes, relateMotifs } from '@libraz/libcantus';

const subject = motifFromNotes([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
]);
const answer = motifFromNotes([
  { pitch: 67, startBeat: 3, durationBeat: 1 },
  { pitch: 69, startBeat: 4, durationBeat: 1 },
  { pitch: 71, startBeat: 5, durationBeat: 1 },
]);

relateMotifs(subject, answer)?.kind; // 'transposition'
relateMotifs(subject, answer, majorKey(0))?.kind; // 'transposition'
```

種類は `repetition`、`transposition`、`tonalTransposition`、`inversion`、`retrograde`、`retrogradeInversion`、`augmentation`、`diminution` です。調を渡すと、音程を厳密に保つ移高と、音度を保つ `tonalTransposition` を区別できます。

関係には、2つ目の提示が1つ目の終わりから始まるかどうかも記録されます。これが、ゼクエンツと曲中の別の箇所での再提示を分ける情報になります。

`compareMelodies` と `melodicSimilarity` は、名前の付く変形が当てはまらない場合に、2つのフレーズがどれだけ似ているかというより緩い問いに答えます。

## モチーフを生成する

```ts
import { generateMotif, majorKey, motifToNoteEvents } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', seed: 1 });
const notes = motifToNoteEvents(cell);

notes.length >= 1; // true
notes.every((note) => note.durationBeat > 0); // true
```

`generateMotif` が返すのはノートイベントではなく `MotifCell` です。両者を分けているのは、セルが素材であり、ノートイベントが配置であるためです。同じセルを変形し、ゼクエンツにしてから配置でき、`motifToNoteEvents` は最初ではなく最後の段階になります。

`chord` は調に加えてコードにもモチーフを制約します。`contour` は形状を選びます。結果はシードに対して決定的で、シードの既定値は0です。

## 変形と展開

```ts
import { generateMotif, majorKey, transformMotif } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 1, seed: 2 });
const inverted = transformMotif(cell, 'invert');
const retrograde = transformMotif(cell, 'retrograde');

inverted.notes.length; // cell.notes.length
retrograde.notes.length; // cell.notes.length
```

変形は `transposeDiatonic`、`transposeChromatic`、`invert`、`retrograde`、`augment`、`diminish`、`sequence` です。`relateMotifs` が報告する一覧と同じであり、ホストが両者を往復できるようになっています。

`developMotif` はコードタイムライン全体に対して変形を適用するため、展開された素材は和声の上で繰り返すのではなく、和声に沿います。

```ts
import { chordTimelineFromChords, developMotif, generateMotif, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
  ],
  8,
);

const developed = developMotif(generateMotif({ key, bars: 1, seed: 3 }), timeline, key, 2);

developed.notes.length >= 1; // true
```

セルは要求された長さを埋めるように連続して並べられ、各音は発音位置で鳴っているセグメントのもっとも近いコード構成音へ引き寄せられます。その結果、展開された線が背後の和声を綴ります。`developMotif` は他のモチーフ操作と同様に `MotifCell` を返すため、配置が必要な段階で `motifToNoteEvents` を呼びます。

## 対旋律と模倣

`imitate` は、指定した音程と遅れで線を再提示します。カノン的な応答にあたります。

```ts
import { imitate, majorKey } from '@libraz/libcantus';

const lead = [0, 1, 2].map((beat) => ({ pitch: 60 + beat, startBeat: beat, durationBeat: 1 }));
const answer = imitate(lead, { atBeat: 2, interval: 'P5', key: majorKey(0) });

answer.length; // 3
answer[0]?.startBeat; // 2
```

`generateCounterMelody` は、メロディとその和声に対して自由な第2声部を書きます。

```ts
import { generateCounterMelody, majorKey, parseChordSymbol } from '@libraz/libcantus';

const melody = [
  { pitch: 72, startBeat: 0, durationBeat: 2 },
  { pitch: 71, startBeat: 2, durationBeat: 2 },
];

const counter = generateCounterMelody({
  melody,
  chordAt: () => parseChordSymbol('C'),
  key: majorKey(0),
  ctx: 5,
});

counter.length >= 1; // true
```

`chordAt` はタイムラインではなくコールバックです。ホストが手元にあるデータからそのまま答えられるようにするためです。結果が第2声部として機能しているかは、[対位法と和声課題](counterpoint-and-part-writing.md)の `voiceIndependence` で確認できます。

## 装飾

装飾は既存の素材に対する独立したパスであるため、装飾のオプションを変えても元の線は再生成されません。

```ts
import { ornament, ORNAMENT_STYLES } from '@libraz/libcantus';

ORNAMENT_STYLES; // ['ghost', 'flam', 'drag', 'slide', 'accent']

const line = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(line, { style: 'ghost', amount: 0.6, seed: 4 }).length; // 8
```

`ghost` は弱い位置の音を弱め、`accent` は強い位置の音を持ち上げ、`flam`・`drag`・`slide` は対応するアーティキュレーションを付けます。`amount` は影響を受ける音の割合を調整します。選択はシードに基づくため、同じオプションからは同じ結果が得られます。
