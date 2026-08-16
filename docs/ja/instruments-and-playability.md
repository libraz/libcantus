# 楽器と演奏可能性

`InstrumentProfile` は、楽器をたまたま持っている音域ではなく、その楽器が何であるかによって記述します。演奏可能性の検査は「この楽節をその楽器で演奏できるか、どれだけ難しいか」に答えるもので、書き換えも却下も行いません。検査は生成から意図的に分離されています。

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

組み込みのプロファイルは `BASS_4_STRING`、`BASS_5_STRING`、`GUITAR_STANDARD`、`GUITAR_DROP_D` です。それ以外は同じ形のオブジェクトリテラルとして渡します。

## 運指と音域への折り返し

```ts
import { fingeringsFor, foldIntoRange, GUITAR_STANDARD } from '@libraz/libcantus';

fingeringsFor(GUITAR_STANDARD, 64).length >= 1; // true
fingeringsFor(GUITAR_STANDARD, 64)[0]; // { string: 0, fret: 24 }

foldIntoRange(20, GUITAR_STANDARD); // 44
```

`fingeringsFor` はそのピッチを出せる弦とフレットの位置をすべて返します。タブ譜の描画や運指の選択で必要になる情報です。`foldIntoRange` はピッチをオクターブ単位で移動して楽器の範囲内に収めます。演奏不能として報告するのではなくパートを演奏可能に保ちたいインポート処理向けです。

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

`placements` は各音がどう発音されるか（弦とフレット、または叩く手足）を、問題の有無にかかわらず報告します。呼び出し側がこのモジュールの基準ではなく独自の基準を適用できるようにするためです。

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

多くの管楽器では、記譜音と実音が異なります。`TRANSPOSING_INSTRUMENTS` は主要な楽器を音程で表し、2つの変換が両者を行き来します。

```ts
import { formatNote, instrumentTransposition, parseNote, toSoundingPitch, toWrittenPitch, TRANSPOSING_INSTRUMENTS } from '@libraz/libcantus';

TRANSPOSING_INSTRUMENTS.clarinetBb; // '-M2'
TRANSPOSING_INSTRUMENTS.piccolo; // 'P8'

instrumentTransposition('piccolo'); // { number: 8, quality: 'P', semitones: 12 }

formatNote(toSoundingPitch(parseNote('C4'), 'clarinetA')); // 'A3'
formatNote(toSoundingPitch(parseNote('D#4'), 'clarinetA')); // 'B#3'
formatNote(toWrittenPitch(parseNote('A3'), 'clarinetA')); // 'C4'
formatNote(toSoundingPitch(parseNote('C4'), '-P4')); // 'G3'
```

どちらの変換も綴られた音を受け取ります。文字を決めるのは音程だからです。A管クラリネットで記譜された D# は B# として鳴りますが、半音数だけでは C ナチュラルと答えてしまい、パートが書かれている文字が失われます。オクターブを持つ音は音域ごと移動し、オクターブを持たない音はそのままです。

名前の代わりに音程文字列も使えます。表に載っていない楽器 — `-P4` のアルトフルートなど — にライブラリ側の追加は不要です。

解析は実音で動作します。移調楽器用に書かれたパートは入力時に変換し、その奏者のパートを出力する際に戻します。[相互運用](interoperability.md)を参照してください。

## アーティキュレーション

`ARTICULATIONS` は `NoteEvent` が持てる奏法の一覧で、プロファイルはその楽器が出せる奏法を列挙します。プロファイルに含まれない奏法は第1層の `articulationUnavailable` になります。難易度の問題ではなく、その楽器がその方法では出せない音であるためです。

## ノートの安全性

次に鳴らしてよい音を判断するホスト — 即興支援やジャムモードなど — 向けに、`evaluateSafety` と `enumerateSafePitches` は楽器ではなく現在の和声に対してピッチを採点します。`NoteSafety` と `ReasonFlag` が判定とその理由を返すため、UI は鍵盤を無言で禁止するのではなく色分けできます。
