# 時間とアレンジ

## 拍子と位置

時間を扱う解析は `{ startBeat, ts }` の `MeterMap` を受け取ります。単一の `TimeSignature` は要素一つのマップの省略形です。拍 0 は小節頭、負の拍は弱起です。

```ts
import { formatBarPosition, metricWeight, parseTimeSignature } from '@libraz/libcantus';

const meters = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 8, ts: parseTimeSignature('3/4') },
];
metricWeight(11, meters); // 3
metricWeight(12, meters); // 1
formatBarPosition(-1, parseTimeSignature('4/4')); // '0.4'
```

複合・加算拍子、連符、小節位置、パルス、小節頭も扱います。単一拍子かマップかを吸収するには `resolveMeters` を使います。

## テンポと音価

`TempoMap` は区分定数で、変化をまたいで積分されます。音価ヘルパーは秒・tick と記譜向けの表現を返します。

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6
beatsToDuration(1 / 3); // 3連の8分音符
beatsToTiedDurations(5); // 全音符と4分音符のタイ
```

## アレンジ解析

アレンジは役割とノートを持つトラックの集合です。`analyzeArrangement` はタイムライン、キー領域、トラック別解析、緊張、和声との衝突を返します。

```ts
import { analyzeArrangement } from '@libraz/libcantus';

const report = analyzeArrangement([{ role: 'harmony', notes: [
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 64, startBeat: 0, durationBeat: 4 },
  { pitch: 67, startBeat: 0, durationBeat: 4 },
] }]);
report.timeline.segments;
report.conflicts;
```

繰り返し編集するホストには `createArrangementSession` が使えます。信頼できる範囲だけ更新し、必要なら完全解析へ戻るため、前回の結果も undo 用に保持します。

`phrasesFromTimeline`、`hypermeter`、`sectionsFromNotes` も同じ拍モデルでフレーズとセクションを探します。
