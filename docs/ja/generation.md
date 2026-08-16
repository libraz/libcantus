# 生成

生成関数は、調、タイムライン、モチーフ、リズムからノートイベントを作ります。同じシードと同じオプションからは同じ結果が得られ、どのジェネレータも入力を変更しません。いずれも、ホストが配置するための新しい素材を返します。

## 生成された曲の構成

ジェネレータは1回の呼び出しではなく、複数のパスとして組み合わせます。典型的な順序は次のとおりです。

1. 和声を決める: `generateProgression`、またはホストが既に持つコードタイムライン。
2. それに対してパートを書く: `generateBassLine`、`generateDrums`、`generateCounterMelody`、`harmonizeMelody`。
3. 表層を整える: `ornament`、`applyGrooveTemplate`、`humanize`。

パスを分けているため、ホストは一部だけを作り直せます。装飾のオプションを変えても、その下の線は再生成されません。

## 進行とモチーフ

```ts
import { generateMotif, generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const chords = generateProgression({
  key,
  style: 'idol',
  bars: 8,
  ctx: { seed: 1, complexity: { harmonic: 0.5 } },
});
const motif = generateMotif({ key, bars: 2, contour: 'arch', ctx: { seed: 1 } });

chords.length; // 8
motif.notes.length >= 1; // true
```

`generateProgression` は1小節につき1つの `ChordSpan` を返します。`style` はプリセットの候補群を選び、`presetId` は特定のプリセットを指定し、`preset` は度数列を直接渡します。後続和音のセカンダリドミナントへ置き換える割合は `ctx.complexity.harmonic` が決め、既定の0では進行に手を加えません。このダイヤルと代理和音の語彙は[リハーモナイズ](reharmonization.md)を参照してください。

`generateRhythm`、`motifToNoteEvents`、`developMotif`、`transformMotif` は、素材の選択と配置・変形を分離します。[旋律とモチーフ](melody-and-motifs.md)と[リズムとグルーヴ](rhythm-and-groove.md)を参照してください。

## パート

ベース、ドラム、対旋律、和音付けは、いずれもノートイベントのモデルを共有します。

```ts
import { generateBassLine, generateDrums, majorKey, makeChord } from '@libraz/libcantus';

const key = majorKey(0);
const segments = [
  { chord: makeChord(0, 'maj'), startBeat: 0, endBeat: 4 },
  { chord: makeChord(5, 'maj'), startBeat: 4, endBeat: 8 },
];

const bass = generateBassLine({ segments, key, style: 'walking', ctx: { seed: 7, bpm: 96 } });

bass.length >= 1; // true
bass.every((note) => note.durationBeat > 0); // true

const drums = generateDrums({
  bars: 4,
  style: 'funk',
  section: 'chorus',
  ctx: { seed: 7, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});

drums.length > 0; // true
```

`generateBassLine` は開始拍と終了拍を明示したセグメントを受け取ります。コードタイムラインが返すのがこの形です。進行が返す `ChordSpan` はセグメントではないため、先に配置する必要があります。ベースのスタイルは `root`、`rootFifth`、`pop`、`walking`、`arpeggio` です。`octave` は目標の音域を指定し、`instrument` を指定するとその楽器で演奏可能な線になります。

## 装飾

装飾は既存の素材に対する操作です。

```ts
import { ornament } from '@libraz/libcantus';

const notes = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(notes, { style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).length; // 8
```

同じ種類のパスに `imitate`、`applyGrooveTemplate`、`humanize` があります。素材を受け取って素材を返すため、ホストは元の素材と各パスのオプションを保存しておき、変更したパスだけを再生成できます。

## コンテキストと再現性

`GenerationContext` は、プロジェクトのシード、テンポ、楽器プロファイル、vocabulary、complexity、difficulty を保持します。`complexity` は `rhythmic`、`harmonic`、`ornament` を 0..1 で持ちます。`difficulty` は1から5の上限で、強度を上げるのではなく候補を削ります。`vocabulary` は曲全体が引くジャンル辞書で、[リズムとグルーヴ](rhythm-and-groove.md)の「ジャンル語彙」で説明しています。

`1` のような数値コンテキストは `{ seed: 1 }` の略記です。乱数の選択は位置から導かれ、`algorithmVersion` が生成の契約を固定します。生成したパートをそのまま開き直すためにプロジェクトファイルへ保存する項目は、[決定性とシード](determinism-and-seeding.md)を参照してください。

各ジェネレータは、曲全体ではなく1つのパートだけを欲しい呼び出し側のために、独自の略記（`seed`、`bpm`、`density`）も受け取ります。両方が指定された場合はコンテキストが優先されます。曲全体を代表するのはコンテキストだからです。

## 楽器による制約

`InstrumentProfile` は楽器の音域と物理的な制約を記述します。`canSound`、`foldIntoRange`、`playability` により、生成した素材を検査したり適応させたりできます。

```ts
import { BASS_4_STRING, GUITAR_DROP_D, GUITAR_STANDARD, canSound, playability } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING).issues.length; // 1
```

コンテキストでプロファイルを指定することは、そのパートを演奏可能にするという要求そのものです。難易度の上限が何を指していても、音域と物理的な制限は適用されます。[楽器と演奏可能性](instruments-and-playability.md)を参照してください。

## 生成が主張しないこと

生成されたパートは素材であって、判断ではありません。生成はファイルを書かず、音色を選ばず、その結果がスタイル上適切であることを保証しません。それらはホストとそのユーザーの領分です。生成されたパートと、ユーザーがそれを編集したものは別のオブジェクトとして保持してください。再生成が手作業を上書きすることを防げます。
