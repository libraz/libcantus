# リズムとグルーヴ

リズムは3つの分離した段階として扱います。発音位置を決め、それをノートイベントに変換し、最後に格子からずらします。分離しているため、ホストはパートを作り直さずにノリだけを作り直せます。

## 発音位置を生成する

`generateRhythm` は格子上に発音位置を配置します。各スロットの重みは拍節上の強さで決まります。

```ts
import { generateRhythm, parseTimeSignature, rhythmDensity } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = generateRhythm(ts, { seed: 42, density: 0.2, bars: 2 });
const dense = generateRhythm(ts, { seed: 42, density: 0.9, bars: 2 });

sparse.length <= dense.length; // true
rhythmDensity(dense, ts) >= rhythmDensity(sparse, ts); // true
```

`subdivision` は4分音符1拍あたりのステップ数で表した格子の細かさです。2は8分、4は16分、3は8分3連になります。`density` はスロットごとの確率を倍率で変え、`ctx.complexity.rhythmic` の略記です。

重みづけ自体は `onsetWeightCurve` で取得できます。拍節強度0（拍から外れた位置）から3（強拍）に対する基本確率で、独自の配置ロジックを組む場合に使います。

```ts
import { onsetWeightCurve } from '@libraz/libcantus';

onsetWeightCurve(3) > onsetWeightCurve(0); // true
```

## 発音位置からノートへ

`RhythmEvent` は位置と長さを持ちますが、ピッチを持ちません。`rhythmToNoteEvents` がそれを与えます。

```ts
import { generateRhythm, parseTimeSignature, rhythmToNoteEvents } from '@libraz/libcantus';

const rhythm = generateRhythm(parseTimeSignature('4/4'), { seed: 3, bars: 1 });
const notes = rhythmToNoteEvents(rhythm, 38);

notes.every((note) => note.pitch === 38); // true
```

この分離は意図的なものです。1つのリズムを複数のピッチで再利用でき、旋律の生成側は音そのものを借りずにリズムだけを借りられます。

## ヒューマナイズ

`humanize` はイベントを格子からずらし、拍節上の位置に応じてベロシティを整えます。返り値はコピーであるため、量子化された元データは保持されます。

```ts
import { humanize } from '@libraz/libcantus';

const quantized = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 80 },
];

const played = humanize(quantized, { seed: 1, timing: 0.03 });

played.length; // 2
quantized[0]?.startBeat; // 0
```

| オプション | 意味 |
| --- | --- |
| `timing` | 4分音符を単位とした最大の揺れ幅。±で適用。既定は 0.02。 |
| `velocity` | ベロシティの最大揺れ幅（MIDI 単位）。±で適用。既定は 8。 |
| `accent` | 強拍がどれだけ大きくなるか（MIDI 単位）。既定は 12。 |
| `baseVelocity` | ベロシティを持たないイベントに仮定する値。既定は 80。 |
| `ts` | 拍節アクセントを導く拍子。既定は 4/4。 |

長さが0以下のイベントは鳴らないため取り除かれます。結果が入力より短くなることがあります。

## グルーヴテンプレート

グルーヴテンプレートは、演奏から取り出した1小節分のタイミングとベロシティのずれの格子です。目的のノリを持つ演奏から抽出し、それを持たない素材に適用します。

```ts
import { applyGrooveTemplate, extractGrooveTemplate, parseTimeSignature } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const performed = [
  { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 100 },
  { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 70 },
];
const template = extractGrooveTemplate(performed, ts, 4);

template.subdivision; // 4
template.slotsPerBar; // 16

const stiff = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 90 },
];
const grooved = applyGrooveTemplate(stiff, template, ts);

grooved.length; // 2
```

各スロットは、そこに落ちたイベントの格子からの平均ずれと平均ベロシティを持ちます。ベロシティが `null` の場合、ベロシティを持つイベントがそこに落ちなかったことを意味し、ベロシティ0とは区別されます。この区別のためにフィールドは null 許容です。

テンプレートは抽出時の拍子を記録し、`applyGrooveTemplate` は適用時の拍子が一致することを要求します。4/4 のグルーヴを 3/4 に適用すると、1小節分の格子が異なる小節長に対応づけられ、何も報告されないままずれが蓄積するため、不一致は拒否されます。

## ドラム

`generateDrums` は単一の線ではなくキット全体のパートを生成します。語彙はスタイル・セクション・ロールの3つで決まります。

```ts
import { generateDrums } from '@libraz/libcantus';

const pattern = generateDrums({
  bars: 4,
  style: 'funk',
  section: 'chorus',
  fills: true,
  ctx: { seed: 11, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});

pattern.length > 0; // true
pattern.every((hit) => hit.durationBeat > 0); // true
```

スタイルは `standard`、`funk`、`shuffle`、`bossa`、`trap`、`halftime`、`breakbeat`、`house`、`synthpop` です。セクションは `intro`、`verse`、`prechorus`、`chorus`、`bridge`、`outro` で、形式を指定するものではなく密度とフィルを形づくります。

`fills: true` は最終小節をフィルに置き換えます。ただしコーラスへ向かうプリコーラスでは代わりに盛り上げが入ります。2小節のリフトがすでにフレーズの終わりを示しているためです。

`role` はどの声部を鳴らすかを制限します。`full` から `ambient`、`minimal`、`fxOnly` の順に薄くなります。`drumVoiceOf` は生成された打点を名前付きの声部に対応づけ、`DRUM_NOTES` は General MIDI のノート番号を返します。書き出し処理で必要になるのは後者です。

## スウィングとフィール

`feel` はドラム生成器における細分化の扱いを選びます。他の手段で生成した素材については、スウィングした演奏から抽出したグルーヴテンプレートが同じ情報を持ち、どのパートにも適用できます。

## 関連ページ

拍節強度、小節内位置、連符は[時間とアレンジ](time-and-arrangement.md)に、つまみと再現性の保証は[決定性とシード](determinism-and-seeding.md)にあります。
