# ユースケース: 転調レポート

調の変化は、根拠に支えられた提案です。役に立つレポートは、解析がどこで調が移ったと考えているか、どれだけ強くそう考えているか、そしてどのコードがその変化を担ったかを示します。

```ts
import { Chord, detectModulations, Key, Timeline } from '@libraz/libcantus';

// Eleven bars typed as a chord chart: four in C, then a turn towards G.
const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];

const timeline = Timeline.fromChords(
  chart.map((symbol, bar) => Chord.parse(symbol).span(bar * 4)),
  chart.length * 4,
);

// A timeline built from stated chords holds the chords and nothing more, so
// the key search over them is the one step with no method of its own:
const regions = detectModulations(timeline.segments);

const rows = regions.map((region) => ({
  from: region.startBeat,
  to: region.endBeat,
  key: Key.of(region.key).toString(),
  confidence: Math.round(region.confidence * 100) / 100,
}));

rows.length; // 2
rows[0]?.from; // 0
rows.map((row) => row.key); // ['C major', 'G major']
```

区間は素のデータである `KeyRegion` です。`Key.of` はそれを再び値に戻し、直前の区間との関係を含めて問いに答えられるようにします。

```ts
import { Chord, detectModulations, Key, Timeline } from '@libraz/libcantus';

const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];
const timeline = Timeline.fromChords(
  chart.map((symbol, bar) => Chord.parse(symbol).span(bar * 4)),
  chart.length * 4,
);

const keys = detectModulations(timeline.segments).map((region) => Key.of(region.key));

keys.slice(1).map((key, index) => keys[index]?.relationTo(key) ?? null); // ['dominant']
keys[1]?.tonic.name; // 'G'
keys[1]?.fifths; // 1
```

## レポートに載せるもの

`KeyRegion` は表示する価値のある情報を4つ持ちます。

- **範囲** — `startBeat` と `endBeat`。UI は `Score.barAt` で小節番号に変換します。
- **調** — `Key.of(region.key)` は楽譜が書くとおりに主音を綴ります。読み手が期待するのはピッチクラスではなくこちらで、併記する調号は `fifths` が返します。
- **信頼度** — その区間のピッチクラス分布と調プロファイルの相関で、0..1 の値です。UI が定めた閾値を下回る区間は、非表示にせず不確実として示します。
- **ピボット** — コードが支持する場合に、境界をまたぐコードが解析によって埋められます。

`relationTo` は連続する区間どうしの関係を名指します。`dominant`、`relative`、`parallel` などで、遠い移動の場合は `null` です。「属調へ転調する」と述べるレポートは、「G へ転調する」とだけ述べるレポートより多くを伝えます。

## 感度の調整

同じオプションが `detectModulations` と `Score.keys` を制御します。

- `expectedKeyBeats` — 1つの調が続くと想定する長さ。既定は4小節で、下げると新しい区間をより積極的に提案します。
- `minKeyBeats` — 出力する最短の区間。既定は1小節です。短い一時的転調が転調として現れる場合に上げます。
- `ts` / `meters` — 拍子。小節線と拍節アクセントを正しく読むために使います。`Score` は自身の拍子マップを下位へ渡すので、指定が要るのは素の関数を直接呼ぶ場合だけです。

一時的転調と転調の違いは種類ではなく長さです。レポートが騒がしい場合、原因はたいてい入力の欠陥ではなく感度です。この区別と、調を動かさない半音階的コードにラベルを付ける `secondaryDominant`・`borrowedSource` については[調関係と転調](../key-relations-and-modulation.md)を参照してください。

## コードではなく音符から

入力が鳴っている音符の場合、手で配線するものは何もありません。`Score` は自身の和声を読み、返されるタイムラインは解析が見つけた調区間をピボットごと保持しています。

```ts
import { Chord, Score } from '@libraz/libcantus';

const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];
const notes = chart.flatMap((symbol, bar) =>
  Chord.parse(symbol)
    .voice()
    .map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const regions = Score.of(notes).timeline().keys;

regions.length >= 1; // true
regions[0]?.startBeat; // 0
```

コードがすでに分かっている場合は、推定したコードタイムラインより `detectModulations` を優先してください。1拍あたりの手がかりは生のピッチよりコードのほうが多く、転調を担うコードはピボットが必要とするものそのものです。コードとして読ませたくない場合は、`Score.keys` が音符だけから同じ問いに答えます。

## 提示の仕方

信頼度を示し、上書きできるようにします。2つの調のあいだで意図的に揺れている曲には唯一の正解がなく、それを隠すレポートは解析のもっとも重要な部分を捨てています。
