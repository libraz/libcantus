# スケールとモード

このライブラリでのスケールは、12ビットのマスクとルートのピッチクラスの組で、`KeyScale` として表します。ビット n が立っている場合、ルートの n 半音上の音がそのスケールに含まれます。したがってスケールは名前の一覧ではなく集合であり、12ピッチクラスの任意の部分集合を表現できます。

```ts
import { majorKey, MAJOR_MASK, minorKey } from '@libraz/libcantus';

majorKey(0); // { rootPc: 0, modeMask12: MAJOR_MASK }
MAJOR_MASK; // 0b101010110101
minorKey(9).rootPc; // 9
```

この表現により、所属や度数の判定は表引きではなく算術になります。ライブラリが名前を知らないスケールでも、組み込みのスケールと同じように扱えます。

## 組み込みのスケール

`NAMED_SCALES` には西洋音楽の語彙 — 教会旋法、各種短音階、対称スケール、ペンタトニック — が入ります。`WORLD_SCALES` には他の伝統で名を持つスケールが入り、`SCALE_ALIASES` がよく使われる別表記をそこへ対応づけます。

```ts
import { NAMED_SCALES, scaleByName, WORLD_SCALES } from '@libraz/libcantus';

Object.hasOwn(NAMED_SCALES, 'lydianDominant'); // true
Object.hasOwn(WORLD_SCALES, 'miyakoBushi'); // true

scaleByName('dorian', 2).rootPc; // 2
scaleByName('okinawan', 4).modeMask12 === scaleByName('ryukyu', 4).modeMask12; // true
```

2つの表が分かれているのは、答える問いが異なるためです。コードスケール理論は `NAMED_SCALES` から候補を順位づけます。`WORLD_SCALES` のスケールは、採点される候補ではなく特定の響きの指定として扱われます。マスクを直接必要とする場合は `resolveScaleName` と `requireScaleMask` が別名を解決します。未知の名前は空のスケールを返さずに拒否します。空の結果はすでに「該当なし」を意味するため、入力の誤りがそれと区別できなくなることを避けています。

どちらの表にもないスケールは、音程の並びから構成します。

```ts
import { maskFromOffsets, scaleTonesInDegreeOrder } from '@libraz/libcantus';

const hexatonic = { rootPc: 0, modeMask12: maskFromOffsets([0, 3, 4, 7, 8, 11]) };
scaleTonesInDegreeOrder(hexatonic); // [0, 3, 4, 7, 8, 11]
```

## 収録の範囲

どちらの表でも、1つのエントリはピッチクラスの集合です。`WORLD_SCALES` の名前は、集合よりはるかに多くのものを持つ伝統から取られていますが、マスクが担うのは集合だけです。

thāt は rāga ではありません。上行形と下行形（ārohaṇa / avarohaṇa）も、vādī / samvādī も、pakaḍ も持たないため、`todi` から得られるのは rāga Todi が用いる音組織だけで、rāga を演奏するための材料は揃いません。

```ts
import { scaleByName, scaleTonesInDegreeOrder } from '@libraz/libcantus';

scaleTonesInDegreeOrder(scaleByName('todi', 0)); // [0, 1, 3, 6, 7, 8, 11]
```

他の名前も同じです。マカームは ajnās を組み合わせ、フレーズの進行に応じて移高・転換していく体系で、ここにある5つが指すのはマカームの音組織にとどまります。日本の音階は小泉文夫のテトラコルド理論では、核音が枠づけるテトラコルドとして説明されます。`miyakoBushi` と `minyo` の違いはテトラコルドの型の違いであり、ピッチクラス集合の違いはその結果を書き留めたものです。

ピッチ集合としての響きが必要な場面で使ってください。旋法体系そのものを扱うにはその体系のモデルが要りますが、このライブラリは持っていません。

## 度数と所属

```ts
import { diatonicPitchClasses, isScaleTone, majorKey, nearestScaleTone, pitchToScaleDegree } from '@libraz/libcantus';

const c = majorKey(0);

isScaleTone(64, c); // true
isScaleTone(61, c); // false
nearestScaleTone(61, c); // 60
pitchToScaleDegree(67, c); // 5
diatonicPitchClasses(c); // [0, 2, 4, 5, 7, 9, 11]
```

`pitchToScaleDegree` はスケール内で度数を数えます。7音音階の第5音にも、5音音階の5番目の音にも 5 を返します。`nearestScaleTone` はスケールへのスナップ機能で使うもので、変更するのは音高であり綴りではありません。

## 機能和声が成り立つスケール

ローマ数字、終止、和声機能は、いずれも古典的な調性音楽の約束事です。導音を持たないスケールや3度堆積の和音を持たないスケールに適用すると、意味を持たないラベルが生成されます。

```ts
import { scaleSystemOf, supportsFunctionalHarmony } from '@libraz/libcantus';

scaleSystemOf('major'); // 'common-practice'
scaleSystemOf('dorian'); // 'modal'
scaleSystemOf('wholeTone'); // 'non-functional'

supportsFunctionalHarmony('major'); // true
supportsFunctionalHarmony('miyakoBushi'); // false
```

`SCALE_SYSTEMS` は組み込みの全スケールを3つの体系に分類します。UI でローマ数字を提示する前に `supportsFunctionalHarmony` を確認してください。全音音階の箇所に対する正しい応答は、近似して選んだ数字ではなく「この解析は適用できない」ことです。

## コードとスケールの対応

コードを渡すと、`chordScales` はそれを含むスケールを適合順に並べます。ここでの適合は余分な音が少ないことを指し、同点の場合は慣用的なものと7音のものが優先されます。

```ts
import { chordScales, makeChord } from '@libraz/libcantus';

chordScales(makeChord(0, 'maj7'))[0]; // { name: 'ionian', rootPc: 0 }
chordScales(makeChord(0, 'dom7'))[0]; // { name: 'mixolydian', rootPc: 0 }
```

スケールが決まると、2つの問いが続きます。テンションは色として追加できる非コード構成音のスケール音、アボイドノートはコード構成音の半音上に位置する非コード構成音（またはサスペンションが追い出した3度）で、和音に重ねると濁ります。

この規則が示すのは和音に**重ねて**はいけない音であり、ラインが触れてはいけない音とは別の問いです。`{ use: 'melodic' }` は後者を尋ねます。ここで残るのはルートの半音上だけなので、旋律的な答えは常に和声的な答えの部分集合になります。

```ts
import { availableTensions, avoidNotes, chordScaleReport, makeChord } from '@libraz/libcantus';

availableTensions(makeChord(0, 'maj7'), 'ionian'); // [2, 9]
avoidNotes(makeChord(0, 'maj7'), 'ionian'); // [5]
avoidNotes(makeChord(0, 'maj7'), 'ionian', { use: 'melodic' }); // []

const report = chordScaleReport(makeChord(0, 'dom7'), 1);
report[0]?.name; // 'mixolydian'
report[0]?.avoid; // []
report[0]?.passing; // [5]
report[0]?.tensions; // [2, 9]
```

`chordScaleReport` は上の3つを1つにまとめたもので、適合順に並び、件数の上限も指定できます。各エントリはコードが鳴らしていないスケール音を3つに分けます。`avoid` はまったく弾けない音、`passing` は経過的には通れるが和音に重ねてはいけない音、`tensions` は色として自由に足せる音です。UI のパネルが必要とするのは通常この形です。

可用性はそのコードの働きにも左右されます。属七の和音を単独で読むと、短調のスケール上では使える音がありません。♭9・11・♭13 がいずれもコード構成音の半音上に来るからです。しかしその調の属和音として聴けば、♭9 と ♭13 はその調自身の音であり定石でもあります。解決先のコードを渡してください。

```ts
import { availableTensions, makeChord } from '@libraz/libcantus';

availableTensions(makeChord(7, 'dom7'), 'phrygianDominant'); // []
availableTensions(makeChord(7, 'dom7'), 'phrygianDominant', { resolvesTo: makeChord(0, 'min') });
// [3, 8]
```

完全11度はアボイドノートのままです。解決によって使えるようになるのは変化した9度と♭13 であって、あらゆる衝突ではありません。

## 進行全体でスケールを選ぶ

コードごとに最適なスケールを独立に選ぶと、聴感上の理由なくスケールが移り変わるラインになります。`scalesForChanges` は経路全体を一度に決め、あるコードでの適合をわずかに緩める代わりに前後のつながりを取ります。

```ts
import { makeChord, scalesForChanges } from '@libraz/libcantus';

const changes = [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')];
scalesForChanges(changes).map((choice) => choice.scale.name);
// ['dorian', 'mixolydian', 'ionian']
```

隣り合う選択の遷移コストは、異なるピッチクラスの数に、そのコード自身の最適スケールから離れることへの小さなペナルティを加えたものです。総コスト最小の経路を、入力順に1コード1件で返します。

## スケールを綴る

マスクには音名がありません。`spellScale` は綴られた主音から音名を割り当てるため、主音の書き方が変わっても正しく読めます。

```ts
import { majorKey, noteNames, scaleByName, spelledKeyOf, spellScale } from '@libraz/libcantus';

noteNames(spellScale(spelledKeyOf(majorKey(6)).tonic, majorKey(6)));
// ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']

const miyako = scaleByName('miyakoBushi', 0);
noteNames(spellScale(spelledKeyOf(miyako).tonic, miyako)); // ['C', 'Db', 'F', 'G', 'Ab']
```

`spelledKeyOf` は臨時記号の少ない主音の綴りを選びます。長調のピッチクラス1は C# ではなく Db になります。両方の綴りが同じだけ遠い場合 — ピッチクラス6は嬰6つの F# と変6つの Gb — はフラット側を採ります。曲がもう一方の綴りで書かれている場合は、主音を明示的に渡してください。

7音音階では各度数に次の文字が割り当たります。音の抜けたスケールは、ピッチ集合が許す範囲で1音に1文字を与え、許さない箇所は傾いている側に寄せて1音ずつ綴ります。ブルーススケールは、どの読み方でも同じ文字を2回使うことになります。

綴りの規則は[音高と記譜](pitch-and-notation.md)を、主音の綴りが決まる仕組みは[調関係と転調](key-relations-and-modulation.md)を参照してください。
