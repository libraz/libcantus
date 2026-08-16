# ユースケース: 再現可能な生成アレンジ

1曲につき1つのシードを使い、生成するすべてのパートを同じ和声計画から導きます。これによりプレビューが再現可能になり、ホストは出力されたノートイベントを自由に保存・編集できます。

```ts
import {
  BASS_4_STRING,
  chordFromSpan,
  generateBassLine,
  generateDrums,
  generateProgression,
  majorKey,
  playability,
} from '@libraz/libcantus';

const key = majorKey(0);
const ctx = { seed: 24, bpm: 112, complexity: { rhythmic: 0.6, ornament: 0.3, difficulty: 3 } };

const chords = generateProgression({ key, style: 'idol', bars: 8, reharmonize: true, ctx });

const segments = chords.map((span, index) => ({
  chord: chordFromSpan(span),
  startBeat: span.startBeat,
  endBeat: chords[index + 1]?.startBeat ?? span.startBeat + 4,
}));

const bass = generateBassLine({ segments, key, style: 'pop', instrument: BASS_4_STRING, ctx });
const drums = generateDrums({ bars: 8, style: 'funk', section: 'chorus', ctx });

chords.length; // 8
segments.length; // 8
bass.length >= 1; // true
drums.length >= 1; // true
playability(bass, BASS_4_STRING, 112).issues.length; // 0
```

## 変換の手順がある理由

`generateProgression` が返すのは `ChordSpan`、つまりルート、性質、開始拍です。`generateBassLine` は開始拍と終了拍を明示したセグメントを受け取ります。一方から他方への変換はホストの判断になります。最後のコードがどこまで続くかを知っているのはホストだけだからです。

解析が生成したコードタイムラインは両端をすでに持っているため、既存の曲に対してパートを書く場合はこの手順が不要です。[DAW ワークフロー](daw-workflow.md)を参照してください。

## パスを重ねる

同じ計画に対して `harmonizeMelody`、`generateCounterMelody`、`ornament`、`applyGrooveTemplate` を独立したパスとして追加します。元の素材と各パスのオプションを保存しておけば、ユーザーは変更したパスだけを再生成できます。アレンジ全体を作り直す必要はありません。

上のパートはすべて1つの `ctx` から乱数を導きます。`complexity.rhythmic` を上げると、すでに鳴っている音を動かさずに発音が増えます。`complexity.difficulty` はパートを一律に簡単にするのではなく、難しすぎる候補を取り除きます。[決定性とシード](../determinism-and-seeding.md)を参照してください。

## 書き出しの前に

ジェネレータのオプションで楽器を指定し、`playability` で確認します。単純な音域の確認には `canSound` と `foldIntoRange` を使います。演奏可能性の3つの層は「その音は楽器に存在しない」と「このテンポでは難しい」を分けます。[楽器と演奏可能性](../instruments-and-playability.md)を参照してください。

出力されたノートとあわせて、シード、解決後の `algorithmVersion`、全オプションを保存します。生成は MIDI ファイルを書かず、音色を選ばず、その結果がスタイル上適切であることも保証しません。それらの判断はホストとそのユーザーの領分です。
