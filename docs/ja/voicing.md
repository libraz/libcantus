# ボイシング

ボイシングは、コード（ルートと音程の集合）を実際の声部の実際のピッチに変換する処理です。この処理には異なる2つの問いが含まれており、それぞれに別の答えがあります。

- `voiceChord` と `voiceProgression` は**探索**します。声部ごとの音域を与えると、制約を満たしつつ前のコードからの移動が最小になる配置を求めます。四声体の場合です。
- `voiceChordStyled` は**構築**します。指定したスタイルとオクターブでコード構成音を積みます。リードシートやコンピングの場合です。

どちらの答えも `Voicing` クラスから得られます。このクラスは鳴っているピッチの集合を1つ保持し、`Voicing.satb` が探索を、`Voicing.forChord` が構築を担います。次のボイシング、そこまでの移動量、綴りといったこのページの残りの問いは、保持しているピッチに対するメソッドです。コードは記号のまま、調は名前のまま渡せるため、事前に値を組み立てる必要はありません。

## 探索によるボイシング

```ts
import { makeChord, SATB_RANGES, voiceChord } from '@libraz/libcantus';

SATB_RANGES.length; // 4
SATB_RANGES[0]; // { min: 40, max: 60 }

voiceChord(makeChord(0, 'maj')); // [48, 60, 64, 67]
voiceChord(makeChord(0, 'maj'), { voices: 3 }).length; // 3
```

クラス側は同じ探索をコード記号から実行し、音域は `Voicing.satbRanges` として持ちます。

```ts
import { Voicing } from '@libraz/libcantus';

Voicing.satbRanges.length; // 4
Voicing.satbRanges[0]; // { min: 40, max: 60 }

Voicing.satb('C').pitches; // [48, 60, 64, 67]
Voicing.satb('C', { voices: 3 }).pitches.length; // 3
Voicing.satb('G7', { key: 'C major' }).pitches; // [55, 62, 65, 71]
```

4声では `SATB_RANGES` を使います（バス E2–C4、テノール C3–G4、アルト G3–D5、ソプラノ C4–G5）。それ以外の声部数には、ほぼ同じ音域幅を等分した範囲が割り当たります。「5声で書く」に対する慣用的な四声体の答えが存在しないためです。

探索を制御するオプションは次のとおりです。

| オプション | 効果 |
| --- | --- |
| `voices` | 明示的な音域を渡さない場合の声部数。 |
| `ranges` | 声部ごとの音域（低い順）。`voices` より優先されます。 |
| `maxSpacing` | 隣り合う上3声の最大間隔（半音）。既定は12。 |
| `key` | 主音を必要とする規則を有効にします。導音は重複せず、未解決のまま残りません。 |
| `maxCandidates` | 1コードあたりに評価する候補数。既定は4000。 |
| `budget` | `voiceProgression` が処理するコード数の上限。 |

`key` を渡すと、検査だけでなく結果そのものが変わります。渡さない場合、探索はコードの構造と声部進行の距離だけで判断します。

```ts
import { majorKey, makeChord, voiceProgression } from '@libraz/libcantus';

const key = majorKey(0);
const progression = [makeChord(7, 'dom7'), makeChord(0, 'maj')];

voiceProgression(progression, { key }); // [[55, 62, 65, 71], [48, 60, 64, 72]]
```

`voiceProgression` は列全体としてボイシングします。各コードは前のコードからの接続の良さで選ばれるため、1コードずつ独立にボイシングした結果とは一致しません。1コードあたりの探索は内部で上限が設けられているため、コストは進行の長さに比例します。

音域にコード構成音が1つも含まれない、声部が収まらないほど音域が狭いなど、解が存在しない場合は妥協案ではなく `NoSolutionError` が返ります。入力の誤りとの区別は[エラーと検証](errors-and-validation.md)を参照してください。

## 既存のボイシングから続ける

`nextVoicing` は、ホストが現在鳴らしているボイシングから次の1つを求めます。対話的なエディタで必要になる形です。

```ts
import { majorKey, makeChord, nextVoicing, voiceLeadingCost } from '@libraz/libcantus';

const current = [48, 60, 64, 67];
const next = nextVoicing(current, makeChord(5, 'maj'), { key: majorKey(0) });

next; // [53, 60, 65, 69]
voiceLeadingCost(current, next); // 8
```

`voiceLeadingCost` が返すのは2つのボイシング間の総移動量（半音）だけです。ホストが独自の候補を順位づけたり、どのボイシングが選ばれた理由を示したり、移動量の大きい提案を却下したりできるように公開されています。直接5度・直接8度の罰点はボイシングの探索側にあり、探索が選ぶ際に加味します。したがって値が小さいことは声部があまり動かなかったことを意味するのであって、進行が清潔であることを意味しません。それに答えるのは `checkPartWriting` です。

`Voicing.next` と `Voicing.costTo` は、ホストが保持しているボイシングに対する同じ2つの呼び出しです。

```ts
import { Voicing } from '@libraz/libcantus';

const sounding = Voicing.of([48, 60, 64, 67]);
const moved = sounding.next('F', { key: 'C major' });

moved.pitches; // [53, 60, 65, 69]
sounding.costTo(moved); // 8
```

離れる側のコードが7thを含む場合は、`key` とあわせて `previousChord` を渡します。7thの解決が `voiceProgression` と同じ基準で採点されます。

## スタイル付きボイシング

`voiceChordStyled` は探索せずに積み上げます。スタイルは、密集配置の積みに対して適用する変形を指します。

| スタイル | 内容 |
| --- | --- |
| `close` | バスから隙間なく積んだ密集配置。 |
| `drop2` | 上から2番目の声部を1オクターブ下げます。 |
| `drop3` | 上から3番目の声部を1オクターブ下げます。 |
| `shell` | ルート・3度・7度のガイドトーンのみ。7thを持たない6thコードは7度の代わりに6度を、どちらも持たない三和音は5度を残します。 |
| `rootless` | ルートを省き、3度・5度・7度とテンションを残します。 |

```ts
import { parseChordSymbol, voiceChordStyled } from '@libraz/libcantus';

const dm7 = parseChordSymbol('Dm7');

voiceChordStyled(dm7); // [62, 65, 69, 72]
voiceChordStyled(dm7, { style: 'drop2' }); // [57, 62, 65, 72]
voiceChordStyled(dm7, { style: 'shell' }); // [62, 65, 72]
voiceChordStyled(dm7, { style: 'rootless' }); // [65, 69, 72]
```

`Voicing.forChord` は同じビルダーで、コード記号をそのまま受け取ります。

```ts
import { Voicing } from '@libraz/libcantus';

Voicing.forChord('Dm7', { style: 'drop2' }).pitches; // [57, 62, 65, 72]
Voicing.forChord('D', { style: 'shell' }).pitches; // [62, 66, 69]
Voicing.forChord('Dm7', { style: 'drop2', rootless: true }).pitches; // [57, 65, 72]
Voicing.forChord('Dm7', { topNote: 5 }).pitches; // [69, 72, 74, 77]
Voicing.forChord('Dm7', { topNote: 6 }).pitches; // [69, 72, 74, 77]
```

`octave` は積みの開始位置を科学的音高表記で指定します。オクターブ4ではバスが中央ハ付近になります。

`topNote` は最高声部が指定のピッチクラスになるよう積みを回転させるもので、コンピングをメロディの下に収める際に使います。コードに含まれないピッチクラスを渡してもエラーにはならず、最も近いコード構成音まで回転します。`Dm7` に対して F# を求めた結果は F を求めた結果と同じで、上の最後の2行がそれにあたります。コード構成音を渡すか、返ってきた最高音を確認してから使ってください。

`rootless` はスタイルであると同時にオプションでもあります。オプションとして渡すとスタイルを問わずルートを省き（`{ style: 'drop2', rootless: true }` はベースがいる場面での左手のドロップ2です）、`rootless` スタイルはそのオプションを密集配置に適用したものにあたります。どちらの場合もオンベースは残ります。オンベースはルートの重複ではなく構造上の要件だからです。

返るピッチはすべて有効な MIDI 番号です。0..127 の範囲を超える積みは、音域外のまま返さずに拒否されます。

## ボイシングを綴る

ボイシングは MIDI ピッチで返ります。楽譜として表示するには、コードと調に対して綴りを与えます。

```ts
import { majorKey, makeChord, noteNames, spellVoicing } from '@libraz/libcantus';

noteNames(spellVoicing([50, 57, 66, 69], makeChord(2, 'maj'), majorKey(0)));
// ['D3', 'A3', 'F#4', 'A4']
```

`Voicing.spell` は保持しているボイシングに対する同じ呼び出しで、プレーンなデータではなく `Note` を返します。

```ts
import { Voicing } from '@libraz/libcantus';

Voicing.of([50, 57, 66, 69]).spell('C major', 'D').map((note) => note.name);
// ['D3', 'A3', 'F#4', 'A4']
```

ハ長調において D の3度は F# であり、Gb ではありません。その根拠を与えているのはコードであり、調だけを渡した場合は調だけで綴りが決まります。綴られた形は和声課題チェッカーの入力形式でもあります。[対位法と和声課題](counterpoint-and-part-writing.md)を参照してください。

## どちらを使うか

制約が音域を持つ声部の集まりである場合は探索側を使います。合唱、弦楽四重奏、和声課題など、担当声部が決まっていて答えがそこに収まる必要がある場面です。

制約がテクスチャである場合はスタイル側を使います。ピアノのコンピング、ギターの譜面、パッドなどです。音域探索が走らないため即座に返り、スタイル名が響きを直接指します。

両方を使うホストは、和声を `voiceProgression` でボイシングし、同じコード列に対して鍵盤パートを `voiceChordStyled` で構築する構成が一般的です。
