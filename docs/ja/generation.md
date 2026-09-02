# 生成

生成は、調、タイムライン、モチーフ、リズムからノートイベントを作ります。同じシードと同じオプションからは同じ結果が得られ、どの呼び出しも入力を変更しません。いずれも、ホストが配置するための新しい素材を返します。

`Composer` は、1つの曲を書くための設定、すなわち調、拍子、テンポ、シード、complexity のダイヤル、楽器、vocabulary を保持します。そこから書き出すパートはその設定を受け継ぐため、曲ごとに一度指定すれば足ります。その下にあるのが生成関数で、同じ設定を引数として受け取ります。クラスは、同じ指定を繰り返さずに済ませるための層です。

このページが素材にするのは和音・調・進行という語彙です。音楽の予備知識がない読者向けには[和声の入門](primer/harmony.md)で扱っています。

## 生成された曲の構成

生成は1回の呼び出しではなく、複数のパスに分かれます。典型的な順序は次のとおりです。

1. 和声を決める: `composer.progression`、まだ和声のない旋律には `composer.harmonize`、またはホストが既に持つコードタイムライン。
2. それに対してパートを書く: `composer.bass`、`composer.drums`、`composer.counterMelody`。
3. 表層を整える: `score.ornament`、`score.groove`、`score.humanize`。

どのパスにも関数版があります。`generateProgression`、`generateBassLine`、`generateDrums`、`generateCounterMelody`、`harmonizeMelody`、`ornament`、`applyGrooveTemplate`、`humanize` は、調・拍子・コンテキストを受け継ぐのではなく引数として受け取ります。どちらの経路も同じジェネレータに届き、同じ音を返します。

パスを分けているため、ホストは一部だけを作り直せます。装飾のオプションを変えても、その下の線は再生成されません。

## 進行とモチーフ

```ts
import { Composer, Motif } from '@libraz/libcantus';

const composer = Composer.of({
  key: 'C major',
  bpm: 96,
  seed: 1,
  complexity: { harmonic: 0.5 },
});
const chords = composer.progression({ style: 'idol', bars: 8 });
const motif = Motif.generate({ key: 'C major', bars: 2, contour: 'arch', ctx: { seed: 1 } });

chords.length; // 8
chords.totalBeats; // 32
motif.notes.length >= 1; // true
```

`composer.progression` が返すのは素の配列ではなく `Timeline` です。コードとそれが鳴る拍を併せ持つため、これに対して書くパートも解析層も、小節の長さを改めて教えられなくても読めます。

同じ素材を関数ひとつずつ、コンテキストを呼び出しごとに指定して書くとこうなります。

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

`generateProgression` は1小節につき1つの `ChordSpan` を返します。`style` はプリセットの候補群を選び、`presetId` は特定のプリセットを指定し、`preset` は度数列を直接渡します。後続和音のセカンダリドミナント、すなわち次の和音自身の調から借りてきた属七の和音へ置き換える割合は `ctx.complexity.harmonic` が決めます。この和音は耳を次の和音へ引き寄せます。既定の0では進行に手を加えません。このダイヤルと代理和音の語彙は[リハーモナイズ](reharmonization.md)を参照してください。

`Rhythm` と `Motif`、そして関数版の `generateRhythm`、`motifToNoteEvents`、`developMotif`、`transformMotif` は、素材の選択と配置・変形を分離します。[旋律とモチーフ](melody-and-motifs.md)と[リズムとグルーヴ](rhythm-and-groove.md)を参照してください。

## パート

ベース、ドラム、対旋律は、いずれも `Score` として返ります。`Score` はノートイベントと、それを書いた拍子・テンポを、音高を持つパートであれば調も併せてひとまとめにした値です。例外は `composer.harmonize` で、和音は `Timeline`、旋律はその和音が読む `Score`、そして渡された線とその旋律との隔たりは `transposeSemitones` として、それぞれ別に返します。

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({
  key: 'C major',
  bpm: 96,
  seed: 7,
  complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 },
});
const chords = composer.progression({ style: 'idol', bars: 4 });

const bass = composer.bass(chords, { style: 'walking' });
const drums = composer.drums({ bars: 4, style: 'funk', section: 'chorus' });

bass.totalBeats; // 16
bass.notes.every((note) => note.durationBeat > 0); // true
drums.notes.length > 0; // true
```

関数版は、和声を明示的なセグメントとして、設定をコンテキストとして受け取ります。

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

`generateBassLine` は開始拍と終了拍を明示したセグメントを受け取ります。コードタイムラインが返すのがこの形です。進行が返す `ChordSpan` はセグメントではないため、先に配置する必要があります。`composer.bass` は `Timeline` でも同じセグメントでも受け取りますが、配置を代行することはありません。ベースのスタイルは `root`、`rootFifth`、`pop`、`walking`、`arpeggio` です。`octave` は目標の音域を指定し、`instrument` を指定するとその楽器で演奏可能な線になります。

ベースパートへのもう一つの入口が `placeLicks` です。`generateDrums` に対する `placeDrumPattern` と同じ関係で、規則として書かれたスタイルの代わりに、[リズムとグルーヴ](rhythm-and-groove.md)が説明する辞書 `BASS_LICKS` からジャンルのフィギュアを引き、セグメントの上に小節単位で敷き、コード交代へはフィギュア自身の最終音から入っていきます。辞書は `motown`、`soul`、`funk`、`blues`、`jazz`、`bossa`、`gospel`、`country`、`reggae` のフィギュアを持ち、ドラム辞書と同じく `ctx.vocabulary` で自作のフィギュアも受け取ります。

```ts
import { BASS_LICKS, majorKey, placeLicks, makeChord } from '@libraz/libcantus';

const segments = [
  { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') },
  { startBeat: 4, endBeat: 8, chord: makeChord(7, 'dom7') },
];

const line = placeLicks(segments, majorKey(0), {
  genre: 'motown',
  ctx: { seed: 4, bpm: 112 },
});

line.length > 0; // true
BASS_LICKS.every((entry) => entry.material.notes.length > 0); // true
```

composer は、設定が支えられないパートを既定値で埋めずに拒否します。`progression`、`bass`、`counterMelody` はいずれも調の上に書くものなので、調を持たない composer では3つとも例外を投げます。旋律から調を読み取るのは `harmonize` の役目で、`with({ key })` を使えばその調を以降のパートへ引き継げます。`progression` はさらに、パート全体で1つの拍子であることを要求します。1小節に1つの和音を並べるため、拍子が変わるとその地点から先で和音が小節線から外れてしまうからです。`drums` は調を持たないためどちらでも書けますが、キットのパターンは4拍の小節を前提に書かれているため、受け付ける拍子は 4/4 だけです。

```ts
import { Composer, isLibcantusError } from '@libraz/libcantus';

let code = 'ok';
try {
  Composer.of({ bpm: 96 }).progression({ style: 'rock', bars: 4 });
} catch (error) {
  if (isLibcantusError(error)) code = error.code;
}

code; // 'INVALID_INPUT'
```

## 装飾

装飾は既存の素材に対する操作なので、素材そのもののメソッドとして呼び出せます。

```ts
import { Score } from '@libraz/libcantus';

const line = Score.of(
  [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
    pitch,
    startBeat: i * 0.5,
    durationBeat: 0.5,
  })),
);

line.ornament({ style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).notes.length; // 8
```

同じ種類のパスに `score.groove` と `score.humanize` があり、その下で呼ばれている関数が `ornament`、`applyGrooveTemplate`、`humanize` です。同じ形のパスでありながら対応するメソッドを持たないものに `imitate` があります。

```ts
import { ornament } from '@libraz/libcantus';

const notes = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(notes, { style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).length; // 8
```

素材を受け取って素材を返すため、ホストは元の素材と各パスのオプションを保存しておき、変更したパスだけを再生成できます。

## コンテキストと再現性

`GenerationContext` が持つのは、プロジェクトの `seed`、`bpm`、パートを書く対象の `instruments`、`vocabulary`、ダイヤルをまとめた `complexity`、生成の契約を固定する `algorithmVersion`、そしてシードから導かれる乱数源ではなく自前の乱数源を渡したい場合の `rng` です。シード自体は省略可能で、省略時は0になります。テンポだけを指定したコンテキストもそれ自体で完結した要求です。ダイヤルは `complexity` の側にあります。`rhythmic`、`harmonic`、`ornament` を 0..1 で持ち、加えて `difficulty` が1から5の上限で、強度を上げるのではなく候補を削ります。`vocabulary` は曲全体が引くジャンル辞書で、[リズムとグルーヴ](rhythm-and-groove.md)の「ジャンル語彙」で説明しています。

ジェネレータが応答するダイヤルはすべてここにあります。呼び出しごとに `ctx` として渡すか、composer に持たせるかのどちらかです。`composer.context` はクラスが覆っていない呼び出しへ渡すための同じプレーンなコンテキストで、`with…` 系のメソッドは手元の composer を書き換えるのではなく新しい composer を返します。

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', bpm: 120, seed: 42 });
const variation = composer.withSeed(43);

composer.context.seed; // 42
variation.data.seed; // 43
JSON.stringify(composer.drums({ bars: 2, style: 'standard', section: 'verse' })) ===
  JSON.stringify(variation.withSeed(42).drums({ bars: 2, style: 'standard', section: 'verse' }));
// true
```

`1` のような数値コンテキストは `{ seed: 1 }` の略記です。乱数の選択は位置から導かれ、`algorithmVersion` は、そのテイクがパラメータのどの読みで作られたかを記録します。生成したパートをそのまま開き直すためにプロジェクトファイルへ保存する項目は、[決定性とシード](determinism-and-seeding.md)を参照してください。

## 楽器による制約

`InstrumentProfile` は楽器の音域と物理的な制約を記述します。`Instrument` はそれを包み、楽器に対する問い合わせに答えます。

```ts
import { Instrument } from '@libraz/libcantus';

Instrument.guitarDropD().canSound(38); // true
Instrument.guitar().canSound(38); // false
Instrument.bass4().playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }]).issues.length; // 1
```

`canSound`、`foldIntoRange`、`playability` は、素のプロファイルを受け取る関数としても同じ答えを返します。組み込みのプロファイルは定数として公開されています。

```ts
import { BASS_4_STRING, GUITAR_DROP_D, GUITAR_STANDARD, canSound, playability } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING).issues.length; // 1
```

コンテキストでプロファイルを指定すること、すなわち `Composer.of({ instruments: { bass: BASS_4_STRING } })` や呼び出し時の `ctx.instruments` は、そのパートを演奏可能にするという要求そのものです。難易度の上限が何を指していても、音域と物理的な制限は適用されます。ジェネレータが読むパート名は `bass` と `drums` の2つだけで、それ以外の名前で登録したプロファイルは参照されません。リードや鍵盤のプロファイルはコンテキストに載って運ばれるだけで、ジェネレータには届きません。[楽器と演奏可能性](instruments-and-playability.md)を参照してください。

## 生成が主張しないこと

生成されたパートは素材であって、判断ではありません。生成はファイルを書かず、音色を選ばず、その結果がスタイル上適切であることを保証しません。それらはホストとそのユーザーの領分です。生成されたパートと、ユーザーがそれを編集したものは別のオブジェクトとして保持してください。再生成が手作業を上書きすることを防げます。
