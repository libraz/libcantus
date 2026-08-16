# ユースケース: DAW の和声アシスタント

DAW、ピアノロール、MIDI パーサから時間付きの音符が得られたあとの流れです。和声に寄与するトラックを `Score` としてまとめ、そこからコードタイムラインを読み取り、そのタイムラインに対して素材を書きます。

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
harmony.cadences().map((hit) => [hit.atBeat, hit.cadence.type]);
// [[8, 'half'], [12, 'authentic']]

const bass = Composer.of({ key: harmony.key, bpm: 100, seed: 7 }).bass(harmony, {
  style: 'walking',
});

bass.notes.length; // 16
```

## 結果の読み方

`harmony.segments` は各区間の開始拍、終了拍、推定されたコードを返します。`harmony.at(beat)` はその瞬間に鳴っているコードを答えます。ピアノロールのカーソルが行う問い合わせはこちらです。ローマ数字にも同じ区間が付いてくるため、ラベルは対応する小節の上に描けます。

タイムラインは、それを読むのに使われた調の領域を自分で持ちます。`harmony.keys` はその一覧で、転調を確認したいユーザーに提示します。`harmony.key` はもっとも長く保たれた調で、ラベルを1つだけ出す場合や、調を1つだけ受け取るジェネレータに渡す場合はこちらを使います。ここで調を言い直している箇所はどこにもありません。タイムラインが調を知っており、そこから作られた `Composer` がそれを引き継ぎます。

タイムラインが持たない唯一の値が、各読みの信頼度です。これは音楽ではなく推定そのものについての値だからです。必要な場合は関数から取り出し、そして表示してください。コードの認識は保証ではなく根拠に基づく推定であり、音数が少ない素材や意図的に曖昧な素材では信頼度が低くなります。

```ts
import { chordTimelineFromNotes } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [43, 59, 62, 65]].flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, segmentConfidence } = chordTimelineFromNotes(notes, { harmonicRhythm: 1 });

segmentConfidence.length === timeline.segments.length; // true
segmentConfidence; // [1, 1]
```

## 入力を正しく与える

- 曲の途中で拍子が変わる場合はスコアに `meters` を、秒が問題になる場合は `tempo` を与えます。どちらもスコアに留まり、そこから行うすべての解析に届きます。拍0より前から音が始まる場合の `pickupBeats` はタイムライン側のオプションです。
- 鳴っている音だけを渡します。長さが0以下のイベントは無視され、インポート直後に明示的に落とすなら `score.filter` を使います。
- `harmonicRhythm` は曲が実際に使うコードの変化間隔に合わせます。細かすぎると保持されたコードが分断され、粗すぎると実際の変化が併合されます。
- 和声を担うトラックだけをまとめます。メロディやドラムのトラックをコード推定に流し込むと結果が動きます。

## 再解析するエディタ

複数のトラックを同時に保持するホストには `Arrangement` があります。音程を持つトラックをすべてまとめて1つの和声を推定し、各トラックをその和声に対して注釈し、下で鳴っているコードとぶつかる音を衝突として集めます。`update` は編集が届きうる拍だけを計算し直すため、打鍵のたびの再解析にかかるのは、曲全体ではなく編集が触れた範囲の分になります。

```ts
import { Arrangement } from '@libraz/libcantus';

const bar = (pitch: number, index: number) => ({ pitch, startBeat: index * 4, durationBeat: 4 });
const keys = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, index) => pitches.map((pitch) => bar(pitch, index)),
);

const arrangement = Arrangement.of(
  [
    { name: 'keys', role: 'pad', notes: keys },
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

衝突は誤りの一覧ではなく報告です。経過音、刺繍音、準備された掛留といった通常の非和声音は、定義からして下のコードに対して不協和です。各衝突はそれらと単純な間違いとを区別するためのラベルを持っています。

編集をまたいで解析を開いたままにする際のコストについては[パフォーマンス](../performance.md)を参照してください。
