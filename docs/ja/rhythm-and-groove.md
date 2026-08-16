# リズムとグルーヴ

リズムは3つの分離した段階として扱います。発音位置を決め、それをノートイベントに変換し、最後に格子からずらします。分離しているため、ホストはパートを作り直さずにノリだけを作り直せます。

## 発音位置を生成する

`generateRhythm` は格子上に発音位置を配置します。各スロットの重みは拍節上の強さで決まります。

```ts
import { generateRhythm, parseTimeSignature, rhythmDensity } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.2 } }, bars: 2 });
const dense = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.9 } }, bars: 2 });

sparse.length <= dense.length; // true
rhythmDensity(dense, ts) >= rhythmDensity(sparse, ts); // true
```

`subdivision` は4分音符1拍あたりのステップ数で表した格子の細かさです。2は8分、4は16分、3は8分3連になります。スロットごとの確率を倍率で変えるのは `ctx.complexity.rhythmic` で、既定値は0.5、[0, 1] を外れた値は丸めずに拒否します。

重みづけ自体は `onsetWeightCurve` で取得できます。拍節強度0（拍から外れた位置）から3（強拍）に対する基本確率で、独自の配置ロジックを組む場合に使います。

```ts
import { onsetWeightCurve } from '@libraz/libcantus';

onsetWeightCurve(3) > onsetWeightCurve(0); // true
```

## 発音位置からノートへ

`RhythmEvent` は位置と長さを持ちますが、ピッチを持ちません。`rhythmToNoteEvents` がそれを与えます。

```ts
import { generateRhythm, parseTimeSignature, rhythmToNoteEvents } from '@libraz/libcantus';

const rhythm = generateRhythm(parseTimeSignature('4/4'), { ctx: { seed: 3 }, bars: 1 });
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

const played = humanize(quantized, { ctx: { seed: 1 }, timing: 0.03 });

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

グルーヴはバックビート、ハイハットの細分、オープンハットとクラッシュの拍、フィルの開始拍まですべて4拍の小節を前提に書かれています。そのため `ts` は 4/4 のみを受け付け、それ以外の拍子は、長さの違う小節の中に 4/4 のアクセントを置いた結果を返すのではなく拒否します。他の拍子で書くには `generateRhythm` と `placeDrumPattern` を使ってください。

`fills: true` は最終小節をフィルに置き換えます。ただしコーラスへ向かうプリコーラスでは代わりに盛り上げが入ります。2小節のリフトがすでにフレーズの終わりを示しているためです。

`role` はどの声部を鳴らすかを制限します。`full` から `ambient`、`minimal`、`fxOnly` の順に薄くなります。`drumVoiceOf` は生成された打点を名前付きの声部に対応づけ、`DRUM_NOTES` は General MIDI のノート番号を返します。書き出し処理で必要になるのは後者です。

## ジャンル語彙

`generateDrums` は生成器に組み込まれたスタイル表からキットのパートを書きます。同じ `DrumHit[]` に至るもう1つの経路が `placeDrumPattern` です。こちらはジャンル辞書から図形を引きます。辞書の各エントリはコードではなくデータです。

```ts
import { DRUM_PATTERNS, GENRES, placeDrumPattern } from '@libraz/libcantus';

const hits = placeDrumPattern({
  bars: 2,
  genre: 'bossa',
  section: 'verse',
  ctx: { seed: 7, bpm: 130, complexity: { rhythmic: 0.6, ornament: 0.3, difficulty: 3 } },
});

hits.every((hit) => hit.durationBeat > 0); // true
DRUM_PATTERNS.every((entry) => GENRES.includes(entry.genre)); // true
```

3つのつまみは互いに干渉しません。担当する段階が異なるためです。ジャンルはどの図形を候補にするかを選び、複雑度のつまみは選ばれた図形を変形し、難易度の上限は最短の打点間隔がその上限の奏者に維持できない図形を却下します。却下された図形は簡略化されるのではなく候補から外れます。簡略化された図形は別の図形だからです。

`GENRES` は内蔵エントリが持つジャンルの一覧で、`pop` や `motown` から `bossa`、`dnb` までを含みます。`DRUM_PATTERNS` は辞書そのもので、凍結されています。各エントリは、ジャンル、1から5の難易度、適するセクションとテンポ帯、書かれている拍子、キットに要求するアーティキュレーション、そして公開の根拠となる出自を持ちます。出自として認めるのはジャンルの共有財産であり、特定の録音のフレーズは含めません。

### 独自の図形を持ち込む

ジャンルの一覧は型としては閉じていますが、考え方としては開いています。ライブラリが持たない素材は、呼び出し側が生成コンテキストを通してエントリを渡します。内蔵と同じ `id` を持つエントリは、その内蔵と競合するのではなく置き換えます。

```ts
import { type DrumVocabulary, placeDrumPattern } from '@libraz/libcantus';

const ownFigure: DrumVocabulary = {
  id: 'houseFourOnFloor',
  genre: 'house',
  difficulty: 2,
  articulations: [],
  material: {
    steps: 16,
    strokes: [0, 4, 8, 12].map((step) => ({ voice: 'kick', step, velocity: 1 })),
  },
  provenance: { basis: 'idiom', note: 'the four-on-the-floor pulse of the genre' },
};

const own = placeDrumPattern({ bars: 1, genre: 'house', ctx: { seed: 3, vocabulary: [ownFigure] } });

own.length > 0; // true
```

辞書は曲全体で共有されます。`ctx.vocabulary` はすべての生成器のエントリをまとめて運び、各生成器は自分の素材だけを認識します。ベースの図形はドラム生成器からは見えないだけで、誤読されることはありません。エントリはコンテキストの解決時に検証されるため、決して一致し得ないテンポ帯や拍子を持つ図形は、黙って何にも一致しないのではなく入口で拒否されます。

## スウィングとフィール

`feel` はドラムの2つの面で細分化の扱いを選びます。`swing` は3連符位置へ3分の2だけ寄り、`shuffle` は3連符そのものです。明示した `feel` はどのスタイルでもそのとおりに扱われます。trap や house のように本来ストレートな性格を持つスタイルでも同じです。省略した場合はスタイル自身の feel が適用されます。

辞書のエントリにはストレートな格子の上に書かれていて、レンダ時にその feel を当てて初めてそのものになるものがあります。ハーフタイム・シャッフルがその典型です。`placeDrumPattern` はそのために `feel` を受け取り、図形の音価をどうするかという別の問いには `rate`（`straight`、`half`、`double`）を受け取ります。

```ts
import { placeDrumPattern } from '@libraz/libcantus';

const shuffled = placeDrumPattern({ bars: 1, genre: 'blues', feel: 'shuffle', ctx: { seed: 2, bpm: 88 } });
const halved = placeDrumPattern({ bars: 1, genre: 'blues', rate: 'half', ctx: { seed: 2, bpm: 88 } });

shuffled.some((hit) => hit.startBeat % 1 > 0.6); // true
halved.length > 0; // true
```

他の手段で生成した素材については、スウィングした演奏から抽出したグルーヴテンプレートが同じ情報を持ち、どのパートにも適用できます。

## 関連ページ

拍節強度、小節内位置、連符は[時間とアレンジ](time-and-arrangement.md)に、つまみと再現性の保証は[決定性とシード](determinism-and-seeding.md)にあります。
