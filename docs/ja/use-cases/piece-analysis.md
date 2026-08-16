# ユースケース: 楽曲を読む

`Score` は音符と、それを読むための文脈をまとめて保持する値で、以下の問いはいずれもそのメソッドです。まずタイムラインを作ります。縮約、終止、フレーズ、形式の解析はいずれも、そこで決まる和声の単位を基準に動きます。

```ts
import { Score } from '@libraz/libcantus';

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
const score = Score.of(
  bars.flatMap((pitches, bar) =>
    pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
  ),
);

const timeline = score.timeline();

score.key()?.toString(); // 'C major'
timeline.roman().map((entry) => entry.roman); // ['I', 'IV', 'V', 'I', 'IV', 'V', 'I']
timeline.cadences().map((hit) => [hit.atBeat, hit.cadence.type]);
// [[8, 'half'], [12, 'authentic'], [24, 'half'], [28, 'authentic']]

const reduction = timeline.reduce();
const phrases = score.phrases();
const sections = score.sections({ unitBars: 4 });
const motifs = score.filter((note) => note.pitch >= 60).motifs();

reduction.length === timeline.length; // true
phrases.length >= 1; // true
sections.length >= 1; // true
motifs.length >= 1; // true
```

8小節に対して度数は7つです。4小節目と5小節目にまたがって保持されるトニックが1つの区間になるためで、タイムラインは小節線ではなく和声に沿って区切ります。タイムラインは自身の調区間も保持するので、`reduce` と `cadences` は各コードを実際に鳴っている調で読みます。呼び出しのあいだで値を手渡す必要はありません。

## 各層が答えること

`reduce` は各コードを `structural`、`passing`、`neighbor` に分類し、その理由と、そのコードが鳴る拍の範囲を記録します。聴き手が骨格として捉える和声と、それをつなぐコードを分ける層です。

`cadences` は各到達点を、着地する拍とともに報告します。コードの対だけでは持てず、時間を持つ読みだけが持てる情報です。

`phrases` は終止、休符、反復、ハイパーメーター上の位置を組み合わせ、各フレーズはどの信号が寄与したかを記録します。信号を提示することで、ユーザーは境界を受け入れるのではなく判断できます。終止はスコア自身の和声から読まれるため、コードタイムラインを組み立てて渡す必要はありません。

`sections` は繰り返される単位を識別し、A、B のようにラベルを付けます。A が Verse だという主張はしません。それは曲についての判断であって、音符の性質ではありません。

`motifs` は上の3つとは別の問いに答えます。どの短い旋律パターンが繰り返され、どう変形されているかです。全テクスチャではなく旋律の線から読ませてください。`Score.filter` は拍子・テンポ・調を保ったまま、スコアをその線に絞り込みます。2つの提示を `Motif.fromNotes` で包めば、`relateTo` がそのあいだの変形を名指します。

`hypermeter` と `contour` も同じスコアのメソッドで、小節単位の脈と旋律が描く形を返します。

## 入力を整える

拍子が分かっている場合はスコアに渡してください。`Score.of(notes, { meters })` としておけば、以降のメソッドはすべてそれに対して読みます。小節内位置とハイパーメーターはいずれも拍子から決まります。誤った拍子で走らせた解析は、もっともらしく見える誤りを生みます。

転調する曲では、全体に1つの調が効いていると仮定せず `timeline.keys` を読みます。`score.key()` は調号に印字する調であって、各小節を解析する調ではありません。[転調レポート](modulation-report.md)を参照してください。

## 提示の仕方

すべての結果は解析の補助として扱います。フレーズとセクションの境界は観測可能な信号からの提案なので、UI は寄与した信号を示し、編集できるようにします。縮約のレベルと終止の種類にはどちらも理由が付きます。演奏者や書き手にとってラベルを有用にするのはその理由なので、あわせて表示してください。
