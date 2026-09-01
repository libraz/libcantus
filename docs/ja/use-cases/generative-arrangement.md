# ユースケース: 再現可能な生成アレンジ

1曲につき1つのシードを使い、生成するすべてのパートを同じ和声計画から導きます。これによりプレビューが再現可能になり、ホストは出力されたノートイベントを自由に保存・編集できます。シード、調、テンポ、複雑さのダイヤルが置かれる場所が `Composer` です。各パートはそれらを言い直すのではなく受け継ぎます。

この流れは音楽の素材を手元に必要としません。入力は調名とテンポとシードだけで、コードはライブラリが出します。語彙 — 調、コード進行、セクション、演奏可能性 — については[入門](../primer/index.md)を参照してください。

```ts
import { Composer, Instrument } from '@libraz/libcantus';

const bass4 = Instrument.bass4();
const composer = Composer.of({
  key: 'C major',
  bpm: 112,
  seed: 24,
  complexity: { rhythmic: 0.6, ornament: 0.3, difficulty: 3 },
});

const plan = composer.progression({ style: 'idol', bars: 8 });
const bass = composer.bass(plan, { style: 'pop', instrument: bass4 });
const drums = composer.drums({ bars: 8, style: 'funk', section: 'chorus' });

plan.segments.length; // 8
plan.totalBeats; // 32
plan.roman().map((entry) => entry.roman);
// ['IV', 'V', 'iii', 'vi', 'IV', 'V', 'iii', 'vi']

bass.notes.length; // 27
// Every kit voice is an event of its own, so the count pools the whole kit:
drums.notes.length; // 281
bass4.playability(bass.notes, 112).issues.length; // 0
```

## 計画がアレンジの背骨になる

`composer.progression` が返すのは `Timeline` です。各コードが開始と終了を持ち、その下に調があります。これはパートのジェネレータがそのまま追う形なので、最後のコードがどこまで続くかをホストが決めて計画をセグメントに組み直す段階はありません。同じタイムラインが、ここではベースを、その隣では対旋律を、そしてホストが書き出すコードトラックを動かします。

解析も同じ種類の値を返します。既存の曲に対してパートを書く場合も、その音符から読んだタイムラインに対して同じように書きます。[DAW ワークフロー](daw-workflow.md)を参照してください。

コンポーザが返すスコアは、いずれもコンポーザ自身の拍子とテンポで読まれ、音程を持つものはその調で読まれます。そのため、各パートを1つずつ文脈付けし直さなくても互いに揃います。

## 1つのシード、1つのテイク

音を決めるのは設定とシードです。同じコンポーザに二度尋ねれば同じ音楽が返り、シードを変えたものは最初のテイクを編集したものではなく、別のテイクになります。

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', bpm: 112, seed: 24 });
const plan = composer.progression({ style: 'idol', bars: 8 });

composer.progression({ style: 'idol', bars: 8 }).equals(plan); // true
composer.withSeed(25).progression({ style: 'idol', bars: 8 }).equals(plan); // false
```

`withSeed`、`withKey`、`withComplexity` はいずれも新しいコンポーザを返すため、変奏は元を置き換えずにその隣に書かれます。`complexity.rhythmic` を上げると、すでに鳴っている音を動かさずに発音が増えます。`complexity.difficulty` はパートを一律に簡単にするのではなく、難しすぎる候補を取り除きます。[決定性とシード](../determinism-and-seeding.md)を参照してください。

## パスを重ねる

`composer.harmonize` と `composer.counterMelody` は同じ計画の上にパートを足します。`Score` 自身も `ornament`、`humanize`、`groove`、`quantize` というパスを持ちます。いずれも新しいスコアを返すため、元のパートは加工後も残り、ユーザーは変更したパスだけを生成し直せます。

```ts
import { Composer, Score } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', bpm: 112, seed: 24 });
const plan = composer.progression({ style: 'idol', bars: 8 });

const melody = Score.of(
  [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, index) => ({
    pitch,
    startBeat: index * 4,
    durationBeat: 2,
  })),
);

// The default 'complement' rhythm writes where the melody is not moving, so a
// melody leaving the second half of each bar open gives it room to answer.
const counter = composer.counterMelody(melody, {
  timeline: plan.chordTimeline,
  register: 'above',
});
const loosened = counter.humanize();

counter.notes.length; // 21
loosened.notes.length; // 21
melody.notes[0]?.startBeat; // 0
```

対旋律のジェネレータは和声をどちらの形でも受け取ります。`Timeline` そのものでも、`plan.chordTimeline` が渡すプレーンなコードタイムラインでも構いません。

## 書き出しの前に

ジェネレータのオプションで楽器を指定し、そのうえで同じ楽器に対して結果を確認します。

```ts
import { Instrument } from '@libraz/libcantus';

const bass4 = Instrument.bass4();

bass4.range(); // { low: 28, high: 67 }
bass4.canSound(24); // false
bass4.foldIntoRange(24); // 36
```

より詳しい確認は `playability` です。その3つの層は「その音は楽器に存在しない」と「このテンポでは難しい」を分けます。[楽器と演奏可能性](../instruments-and-playability.md)を参照してください。

出力されたノートとあわせて `composer.data` を保存します。これが再現のためのレシピそのものです。パートが引かれたときのシードと `algorithmVersion` は、呼び出し側がどちらも指定しなかった場合でも解決されてここに入ります。そのため `Composer.fromData` は、開き直したビルドの既定値ではなく、そのテイクそのものを開き直します。生成は MIDI ファイルを書かず、音色を選ばず、その結果がスタイル上適切であることも保証しません。それらの判断はホストとそのユーザーの領分です。
