# 時間とアレンジ

## 拍子と位置

`Meter` は1つの拍子記号と、それがアクセントを置く位置を表します。

```ts
import { Meter } from '@libraz/libcantus';

const fourFour = Meter.parse('4/4');

fourFour.weightAt(0); // 3
fourFour.weightAt(2); // 2
fourFour.isStrongBeat(1); // false
fourFour.formatPosition(-1); // '0.4'
```

拍子が変わる曲は `MeterMap`（`{ startBeat, ts }` の変化の配列）で表します。時間に依存する解析が受け取るのはこれです。`TimeSignature` を1つ渡すと、要素1つのマップの略記になります。拍0が強拍で、アウフタクトは負の拍から始められます。`Score` は自身のマップを持ち、位置はそれを通して読みます。

```ts
import { Meter, Score } from '@libraz/libcantus';

const score = Score.empty({
  meters: [
    { startBeat: 0, ts: Meter.parse('4/4').data },
    { startBeat: 8, ts: Meter.parse('3/4').data },
  ],
});

score.meterAt(11).numerator; // 3
score.barAt(11).bar; // 3
```

関数は同じマップを直接読みます。

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

`resolveMeters` は単一の拍子とマップのどちらも受け取ります。両方を受け付ける入り口はすべてこの関数を使って書かれています。絶対拍と小節内位置の変換は、`meterAt`、`barIndexAt`、`barStartBeat`、`beatsPerBarAt`、`beatToBarPosition`、`barPositionToBeat` が扱います。単一の拍子で足りるものは `Meter` が `weightAt`、`isStrongBeat`、`barPositionAt`、`formatPosition` として、マップを見るものは `Score` が `meterAt` と `barAt` として公開しています。

小節番号には起点が 2 通りあり、数値を求めたか文字列を求めたかで変わります。数値を返す変換は 0 起点です。`barIndexAt`、`beatToBarPosition`、`Meter.barPositionAt`、`Score.barAt` はいずれも最初の完全な小節を 0 と数えます。だからこそピックアップ小節が -1 になり、小節の算術がそこを通り抜けられます。整形する側は 1 起点で、印刷された楽譜の数え方に合わせています。`formatBarPosition` と `Meter.formatPosition` は同じ最初の小節を `1.1` と表示し、ピックアップを 0 小節目として表示します。したがって `barAt` の数値をそのまま表示する UI は、ライブラリが印字する位置より 1 小さい番号を見せることになります。表示する前に 1 を足すか、自前で番号を振らずに `formatBarPosition` に拍を渡してください。

## 複合拍子・加算拍子・連符

小節が何でできているかは `Meter` が答えます。

```ts
import { Meter } from '@libraz/libcantus';

const sixEight = Meter.parse('6/8');

sixEight.isCompound; // true
sixEight.beatsPerBar; // 3
sixEight.pulsesPerBar; // 2

Meter.of(9, 8, [3, 3, 3]).pulsesPerBar; // 3
Meter.of(9, 8, [2, 2, 2, 3]).pulsesPerBar; // 9

Meter.of(7, 8, [2, 2, 3]).format({ grouping: true }); // '2+2+3/8'
sixEight.tuplet(1, 3); // [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]
```

同じ読みを、プレーンな拍子記号に対する関数として書くとこうなります。

```ts
import { beatsPerBar, isCompound, parseTimeSignature, pulsesPerBar, tuplet } from '@libraz/libcantus';

const sixEight = parseTimeSignature('6/8');

isCompound(sixEight); // true
beatsPerBar(sixEight); // 3
pulsesPerBar(sixEight); // 2

const compoundNine = { numerator: 9, denominator: 8, grouping: [3, 3, 3] };
const aksakNine = { numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] };

pulsesPerBar(compoundNine); // 3
pulsesPerBar(aksakNine); // 9

tuplet(1, 3); // [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]
```

複合拍子は8分音符を付点のパルスにまとめるため、6/8 はパルス2つ、4分音符換算で3拍になります。`grouping` は小節を felt beat（体感上の拍）に分けます。7/8 なら `[2, 2, 3]`、5/8 なら `[3, 2]` です。各要素はメインパルスの個数を数えますが、複合分子で両者が食い違う場合は分母単位の個数を数えます。

複合分子では、グルーピングの形がどちらの読みかを決めます。すべての要素が 3 のグルーピングは複合拍子の分割そのものを綴ったものなので、9/8 の `[3, 3, 3]` は付点4分音符 3 パルスという通常の読みになります。これは `[1, 1, 1]` やグルーピング無指定とまったく同じです。要素に 3 以外を含み、総和が分子と等しいグルーピングは単位を数えているとみなされ、加算的に読まれます。9/8 の `[2, 2, 2, 3]` は8分音符 9 パルスをアクサク拍子の書き方でまとめたものです。

`metricWeight`（クラス側では `Meter.weightAt`）は各グループの頭にアクセントを置くので、7/8 の `[2, 2, 3]` は 7 つの等しい拍ではなく 3 拍として感じられます。すべてのグループが同じ長さのグルーピングは、その拍子がすでに持っている分割を述べているだけなので、アクセントは何も増えません。`formatTimeSignature(ts, { grouping: true })` は加算形 `'2+2+3/8'` を書き出し、`parseTimeSignature` がそれを読み戻します。パルス数で数えたグルーピングには加算形の綴りが無いため、平文の `'9/8'` にフォールバックします。これは同じ小節を表します。

`tuplet` は範囲を等分します。これは連符の配置側で、記譜側 — 描画エンジンが印字する `{ actual, normal }` の比 — は `beatsToDuration` から得られます。

## テンポと音価

`Tempo` は1つのテンポ表示と、それによって決まる変換です。`Duration` は記譜上の音価1つと、それが持続する拍数です。

```ts
import { Duration, Tempo } from '@libraz/libcantus';

const tempo = Tempo.of(120);

tempo.secondsAt(8); // 4
tempo.ticksAt(2, 480); // 960

Duration.ofBeats(1 / 3).toString(); // 'eighth 3:2'
Duration.tieChain(5).map((value) => value.toString()); // ['whole', 'quarter']
Duration.of('quarter', 1).beats(); // 1.5
```

1つの表示は次の表示まで保たれるので、`Tempo` は定数1つです。テンポが変わる曲は `TempoMap` で表します。こちらは区分定数で、変化をまたいで積分され、関数が直接読むか、`Score` が自身の持つマップに対して `secondsAt` で読みます。音価のヘルパーは、秒やティックだけでなく記譜向けの値も返します。

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6
beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
```

`beatsToDuration` は単一の音価で表せる場合にそれを返し、`beatsToTiedDurations` はタイが必要な長さを分割します。クラス側の対応は `Duration.ofBeats` と `Duration.tieChain` です。`durationToBeats` は逆変換で、`NOTE_VALUES` が基本の音価を列挙します。`beatsToTicks` と `ticksToBeats` は同じ拍の値を PPQ の格子に載せます。拍子が変わる場合でも全体に対する剰余は仮定しません。

## アレンジの解析

アレンジは、役割とノートイベントを持つトラックの集合です。`Arrangement` はそれらを、互いにどう噛み合っているかの解析とともに保持します。返せるクラスがある場合はクラスで返し、`timeline()` は `Timeline` を、`track(name)` は `Score` を返します。

```ts
import { Arrangement } from '@libraz/libcantus';

const arrangement = Arrangement.of([
  {
    name: 'keys',
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
  {
    name: 'bass',
    role: 'bass',
    notes: [{ pitch: 36, startBeat: 0, durationBeat: 4 }],
  },
]);

arrangement.tracks.length; // 2
arrangement.timeline().at(0)?.symbol(); // 'C'
arrangement.track('bass')?.totalBeats; // 4
```

解析そのものを単体で行うのが `analyzeArrangement` です。返すのは、推定された `timeline`、それを読む基準となった `keys` と `prevailingKey`、`cadences`、トラックごとの解析、そして音符と現在の和声の衝突である `conflicts` です。

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

トラックの `role` は、レポートへそのまま引き継がれるラベルであって、解析を切り替えるスイッチではありません。推定内容を変えるのは `drums` だけです。そのピッチは和声を表さず楽器を選ぶものなので、打楽器トラックはコード推定・調推定からも、声部進行の比較からも除外されます。`melody`・`harmony`・`bass`・`other` はまったく同じように扱われ、和声は音程を持つ全トラックをまとめたものから推定されます。役割が付いていない場合や、あるトラックが和声を重ねている場合でも、この方法なら破綻しません。ラベルの無いトラックは推測せず `other` として報告されます。

コードをどのトラックから取るかを指定するのが `harmonyTracks` です。和声を担うトラックのインデックスを渡すと、残りの音程トラックは和声に寄与せず、その和声に対して解析されます。この設定の書き方はクラス側も関数側も同じです。

```ts
import { type ArrangementTrack, Arrangement, analyzeArrangement } from '@libraz/libcantus';

const tracks: ArrangementTrack[] = [
  { role: 'melody', notes: [{ pitch: 70, startBeat: 0, durationBeat: 4 }] },
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
];

// Pooled, the melody's Bb reads as the seventh of the chord under it.
Arrangement.of(tracks).timeline().at(0)?.symbol(); // 'C7'
Arrangement.of(tracks, { harmonyTracks: [1] }).timeline().at(0)?.symbol(); // 'C'

analyzeArrangement(tracks).timeline.segments[0]?.chord.quality; // 'dom7'
analyzeArrangement(tracks, { harmonyTracks: [1] }).timeline.segments[0]?.chord.quality; // 'maj'
```

`conflicts` は、下で鳴っている和声と食い違う音符を報告します。アレンジの警告パネルが表示するのはこの情報です。`Arrangement` ではプロパティ、レポートではフィールドとして得られます。`tensionCurve` と `tensionCurveFrom` は、レポートを時間軸上の曲線にまとめます。`Arrangement.tension` も同じことをします。

## 編集セッション

`Arrangement.update` は1つ以上のトラックの音符を差し替え、新しいアレンジを返します。解析を一からやり直すわけではなく、編集が影響し得る範囲だけを再計算し、差分の結果が信頼できない場合は全体の解析に切り替えます。呼び出したアレンジ自体は変わりません。アンドゥスタックが必要とするのはこの性質です。

```ts
import { Arrangement } from '@libraz/libcantus';

const arrangement = Arrangement.of([
  { name: 'lead', notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] },
]);

const edited = arrangement.update([
  { trackIndex: 0, notes: [{ pitch: 62, startBeat: 0, durationBeat: 4 }] },
]);

edited.tracks[0]?.notes[0]?.pitch; // 62
arrangement.tracks[0]?.notes[0]?.pitch; // 60
```

同じ仕組みを、ホスト自身が持つハンドルとして公開したものが `createArrangementSession` です。`update` は新しいセッションを返し、前のセッションはそのまま有効です。[パフォーマンス](performance.md)を参照してください。

## 時間に関わる形式と旋律

`phrasesFromTimeline`、`hypermeter`、`sectionsFromNotes` は同じ拍のモデルを使ってフレーズとセクションを求めます。`Score` からは `phrases()`、`hypermeter()`、`sections()` として、すでに持っている拍子マップに対して呼び出せます。`harmonizeMelody` はコードを選ぶ前に経過音と刺繍音を分類するため、非和声音1つが和声全体を決めてしまうことはありません。

拍子マップが分かっている場合は必ず渡してください。小節内位置、ハイパーメーター、拍節強度はいずれもそこから決まります。誤った拍子で走らせた解析は、もっともらしい形で誤った結果になります。
