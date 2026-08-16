# ユースケース: 楽曲を読む

まずタイムラインを作ります。縮約、終止、フレーズ、形式の解析はいずれも、そこで決まる和声の単位を基準に動きます。

```ts
import {
  chordTimelineFromNotes,
  extractMotifs,
  phrasesFromTimeline,
  reduceProgression,
  sectionsFromNotes,
} from '@libraz/libcantus';

const bars = [
  [48, 60, 64, 67],
  [41, 60, 65, 69],
  [43, 59, 62, 67],
  [48, 60, 64, 67],
  [48, 60, 64, 67],
  [41, 60, 65, 69],
  [43, 59, 62, 67],
  [48, 60, 64, 67],
];
const notes = bars.flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey } = chordTimelineFromNotes(notes);
const reduction = reduceProgression(timeline, prevailingKey);
const phrases = phrasesFromTimeline(timeline, notes);
const sections = sectionsFromNotes(notes, { unitBars: 4 });
const motifs = extractMotifs(notes.filter((note) => note.pitch >= 60));

reduction.length === timeline.segments.length; // true
phrases.length >= 1; // true
sections.length >= 1; // true
Array.isArray(motifs); // true
```

## 各層が答えること

`reduction` は各コードを `structural`、`passing`、`auxiliary` に分類し、その理由を記録します。聴き手が骨格として捉える和声と、それをつなぐコードを分ける層です。

`phrases` は終止、休符、反復、ハイパーメーター上の位置を組み合わせ、各フレーズはどの信号が寄与したかを記録します。信号を提示することで、ユーザーは境界を受け入れるのではなく判断できます。

`sections` は繰り返される単位を識別し、A、B のようにラベルを付けます。A が Verse だという主張はしません。それは曲についての判断であって、音符の性質ではありません。

`extractMotifs` は上の3つとは別の問いに答えます。どの短い旋律パターンが繰り返され、どう変形されているかです。全テクスチャではなく旋律の線を渡してください。`relateMotifs` は2つの提示のあいだの変形を名指します。

## 入力を整える

拍子マップが分かっている場合は渡してください。小節内位置とハイパーメーターはいずれもそこから決まります。誤った拍子で走らせた解析は、もっともらしく見える誤りを生みます。

転調する曲では、`prevailingKey` が全体に効いていると仮定せず、タイムラインの結果の `keys` を読みます。[転調レポート](modulation-report.md)を参照してください。

## 提示の仕方

すべての結果は解析の補助として扱います。フレーズとセクションの境界は観測可能な信号からの提案なので、UI は寄与した信号を示し、編集できるようにします。縮約のレベルと終止の種類にはどちらも理由が付きます。演奏者や書き手にとってラベルを有用にするのはその理由なので、あわせて表示してください。
