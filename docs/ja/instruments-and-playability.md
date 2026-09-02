# 楽器と演奏可能性

`InstrumentProfile` は、楽器をたまたま持っている音域ではなく、その楽器が何であるかによって記述します。演奏可能性の検査は「この楽節をその楽器で演奏できるか、どれだけ難しいか」に答えるもので、書き換えも却下も行いません。検査は生成から意図的に分離されています。

このページは MIDI のピッチ番号、綴られた音、音程を前提にしています。[ピッチと音程の入門](primer/pitch-and-intervals.md)がそれらを解説し、対応する API を示します。

## プロファイル

弦楽器のプロファイルは、チューニング、フレット数、ストレッチの上限から成ります。発音範囲はそこから決まります。弦 `s` は `tuning[s]` から `tuning[s] + frets` までを鳴らします。

```ts
import { BASS_4_STRING, canSound, GUITAR_DROP_D, GUITAR_STANDARD, instrumentRange } from '@libraz/libcantus';

GUITAR_STANDARD.kind; // 'stringed'
GUITAR_STANDARD.tuning; // [40, 45, 50, 55, 59, 64]
instrumentRange(BASS_4_STRING); // { low: 28, high: 67 }

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
```

代わりに `[min, max]` を保持すると、5弦ベース、ドロップチューニング、拡張レンジのネックが互いに無関係な特例になり、「ネックが足りない」と「その音は楽器の下限より低い」が区別できなくなります。

打楽器のプロファイルは音域ではなく手足で記述します。`reach` は各声部を叩ける手足を優先順に示します。どの手足も届かない声部は楽器上に存在せず、同じ手足を同時に必要とする2つの声部は同時に鳴りません。

`overdub` は、独立したパスで演奏される声部を指します。バックビートで既に両手が塞がっているグルーヴに乗るタンバリンやシェイカーは、3本目の腕ではなく2回目のパスです。そのためオーバーダブされた声部はキットからも他のオーバーダブからも手足を奪いません。自分のパスの中では手に持って演奏されるので、`reach` の項目は保持したままです。

組み込みの弦楽器プロファイルは `BASS_4_STRING`、`BASS_5_STRING`、`GUITAR_STANDARD`、`GUITAR_DROP_D` です。打楽器の組み込みプロファイルは `DRUM_KIT` で、手足と `reach` を埋めたドラムキットが最初から用意されています。それ以外は同じ形のオブジェクトリテラルとして渡します。

## Instrument クラス

`Instrument` はプロファイルを包み、それを束縛した状態で同じ問いに答えます。組み込みのプロファイルには専用のファクトリがあり、`Instrument.of` は任意のプロファイル — 組み込みの定数、`DRUM_KIT`、呼び出し側が書いたリテラル — を受け取ります。

```ts
import { DRUM_KIT, Instrument } from '@libraz/libcantus';

Instrument.guitar().range(); // { low: 40, high: 88 }
Instrument.guitarDropD().canSound(38); // true
Instrument.guitar().canSound(38); // false
Instrument.of(DRUM_KIT).kind; // 'percussion'
```

2種類のベースには `Instrument.bass4` と `Instrument.bass5` があり、`Instrument.data` は保存や受け渡しのために素のプロファイルを返します。このページでは以降も両方の書き方を示します。[生成](generation.md)のガイドとユースケースのページはクラス形式で統一されています。

楽器を受け取る入り口はどちらの形でも受け取ります。呼び出し側が持っているもの — プロジェクトファイルに保存したプロファイル、組み込みの定数、`Instrument` のインスタンス — を1つの素のプロファイルへ広げるのが `toInstrumentProfile` です。同じ値を弦楽器の系統へ絞り込むのが `toStringedProfile` で、ネックしか扱えない処理に必要になります。弦とフレットの上に置くベースラインはドラムキット向けには書けません。それを名前で伝えるほうが、`tuning` が無いことが後になって「ジェネレーターが置けなかった音」として表面化するより役に立ちます。

```ts
import { DRUM_KIT, Instrument, toInstrumentProfile, toStringedProfile } from '@libraz/libcantus';

toInstrumentProfile(Instrument.guitar()).name; // 'guitar'
toInstrumentProfile(DRUM_KIT).kind; // 'percussion'
toStringedProfile(Instrument.bass4()).tuning; // [28, 33, 38, 43]
```

どちらも受け取りながら検証します。弦のないネック、数として成立しないフレット数、どの手足も届かないキットは、後続の失敗ではなく、その楽器を名指しした `InvalidInputError` になります。

## 運指と音域への折り返し

```ts
import { fingeringsFor, foldIntoRange, GUITAR_STANDARD } from '@libraz/libcantus';

fingeringsFor(GUITAR_STANDARD, 64).length >= 1; // true
fingeringsFor(GUITAR_STANDARD, 64)[0]; // { string: 0, fret: 24 }

foldIntoRange(20, GUITAR_STANDARD); // 44
```

`fingeringsFor` はそのピッチを出せる弦とフレットの位置をすべて返します。タブ譜の描画や運指の選択で必要になる情報です。`foldIntoRange` は、その楽器が実際に鳴らせるオクターブのうちもっとも近いものを返します。等距離なら上のオクターブを返し、どのオクターブも鳴らせない場合はピッチをそのまま返します。演奏不能として報告するのではなくパートを演奏可能に保ちたいインポート処理向けです。音域には隙間があってもよいので、ドラムキットでは下のオクターブのほうが近いこともあります。

```ts
import { DRUM_KIT, foldIntoRange } from '@libraz/libcantus';

foldIntoRange(58, DRUM_KIT); // 46
foldIntoRange(100, DRUM_KIT); // 100
```

`Instrument` からは、プロファイルを繰り返し渡さずに同じ2つの答えが得られます。

```ts
import { Instrument } from '@libraz/libcantus';

const guitar = Instrument.guitar();

guitar.fingerings(64)[0]; // { string: 0, fret: 24 }
guitar.foldIntoRange(20); // 44
```

`fingerings` はドラムキットに対しては例外を投げます。ピッチを置くネックがないためです。`foldIntoRange` はどちらの種類にも使えます。

## 演奏可能性の3つの層

`playability` は3種類の障害を報告します。まとめて返りますが層は区別されます。楽器に存在しない音は、技量をいくら上げても出せないためです。

| 層 | 意味 | 種類 |
| --- | --- | --- |
| 1 | その音が楽器に存在しない。 | `noteOutOfRange`、`articulationUnavailable` |
| 2 | 配置として成立しない。 | `stringConflict`、`stretchTooWide`、`limbConflict`、`polyphonyExceeded` |
| 3 | 時間が足りない。 | `tooFast` |

```ts
import { BASS_4_STRING, playability } from '@libraz/libcantus';

const report = playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING);

report.issues[0]?.type; // 'noteOutOfRange'
report.issues[0]?.layer; // 1
report.difficulty >= 1; // true
```

クラス形式では、プロファイルを保持した楽器に対して同じ検査を行います。

```ts
import { Instrument } from '@libraz/libcantus';

const bass = Instrument.bass4();
const report = bass.playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }]);

report.issues[0]?.type; // 'noteOutOfRange'
report.difficulty >= 1; // true
```

`bpm` を参照するのは第3層だけです。テンポを渡さなければ、楽器だけで決まる内容が報告されます。

```ts
import { GUITAR_STANDARD, playability } from '@libraz/libcantus';

const run = [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.25,
  durationBeat: 0.25,
}));

playability(run, GUITAR_STANDARD).difficulty <= playability(run, GUITAR_STANDARD, 200).difficulty;
// true
```

`difficulty` は単位時間あたりの移動量を1（容易）から5（限界）に対応づけます。テンポがない場合は120 BPM で測るため、楽節どうしの比較が可能な数値になります。テンポを渡すと、その値に応じて上がります。

第3層のしきい値は系統ごとに1つずつあり、様式ではなく身体の制約です。押弦する手がネック上を移動できるのは毎秒 100 フレットまで、1つの手足が打てるのは 0.06 秒に1回までで、これを超える要求は `tooFast` になります。各項目は練習で解決できるかどうかも示します。`impossible` は、楽器だけで決まる第1層と第2層では true、程度の問題である `tooFast` では false です。

```ts
import { GUITAR_STANDARD, playability } from '@libraz/libcantus';

const leaps = [40, 64, 41, 65, 42, 66].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.0625,
  durationBeat: 0.0625,
}));

const report = playability(leaps, GUITAR_STANDARD, 400);

report.issues[0]?.type; // 'tooFast'
report.issues[0]?.layer; // 3
report.issues.every((issue) => issue.impossible === false); // true
```

`placements` は音符1つにつき1項目を、渡された順に持ちます。そして位置を持つ音それぞれについて、どう発音されるか（弦とフレット、または叩く手足）を、問題の有無にかかわらず報告します。呼び出し側がこのモジュールの基準ではなく独自の基準を適用できるようにするためです。その楽器が鳴らせない音も項目自体は残り、どちらのフィールドも入りません。

長さが 0 以下の音符は何も打たないため、手足も時間も使いません。`placements` の項目は残り、同じ声部の同じ瞬間に2つ置いても `limbConflict` にも `tooFast` にもなりません。ピッチの検査は行われます。その音が楽器にあるかどうかは、どれだけ保持するかに左右されないためです。

```ts
import { DRUM_KIT, playability } from '@libraz/libcantus';

const silent = [
  { pitch: 36, startBeat: 0, durationBeat: 0 },
  { pitch: 36, startBeat: 0.01, durationBeat: 0 },
];

playability(silent, DRUM_KIT, 200).issues.length; // 0
playability(silent, DRUM_KIT, 200).placements.length; // 2
```

`Score` は渡された楽器に対して同じ検査を行い、第3層をテンポ表示1つではなくテンポマップ全体から答えます。そのためアッチェレランドの下にある楽節は、そこで実際に効いているテンポで判定されます。問題が示す拍はスコア自身の拍です。

```ts
import { Instrument, Score } from '@libraz/libcantus';

const score = Score.of([{ pitch: 27, startBeat: 0, durationBeat: 1 }]);

score.playability(Instrument.bass4()).issues[0]?.type; // 'noteOutOfRange'
```

## 生成に制約をかける

`GenerationContext` で楽器を指定することは、そのパートをその楽器で演奏可能にするという要求そのものです。音域と物理的な制限は、難易度の上限の値にかかわらず常に適用されます。

```ts
import { BASS_4_STRING, canSound, generateBassLine, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const segments = [
  { chord: { rootPc: 0, quality: 'maj' as const, intervals: [0, 4, 7] }, startBeat: 0, endBeat: 4 },
];

const line = generateBassLine({
  segments,
  key,
  style: 'root',
  ctx: { seed: 4, bpm: 100, instruments: { bass: BASS_4_STRING } },
});

line.every((note) => canSound(BASS_4_STRING, note.pitch)); // true
```

`complexity.difficulty` が作用するのはタイミングの層だけです。その音が存在するか、その形を保持できるかはプロファイルから決まります。両者の関係は[決定性とシード](determinism-and-seeding.md)を参照してください。

## 移調楽器

多くの管楽器では、記譜音と実音が異なります。移調楽器とは、鳴らす調とは別の調でパートが書かれる楽器のことで、B♭管クラリネットで記譜された C は B♭ として鳴ります。`TRANSPOSING_INSTRUMENTS` は主要な楽器を音程で表し、2つの変換が両者を行き来します。

```ts
import { formatNote, instrumentTransposition, parseNote, toSoundingPitch, toWrittenPitch, TRANSPOSING_INSTRUMENTS } from '@libraz/libcantus';

TRANSPOSING_INSTRUMENTS.clarinetBb; // '-M2'
TRANSPOSING_INSTRUMENTS.piccolo; // 'P8'

instrumentTransposition('piccolo');
// { number: 8, quality: 'P', semitones: 12, descending: false }

formatNote(toSoundingPitch(parseNote('C4'), 'clarinetA')); // 'A3'
formatNote(toSoundingPitch(parseNote('D#4'), 'clarinetA')); // 'B#3'
formatNote(toWrittenPitch(parseNote('A3'), 'clarinetA')); // 'C4'
formatNote(toSoundingPitch(parseNote('C4'), '-P4')); // 'G3'
```

どちらの変換も綴られた音を受け取ります。文字を決めるのは音程だからです。A管クラリネットで記譜された D# は B# として鳴りますが、半音数だけでは C ナチュラルと答えてしまい、パートが書かれている文字が失われます。オクターブを持つ音は音域ごと移動し、オクターブを持たない音はそのままです。

名前の代わりに音程文字列も使えます。表に載っていない楽器 — `-P4` のアルトフルートなど — にライブラリ側の追加は不要です。

`Instrument.soundingPitch` はプロファイル自身の名前で移調を引き当てるため、ギターは何も指定せずに済みます。`GUITAR_STANDARD` も `GUITAR_DROP_D` もギターのオクターブに解決します。それ以外のプロファイルは、2種類のベースと `DRUM_KIT` を含めて移調を明示する必要があり、指定がなければ引き当てられなかった楽器を名指しした `InvalidInputError` を投げます。

```ts
import { Instrument } from '@libraz/libcantus';

Instrument.guitar().soundingPitch('C4').name; // 'C3'
Instrument.guitarDropD().soundingPitch('C4').name; // 'C3'
Instrument.guitar().soundingPitch('C4', '-P4').name; // 'G3'
Instrument.bass4().soundingPitch('C4', '-P8').name; // 'C3'
```

ギターのパートは実音より1オクターブ上に記譜されるため、記譜の `C4` に対してギターは何も指定しなくても `C3` を返します。エレキベースも同じく実音より1オクターブ上に記譜され、コントラバスがまさにその理由で `-P8` として表に載っています。ただしベースのプロファイルは表に載っていないため、`Instrument.bass4().soundingPitch('C4')` は移調せずに例外を投げます。`'-P8'` か、それを表す `'doubleBass'` の項目を指定してください。

解析は実音で動作します。移調楽器用に書かれたパートは入力時に変換し、その奏者のパートを出力する際に戻します。[相互運用](interoperability.md)を参照してください。

## アーティキュレーション

`ARTICULATIONS` は `NoteEvent` が持てる奏法の一覧で、プロファイルはその楽器が出せる奏法を列挙します。`ARTICULATIONS` にはあるがプロファイルに含まれない奏法は、第1層の `articulationUnavailable` になります。難易度の問題ではなく、その楽器がその方法では出せない音であるためです。`ARTICULATIONS` にすらない名前は `playability`、`Score.of`、`Score.fromJSON` が `InvalidInputError` として拒否します。その名前の奏法はライブラリに定義されていないためです。

## ノートの安全性

次に鳴らしてよい音を判断するホスト — 即興支援やジャムモードなど — 向けに、`evaluateSafety` と `enumerateSafePitches` は楽器ではなく現在の和声に対してピッチを採点します。`NoteSafety` と `ReasonFlag` が判定とその理由を返すため、UI は鍵盤を無言で禁止するのではなく色分けできます。
