# ユースケース: DAW の和声アシスタント

DAW、ピアノロール、MIDI パーサから時間付きの音符が得られたあとの流れです。和声に寄与するトラックを `Score` としてまとめ、そこからコードタイムラインを読み取り、そのタイムラインに対して素材を書きます。

この流れが前提にするのは、MIDI ピッチと開始拍と長さを持つノートイベントだけです。調もコードも終止形も、ここではそこから読み取ります。報告に使われる語彙 — 和音、ローマ数字、終止形、調区間 — については[入門](../primer/index.md)を参照してください。

```ts
import { Composer, Score } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const score = Score.of(notes, { tempo: 100 });
const harmony = score.timeline({ harmonicRhythm: 1 });

harmony.roman().map((entry) => entry.roman); // ['I', 'IV', 'V7', 'I']
harmony.key?.toString(); // 'C major'
harmony.keys.length; // 1
harmony.segmentConfidence; // [1, 1, 1, 1]
harmony.cadences().map((hit) => [hit.atBeat, hit.cadence.type]);
// [[8, 'half'], [12, 'authentic']]

const bass = Composer.of({ key: harmony.key, bpm: 100, seed: 7 }).bass(harmony, {
  style: 'walking',
});

bass.notes.length; // 16
```

## 結果の読み方

`harmony.segments` は各区間の開始拍、終了拍、推定されたコードを返します。`harmony.at(beat)` はその瞬間に鳴っているコードを答えます。ピアノロールのカーソルが行う問い合わせはこちらです。ローマ数字にも同じ区間が付いてくるため、ラベルは対応する小節の上に描けます。

タイムラインは、それを読むのに使われた調の領域を自分で持ちます。`harmony.keys` はその一覧で、転調を確認したいユーザーに提示します。`harmony.key` はもっとも長く保たれた調で、ラベルを1つだけ出す場合はこちらを使います。ジェネレータに渡すのもこの値です。調を読み取る場所が解析なのであって、解析した調がひとりでに後段まで届くわけではありません。`Composer` は自分が持つ調で書き、渡されたタイムラインからはコードだけを取ります。そのため上の例では `harmony.key` を `Composer.of` に明示的に渡しています。

各読みの信頼度はコードといっしょに付いてきます。`harmony.segmentConfidence` はセグメントと同じ順に1区間1つの値を持ち、上の三和音3つと属七の和音はいずれも曖昧さを残さないため、それぞれ 1 と読まれます。この値は表示してください。コードの認識は保証ではなく根拠に基づく推定であり、音数が少ない素材や意図的に曖昧な素材では値が下がります。

```ts
import { Score } from '@libraz/libcantus';

// Two bare tritones: nothing in them settles which root they belong to.
const notes = [[60, 66], [63, 69]].flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const timeline = Score.of(notes).timeline({ harmonicRhythm: 1 });

timeline.segmentConfidence.length === timeline.length; // true
timeline.segmentConfidence; // [0.425, 0.425]
```

## 入力を正しく与える

- 曲の途中で拍子が変わる場合はスコアに `meters` を、秒が問題になる場合は `tempo` を与えます。どちらもスコアに留まり、そこから行うすべての解析に届きます。`pickupBeats` はタイムライン側のオプションです。アウフタクトはこれを渡さなくても負の拍で鳴り、長さを明示することで、そのアウフタクトより前から始まる音を拒否できます。
- 鳴っている音だけを渡します。長さが0以下のイベントは無視され、インポート直後に明示的に落とすなら `score.filter` を使います。
- `harmonicRhythm` は曲が実際に使うコードの変化間隔、つまり和声が何拍ごとに変わるかに近い値にします。既定の `'dynamic'` セグメンテーションでは、これはウィンドウ幅ではなく事前分布です。値が小さいほど変化のコストが下がって保持されたコードが分断され、大きいほど多くの根拠を要求して実際の変化が併合されます。ウィンドウ幅そのものにするには `segmentation: 'grid'` を渡します。
- 和声を担うトラックだけをまとめます。メロディやドラムのトラックをコード推定に流し込むと結果が動きます。

## 再解析するエディタ

複数のトラックを同時に保持するホストには `Arrangement` があります。音程を持つトラックをすべてまとめて1つの和声を推定し、各トラックをその和声に対して注釈し、報告に値する音を衝突として集めます。`update` は編集が届きうる拍だけを計算し直すため、打鍵のたびの再解析にかかるのは、曲全体ではなく編集が触れた範囲の分になります。

```ts
import { Arrangement } from '@libraz/libcantus';

const bar = (pitch: number, index: number) => ({ pitch, startBeat: index * 4, durationBeat: 4 });
const keys = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, index) => pitches.map((pitch) => bar(pitch, index)),
);

const arrangement = Arrangement.of(
  [
    { name: 'keys', role: 'harmony', notes: keys },
    { name: 'lead', role: 'melody', notes: [72, 72, 74, 72].map(bar) },
  ],
  { key: 'C major' },
);

arrangement.timeline().roman().map((entry) => entry.roman); // ['I', 'IV', 'V7', 'I']
arrangement.conflicts.length; // 2

const edited = arrangement.update([{ trackIndex: 1, notes: [72, 73, 74, 72].map(bar) }]);

edited.tracks[1]?.notes[1]?.pitch; // 73
arrangement.tracks[1]?.notes[1]?.pitch; // 72
```

アレンジメントは変化しないため、編集前に取った読みはそのまま有効です。取り消し用に保持したり、変更が何をしたのかを見せるのに使えます。

## 提示の仕方

生成したベースは新しいトラックとして扱い、ユーザーの音符の置き換えには使いません。元のイベントを保持し、推定結果は訂正できる形で提示します。権威ありげに見えて誤っているラベルより、ユーザーが直せるラベルのほうが役に立ちます。

衝突は誤りの一覧ではなく報告であり、2種類のものを含みます。経過音、刺繍音、準備された掛留といった通常の非和声音は、定義からして下のコードに対して不協和です。和音構成音も、他のトラックとのあいだで声部進行上の欠陥を作れば報告されます。上の2件がそれで、keys と lead のあいだの F–C5 から G–D5 への並行5度であり、どちらも和音構成音です。経過音と単純な間違いを見分けるには `labels` を、どの規則が発火したかを知るには `rationale` を読みます。

編集をまたいで解析を開いたままにする際のコストについては[パフォーマンス](../performance.md)を参照してください。
