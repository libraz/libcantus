# リズムとグルーヴ

リズムは3つの分離した段階として扱います。発音位置を決め、それをノートイベントに変換し、最後に格子からずらします。分離しているため、ホストはパートを作り直さずにノリだけを作り直せます。

このページが数える単位は拍・小節・拍子です。音楽の予備知識がない読者向けには[リズムと拍子の入門](primer/rhythm-and-meter.md)で扱っています。

## 発音位置を生成する

`Rhythm` は、発音位置のパターンと、それを数える拍子をひとまとめにした値です。各スロットの重みを拍節上の強さで決めて格子上に配置し、拍子を持ち回らずにパターンを変形できます。間引き・シンコペーション・変形はいずれもそのパターン自身の拍子で発音位置を順位づけるため、3/4 のパターンは3拍の小節の下拍を、6/8 のパターンは付点四分音符のパルスを保ちます。

```ts
import { parseTimeSignature, Rhythm } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = Rhythm.generate(ts, { bars: 2, ctx: { seed: 42, complexity: { rhythmic: 0.2 } } });
const dense = Rhythm.generate(ts, { bars: 2, ctx: { seed: 42, complexity: { rhythmic: 0.9 } } });

sparse.events.length <= dense.events.length; // true
dense.density() >= sparse.density(); // true
sparse.syncopate(0.6, { seed: 42 }).events.length >= sparse.events.length; // true
sparse.thin(0.5).events.length <= sparse.events.length; // true
```

`thin`、`syncopate`、`doubleTime`、`halfTime`、`ornamentBy`、`deform` はいずれも新しいパターンを返すため、いくつ連ねても手元のパターンはそのまま残ります。`withinCeiling` は、コンテキストの難易度の奏者がコンテキストのテンポでそのパターンを維持できるかを答えます。

すでに手元にある発音位置を包むのが `Rhythm.of` です。拍子は 4/4 を仮定せず、必ず引数として受け取ります。

```ts
import { Rhythm } from '@libraz/libcantus';

const pattern = Rhythm.of(
  [
    { position: 0, duration: 1.5 },
    { position: 1.5, duration: 1.5 },
  ],
  '6/8',
);

pattern.ts.numerator; // 6
pattern.events.length; // 2
```

6/8 のパターンを 4/4 として読むと、どの位置が強いか、小節がどこで切れるか、密度がどれだけかという拍節上の問いすべてに、誤ったパルスで答えます。しかもその読みと呼び出し側が意図した読みは、後段のどこからも区別できません。`Rhythm.generate` と `generateRhythm` が拍子を求めるのも同じ理由です。

`generateRhythm` は同じ発音位置を素の配列として生成し、`rhythmDensity` はその密度を測ります。

```ts
import { generateRhythm, parseTimeSignature, rhythmDensity } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.2 } }, bars: 2 });
const dense = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.9 } }, bars: 2 });

sparse.length <= dense.length; // true
rhythmDensity(dense, ts) >= rhythmDensity(sparse, ts); // true
```

`subdivision` は4分音符1拍あたりのステップ数で表した格子の細かさです。2は8分、4は16分、3は8分3連になります。スロットごとの確率を倍率で変えるのは `ctx.complexity.rhythmic` で、既定値は0.5、[0, 1] を外れた値は丸めずに拒否します。各小節の下拍、すなわちその小節の最初の拍は、シードやつまみの値にかかわらず必ず発音位置になります。生成されたパターンのパルスが抽選に左右されることはありません。

重みづけ自体は `onsetWeightCurve` で取得できます。拍節強度0（拍から外れた位置）から3（強拍）に対する基本確率で、独自の配置ロジックを組む場合に使います。

```ts
import { onsetWeightCurve } from '@libraz/libcantus';

onsetWeightCurve(3) > onsetWeightCurve(0); // true
```

## 発音位置からノートへ

リズムは位置と長さを持ちますが、ピッチを持ちません。ピッチを与えると `Score` になり、そこからライブラリの他の部分に届きます。

```ts
import { parseTimeSignature, Rhythm } from '@libraz/libcantus';

const snare = Rhythm.generate(parseTimeSignature('4/4'), { bars: 1, ctx: { seed: 3 } }).toScore(38);

snare.notes.every((note) => note.pitch === 38); // true
```

同じパターンをプレーンデータとして表すのが `RhythmEvent` で、ピッチを与えるのが `rhythmToNoteEvents` です。

```ts
import { generateRhythm, parseTimeSignature, rhythmToNoteEvents } from '@libraz/libcantus';

const rhythm = generateRhythm(parseTimeSignature('4/4'), { ctx: { seed: 3 }, bars: 1 });
const notes = rhythmToNoteEvents(rhythm, 38);

rhythm[0]; // { position: 0, duration: 1 }
notes.every((note) => note.pitch === 38); // true
```

`RhythmEvent` のフィールド名は `position` と `duration` で、`NoteEvent` が持つ `startBeat` と `durationBeat` ではありません。リズムはまだノートではなく、2つの形はこの名前で区別されます。どちらも4分音符を単位とした拍で数え、`duration` は次の発音位置までの長さです。`rhythmToNoteEvents` は、呼び出しでベロシティを指定しなければ96を与えます。

この分離は意図的なものです。1つのリズムを複数のピッチで再利用でき、旋律の生成側は音そのものを借りずにリズムだけを借りられます。

## ヒューマナイズ

ヒューマナイズはイベントを格子からずらし、拍節上の位置に応じてベロシティを整えます。返るのは新しいスコアであるため、量子化された元データは保持されます。

```ts
import { Score } from '@libraz/libcantus';

const quantized = Score.of([
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 80 },
]);

const played = quantized.humanize({ ctx: { seed: 1 }, timing: 0.03 });

played.notes.length; // 2
quantized.notes[0]?.startBeat; // 0
```

`humanize` はノートイベントの配列に対する同じパスで、オプションも同じです。

```ts
import { humanize } from '@libraz/libcantus';

const quantized = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 80 },
];

const played = humanize(quantized, { ctx: { seed: 1 }, timing: 0.03 });
const doubled = humanize(quantized, { ctx: { seed: 1 }, timing: 0.03, part: 'double' });

played.length; // 2
played[0]?.startBeat === doubled[0]?.startBeat; // false
quantized[0]?.startBeat; // 0
```

| オプション | 意味 |
| --- | --- |
| `timing` | 4分音符を単位とした最大の揺れ幅。±で適用。既定は 0.02。 |
| `velocity` | ベロシティの最大揺れ幅（MIDI 単位）。±で適用。既定は 8。 |
| `accent` | 強拍がどれだけ大きくなるか（MIDI 単位）。既定は 12。 |
| `baseVelocity` | ベロシティを持たないイベントに仮定する値。既定は 80。 |
| `ts` | 拍節アクセントを導く拍子。既定は 4/4。 |
| `part` | この呼び出しが抽選を引く名前。既定は `humanize`。 |

スコアは自身の拍子に対してヒューマナイズされるため、`ts` は素の配列にだけ必要なオプションです。長さが0以下のイベントは鳴らないため取り除かれ、結果が入力より短くなることがあります。

2つの線を別々に揺らすのが `part` です。揺れは位置から引かれるため、同じコンテキストから同じ名前でヒューマナイズした2つのパートは、位置とピッチが一致する箇所で同じずれを受け取ります。ユニゾンで重ねた線ではこれは望ましくありません。2本が同じだけ動いてしまい、互いの関係は量子化されていたときと変わらないままだからです。パートごとに名前を与えると、それぞれ独立に揺れます。

## グルーヴテンプレート

グルーヴテンプレートは、演奏から取り出した1小節分のタイミングとベロシティのずれの格子です。目的のノリを持つ演奏から抽出し、それを持たない素材に適用します。`Score.grooveTemplate` はスコアが持っている拍子に対してノリを読み取り、`Score.groove` はそれを別のスコアに重ねます。

```ts
import { parseTimeSignature, Score } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const performed = Score.of(
  [
    { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 100 },
    { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 70 },
  ],
  { meters: ts },
);
const template = performed.grooveTemplate(4);

template.subdivision; // 4
template.slotsPerBar; // 16

const stiff = Score.of(
  [
    { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 90 },
    { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 90 },
  ],
  { meters: ts },
);

stiff.groove(template).notes.length; // 2
```

`extractGrooveTemplate` と `applyGrooveTemplate` は、ノートイベントに対して同じ2つの手順を行い、拍子を呼び出しごとに指定します。

```ts
import { applyGrooveTemplate, extractGrooveTemplate, parseTimeSignature } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');
const template = extractGrooveTemplate(
  [
    { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 100 },
    { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 70 },
  ],
  ts,
  4,
);

const stiff = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 90 },
];
const grooved = applyGrooveTemplate(stiff, template, ts);

grooved.length; // 2
```

格子の細かさは `extractGrooveTemplate` と `Score.grooveTemplate` の最後の引数で、4分音符1拍あたりのステップ数で指定します。既定は4、すなわち16分音符の格子で、テンプレートが記録するずれが聞き取れる細かさです。

各スロットは、そこに落ちたイベントの格子からの平均ずれと平均ベロシティを持ちます。ベロシティが `null` の場合、ベロシティを持つイベントがそこに落ちなかったことを意味し、ベロシティ0とは区別されます。この区別のためにフィールドは null 許容です。

抽出されたテンプレートは抽出時の拍子を記録し、適用時の拍子が一致することを要求します。4/4 のグルーヴを 3/4 に適用すると、1小節分の格子が異なる小節長に対応づけられ、何も報告されないままずれが蓄積するため、この不一致は拒否されます。ただし `ts` フィールドは省略可能です。手で組み立てたテンプレートに拍子がなければ照合する対象自体がないため、呼び出しで指定された拍子のまま適用されます。

## ドラム

ドラムのパートは単一の線ではなくキット全体です。語彙はスタイル・セクション・ロールの3つで決まり、拍子・テンポ・つまみは composer が与えます。

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({
  bpm: 96,
  seed: 11,
  complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 },
});
const pattern = composer.drums({ bars: 4, style: 'funk', section: 'chorus', fills: true });

pattern.notes.length > 0; // true
pattern.notes.every((hit) => hit.durationBeat > 0); // true
```

`generateDrums` は同じキットのパートを書き、スコアではなく `DrumHit[]` を返します。

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

グルーヴは、2拍目と4拍目に置くスネアであるバックビート、ハイハットの細分、オープンハットとクラッシュの拍、フィルの開始拍まで、すべて4拍の小節を前提に書かれています。そのため受け付ける拍子は 4/4 のみで、それ以外の拍子は、長さの違う小節の中に 4/4 のアクセントを置いた結果を返すのではなく拒否します。composer の拍子がそれ以外の場合も同じ理由で拒否されます。他の拍子で書くには `generateRhythm` を使ってください。`placeDrumPattern` は引いてきた図形が書かれている拍子で書きますが、組み込み辞書の図形はすべて 4/4 で書かれています。そのため 4/4 以外の拍子は、空の結果を返すのではなく拒否されます。その拍子で書かれた語彙を context から与えたときだけ、その拍子の小節に図形が置かれ、その拍子のアクセントに従って間引かれます。

`fills: true` は最終小節の終わりをフィルにします。その小節のどこまでをフィルが占めるかはセクションが決めます。`chorus` では小節全体、`prechorus` では最後の3拍、`verse` と `bridge` では最後の2拍、`intro` と `outro` では最後の1拍だけです。

`nextSection` はそのフィルが向かう先のセクションを指定し、どの原型を引くかはここで決まります。コーラスへ入るフィルと、イントロから出るフィルは別物だからです。`nextSection: 'chorus'` を指定し、プリコーラスが3小節以上あるときは、フィルの代わりに盛り上げが入ります。2小節のリフトがすでにフレーズの終わりを示しており、フィルより優先されるためです。省略した場合の `nextSection` はそのセクション自身で、フレーズの終わりはセクション内のフィルとして書かれます。

`euclideanKick` は、スタイルが持つキックをユークリッドリズムに置き換えます。`steps` の中に `pulses` 個の打点を可能な限り均等に配置し、`rotation` はそれを後ろへずらします。抽選ではなく明示的にキックの形を指定したい場合に使います。

```ts
import { DRUM_NOTES, generateDrums } from '@libraz/libcantus';

const hits = generateDrums({
  bars: 1,
  style: 'house',
  section: 'verse',
  euclideanKick: { pulses: 3, steps: 8 },
  ctx: { seed: 5 },
});

hits.filter((hit) => hit.pitch === DRUM_NOTES.kick).map((hit) => hit.startBeat); // [0, 1.5, 3]
```

`budget` は1回の呼び出しが書ける打点数の上限です。生成は小節数に対して線形で、探索は行わないため、この上限は暴走する探索ではなく、際限のない呼び出しに対する歯止めです。上限を超える要求は実行されず `BudgetExceededError` になります。

`role` はどの声部を鳴らすかを制限します。`full` から `ambient`、`minimal`、`fxOnly` の順に薄くなります。`drumVoiceOf` は General MIDI のノート番号が指す声部を答えます。受け取るのは番号であって、それを持つ打点ではありません。その番号を返すのが `DRUM_NOTES` で、書き出し処理で必要になるのはこちらです。

```ts
import { DRUM_NOTES, drumVoiceOf } from '@libraz/libcantus';

DRUM_NOTES.kick; // 36
drumVoiceOf(DRUM_NOTES.kick); // 'kick'
```

## ジャンル語彙

`generateDrums`、およびその上に立つ `composer.drums` は、生成器に組み込まれたスタイル表からキットのパートを書きます。同じ `DrumHit[]` に至るもう1つの経路が `placeDrumPattern` です。こちらはジャンル辞書から図形を引き、辞書の各エントリはコードではなくデータです。これに対応する composer のメソッドはありません。辞書と組み込みの表は、1つのパートを求める2通りの書き方ではなく、別々の供給源だからです。

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

図形の打点が持つベロシティは MIDI の数値ではなく係数で、基準値100に対して読まれます。呼び出しの `velocity` は別の基準値を与え、セクションとつまみはそこから倍率をかけます。

3つのつまみは互いに干渉しません。担当する段階が異なるためです。ジャンルはどの図形を候補にするかを選び、複雑度のつまみは選ばれた図形を変形します。難易度の上限は2度却下します。まず、図形自身が申告する難易度が上限を超えるものをすべて外し、次に、つまみによる変形の結果、最短の打点間隔がその上限の奏者には維持できなくなったものを外します。却下された図形は簡略化されるのではなく候補から外れます。簡略化された図形は別の図形だからです。

`GENRES` は図形が名乗れるジャンル名の閉じた一覧であって、すべてに素材があることを約束するものではありません。組み込みのドラム辞書が持つのはそのうち7つ（`motown`、`funk`、`gospel`、`blues`、`bossa`、`samba`、`dnb`）で、ベースの辞書は別の集合を持ちます。組み込みの図形がないジャンル（`pop` や `house` など）は、`ctx.vocabulary` から与えるエントリを待っている名前です。素材を与えずに要求した場合は、失敗ではなく空の結果が返ります。`DRUM_PATTERNS` は辞書そのもので、凍結されています。各エントリは、ジャンル、1から5の難易度、適するテンポ帯、書かれている拍子、キットに要求するアーティキュレーション、そして公開の根拠となる出自を持ちます。出自として認めるのはジャンルの共有財産であり、特定の録音のフレーズは含めません。適するセクションを併せて名乗ることもできますが、組み込みのドラム図形はどれも名乗っていないため、いずれもすべてのセクションで候補になります。

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

辞書は曲全体で共有されます。`ctx.vocabulary`、クラス側では `Composer.of({ vocabulary })` が、すべての生成器のエントリをまとめて運び、各生成器は自分の素材だけを認識します。ベースの図形はドラム生成器からは見えないだけで、誤読されることはありません。エントリはコンテキストの解決時に検証されるため、決して一致し得ないテンポ帯や拍子を持つ図形は、黙って何にも一致しないのではなく入口で拒否されます。

## スウィングとフィール

`feel` はドラムの2つの面で細分化の扱いを選びます。`swing` は3連符位置へ3分の2だけ寄り、つまり裏拍がスウィングした8分音符のように遅れて鳴ります。`shuffle` は3連符そのものです。明示した `feel` はどのスタイルでもそのとおりに扱われます。9つのうち `shuffle` を除く8つ、すなわち本来ストレートな性格を持つスタイルでも同じです。省略した場合はスタイル自身の feel が適用されます。

辞書のエントリにはストレートな格子の上に書かれていて、レンダ時にその feel を当てて初めてそのものになるものがあります。ハーフタイム・シャッフルがその典型です。`placeDrumPattern` はそのために `feel` を受け取り、図形の音価をどうするかという別の問いには `rate`（`straight`、`half`、`double`）を受け取ります。

```ts
import { placeDrumPattern } from '@libraz/libcantus';

const shuffled = placeDrumPattern({ bars: 1, genre: 'blues', feel: 'shuffle', ctx: { seed: 2, bpm: 88 } });
const halved = placeDrumPattern({ bars: 1, genre: 'blues', rate: 'half', ctx: { seed: 2, bpm: 88 } });

shuffled.some((hit) => hit.startBeat % 1 > 0.6); // true
halved.length > 0; // true
```

すでに手元にあるパターンについては、`Rhythm.deform({ rate })` が音価の側の問いに答えます。feel のほうはドラムの面に属し、図形を配置する時点で適用されます。他の手段で生成した素材については、スウィングした演奏から抽出したグルーヴテンプレートが同じ情報を持ち、どのパートにも適用できます。

## 関連ページ

拍節強度、小節内位置、連符は[時間とアレンジ](time-and-arrangement.md)に、つまみと再現性の保証は[決定性とシード](determinism-and-seeding.md)にあります。
