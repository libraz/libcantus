# 時間とアレンジ

## 拍子と位置

時間に依存する解析は `MeterMap`（`{ startBeat, ts }` の変化の配列）を受け取ります。`TimeSignature` を1つ渡すと、要素1つのマップの略記になります。拍0が強拍で、アウフタクトは負の拍から始められます。

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

拍節強度は0（拍から外れた位置）から3（強拍）までで、発音位置の配置、アクセントの整形、フレーズ検出の基礎になります。拍子の変化は効力を持つ拍から反映されるため、曲が冒頭の拍子のまま読まれることはありません。

`resolveMeters` は単一の拍子とマップのどちらも受け取ります。両方を受け付ける入り口はすべてこの関数を使って書かれています。絶対拍と小節内位置の変換は、`meterAt`、`barIndexAt`、`barStartBeat`、`beatsPerBarAt`、`beatToBarPosition`、`barPositionToBeat` が扱います。

## 複合拍子・加算拍子・連符

```ts
import { beatsPerBar, isCompound, parseTimeSignature, pulsesPerBar, tuplet } from '@libraz/libcantus';

const sixEight = parseTimeSignature('6/8');

isCompound(sixEight); // true
beatsPerBar(sixEight); // 3
pulsesPerBar(sixEight); // 2

tuplet(1, 3); // [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]
```

複合拍子は8分音符を付点のパルスにまとめるため、6/8 はパルス2つ、4分音符換算で3拍になります。加算拍子は `grouping` を持ちます。7/8 は `[2, 2, 3]`、9/8 はパルスとしての `[3, 3, 3]` と単位としての `[2, 2, 2, 3]` のどちらでも表せます。後者はアクサクの拍子の書き方です。

`tuplet` は範囲を等分します。これは連符の配置側で、記譜側 — 描画エンジンが印字する `{ actual, normal }` の比 — は `beatsToDuration` から得られます。

## テンポと音価

`TempoMap` は区分定数で、変化をまたいで積分されます。音価のヘルパーは、秒やティックだけでなく記譜向けの値も返します。

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6
beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
```

`beatsToDuration` は単一の音価で表せる場合にそれを返し、`beatsToTiedDurations` はタイが必要な長さを分割します。`durationToBeats` は逆変換で、`NOTE_VALUES` が基本の音価を列挙します。`beatsToTicks` と `ticksToBeats` は同じ拍の値を PPQ の格子に載せます。拍子が変わる場合でも全体に対する剰余は仮定しません。

## アレンジの解析

アレンジは、役割とノートイベントを持つトラックの集合です。`analyzeArrangement` は、推定されたタイムライン、調区間、トラックごとの解析、テンション、音符と現在の和声の衝突を返します。

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
  {
    role: 'bass',
    notes: [{ pitch: 36, startBeat: 0, durationBeat: 4 }],
  },
]);

report.tracks.length; // 2
report.timeline.segments.length >= 1; // true
```

トラックの `role` は、そのトラックがどう関与するかを示します。harmony トラックはコード推定に寄与し、bass トラックは転回形を決めるベースを供給し、melody トラックは和声に寄与せず和声に対して解析されます。ホストが役割を把握していない場合は、`roleOf` がトラック自身の素材から推定します。

`conflicts` は、下で鳴っている和声と食い違う音符を報告します。アレンジの警告パネルが表示するのはこの情報です。`tensionCurve` と `tensionCurveFrom` は、レポートを時間軸上の曲線にまとめます。

## 編集セッション

`createArrangementSession` は、ホストがトラックを編集するあいだ解析を保持します。`update` は新しいセッションを返し、編集が影響し得る範囲だけを再解析します。差分の結果が信頼できない場合は全体の解析に切り替えます。前のセッションはそのまま有効で、アンドゥスタックが必要とするのはこの性質です。[パフォーマンス](performance.md)を参照してください。

## 時間に関わる形式と旋律

`phrasesFromTimeline`、`hypermeter`、`sectionsFromNotes` は同じ拍のモデルを使ってフレーズとセクションを求めます。`harmonizeMelody` はコードを選ぶ前に経過音と刺繍音を分類するため、非和声音1つが和声全体を決めてしまうことはありません。

拍子マップが分かっている場合は必ず渡してください。小節内位置、ハイパーメーター、拍節強度はいずれもそこから決まります。誤った拍子で走らせた解析は、もっともらしい形で誤った結果になります。
