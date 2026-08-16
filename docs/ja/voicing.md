# ボイシング

ボイシングは、コード（ルートと音程の集合）を実際の声部の実際のピッチに変換する処理です。このライブラリには2つの方法があり、それぞれ異なる問いに答えます。

- `voiceChord` と `voiceProgression` は**探索**します。声部ごとの音域を与えると、制約を満たしつつ前のコードからの移動が最小になる配置を求めます。四声体の場合です。
- `voiceChordStyled` は**構築**します。指定したスタイルとオクターブでコード構成音を積みます。リードシートやコンピングの場合です。

## 探索によるボイシング

```ts
import { makeChord, SATB_RANGES, voiceChord } from '@libraz/libcantus';

SATB_RANGES.length; // 4
SATB_RANGES[0]; // { min: 40, max: 60 }

voiceChord(makeChord(0, 'maj')); // [48, 60, 64, 67]
voiceChord(makeChord(0, 'maj'), { voices: 3 }).length; // 3
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

`voiceLeadingCost` は2つのボイシング間の総移動量（半音）です。ホストが独自の候補を順位づけたり、どのボイシングが選ばれた理由を示したり、移動量の大きい提案を却下したりできるように公開されています。

離れる側のコードが7thを含む場合は、`key` とあわせて `previousChord` を渡します。7thの解決が `voiceProgression` と同じ基準で採点されます。

## スタイル付きボイシング

`voiceChordStyled` は探索せずに積み上げます。スタイルは、密集配置の積みに対して適用する変形を指します。

| スタイル | 内容 |
| --- | --- |
| `close` | バスから隙間なく積んだ密集配置。 |
| `drop2` | 上から2番目の声部を1オクターブ下げます。 |
| `drop3` | 上から3番目の声部を1オクターブ下げます。 |
| `shell` | ルート・3度・7度のガイドトーンのみ。 |
| `rootless` | ルートを省き、3度・5度・7度とテンションを残します。 |

```ts
import { parseChordSymbol, voiceChordStyled } from '@libraz/libcantus';

const dm7 = parseChordSymbol('Dm7');

voiceChordStyled(dm7); // [62, 65, 69, 72]
voiceChordStyled(dm7, { style: 'drop2' }); // [57, 62, 65, 72]
voiceChordStyled(dm7, { style: 'shell' }); // [62, 65, 72]
voiceChordStyled(dm7, { style: 'rootless' }); // [65, 69, 72]
```

`octave` は積みの開始位置を科学的音高表記で指定します。オクターブ4ではバスが中央ハ付近になります。`topNote` は最高声部が指定のピッチクラスになるよう積みを回転させるもので、コンピングをメロディの下に収める際に使います。返るピッチはすべて有効な MIDI 番号です。0..127 の範囲を超える積みは、音域外のまま返さずに拒否されます。

## ボイシングを綴る

ボイシングは MIDI ピッチで返ります。楽譜として表示するには、コードと調に対して綴りを与えます。

```ts
import { majorKey, makeChord, noteNames, spellVoicing } from '@libraz/libcantus';

noteNames(spellVoicing([50, 57, 66, 69], makeChord(2, 'maj'), majorKey(0)));
// ['D3', 'A3', 'F#4', 'A4']
```

ハ長調において D の3度は F# であり、Gb ではありません。綴られた形は和声課題チェッカーの入力形式でもあります。[対位法と和声課題](counterpoint-and-part-writing.md)を参照してください。

## どちらを使うか

制約が音域を持つ声部の集まりである場合は探索側を使います。合唱、弦楽四重奏、和声課題など、担当声部が決まっていて答えがそこに収まる必要がある場面です。

制約がテクスチャである場合はスタイル側を使います。ピアノのコンピング、ギターの譜面、パッドなどです。音域探索が走らないため即座に返り、スタイル名が響きを直接指します。

両方を使うホストは、和声を `voiceProgression` でボイシングし、同じコード列に対して鍵盤パートを `voiceChordStyled` で構築する構成が一般的です。
