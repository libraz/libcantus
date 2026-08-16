# ユースケース: 転調レポート

調の変化は、根拠に支えられた提案です。役に立つレポートは、解析がどこで調が移ったと考えているか、どれだけ強くそう考えているか、そしてどのコードがその変化を担ったかを示します。

```ts
import {
  chordTimelineFromChords,
  detectModulations,
  formatNote,
  keyRelationBetween,
  spelledKeyOf,
} from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
    { rootPc: 7, quality: 'dom7', startBeat: 8 },
    { rootPc: 0, quality: 'maj', startBeat: 12 },
    { rootPc: 9, quality: 'min', startBeat: 16 },
    { rootPc: 2, quality: 'dom7', startBeat: 20 },
    { rootPc: 7, quality: 'maj', startBeat: 24 },
    { rootPc: 4, quality: 'min', startBeat: 28 },
    { rootPc: 9, quality: 'min7', startBeat: 32 },
    { rootPc: 2, quality: 'dom7', startBeat: 36 },
    { rootPc: 7, quality: 'maj', startBeat: 40 },
  ],
  44,
);

const regions = detectModulations(timeline.segments);

const rows = regions.map((region) => ({
  from: region.startBeat,
  to: region.endBeat,
  key: formatNote(spelledKeyOf(region.key).tonic),
  confidence: Math.round(region.confidence * 100) / 100,
}));

rows.length >= 1; // true
rows[0]?.from; // 0

const relations = regions.slice(1).map((region, index) =>
  keyRelationBetween(
    { tonic: spelledKeyOf(regions[index]?.key ?? region.key).tonic, key: regions[index]?.key ?? region.key },
    { tonic: spelledKeyOf(region.key).tonic, key: region.key },
  ),
);

Array.isArray(relations); // true
```

## レポートに載せるもの

`KeyRegion` は表示する価値のある情報を4つ持ちます。

- **範囲** — `startBeat` と `endBeat`。UI は `beatToBarPosition` で小節番号に変換します。
- **調** — `spelledKeyOf` は楽譜が書くとおりの主音を返します。読み手が期待するのはピッチクラスではなくこちらです。
- **信頼度** — その区間のピッチクラス分布と調プロファイルの相関で、0..1 の値です。UI が定めた閾値を下回る区間は、非表示にせず不確実として示します。
- **ピボット** — コードが支持する場合に、境界をまたぐコードが解析によって埋められます。

`keyRelationBetween` は連続する区間どうしの関係を名指します。`dominant`、`relative`、`parallel` などで、遠い移動の場合は `null` です。「属調へ転調する」と述べるレポートは、「G へ転調する」とだけ述べるレポートより多くを伝えます。

## 感度の調整

同じオプションが `detectModulations` と `keyTimelineFromNotes` を制御します。

- `expectedKeyBeats` — 1つの調が続くと想定する長さ。既定は4小節で、下げると新しい区間をより積極的に提案します。
- `minKeyBeats` — 出力する最短の区間。既定は1小節です。短い一時的転調が転調として現れる場合に上げます。
- `ts` / `meters` — 拍子。小節線と拍節アクセントを正しく読むために使います。

一時的転調と転調の違いは種類ではなく長さです。レポートが騒がしい場合、原因はたいてい入力の欠陥ではなく感度です。この区別と、調を動かさない半音階的コードにラベルを付ける `secondaryDominant`・`borrowedSource` については[調関係と転調](../key-relations-and-modulation.md)を参照してください。

## コードではなく音符から

`keyTimelineFromNotes` はノートイベントを直接受け取ります。コードタイムラインが得られる場合は `detectModulations` を優先してください。1拍あたりの手がかりは生のピッチよりコードのほうが多く、転調を担うコードはピボットが必要とするものそのものです。

## 提示の仕方

信頼度を示し、上書きできるようにします。2つの調のあいだで意図的に揺れている曲には唯一の正解がなく、それを隠すレポートは解析のもっとも重要な部分を捨てています。
