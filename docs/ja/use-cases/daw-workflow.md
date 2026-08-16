# ユースケース: DAW の和声アシスタント

DAW、ピアノロール、MIDI パーサから時間付きの音符が得られたあとの流れです。和声に寄与するトラックを平坦化し、コードタイムラインを推定して、それに対して素材を生成します。

```ts
import { chordTimelineFromNotes, chordToRoman, detectCadences, generateBassLine } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey, keys, segmentConfidence } = chordTimelineFromNotes(notes, {
  harmonicRhythm: 1,
});

const labels = timeline.segments.map((segment) => chordToRoman(segment.chord, prevailingKey));
const cadences = detectCadences(timeline, prevailingKey);
const bass = generateBassLine({
  segments: timeline.segments,
  key: prevailingKey,
  style: 'walking',
  ctx: { seed: 7, bpm: 100 },
});

labels; // ['I', 'IV', 'V7', 'I']
keys.length >= 1; // true
segmentConfidence.length === timeline.segments.length; // true
bass.length >= 1; // true
cadences.length >= 0; // true
```

## 結果の読み方

`timeline.segments` は各区間の開始拍、終了拍、推定されたコードを返します。各読みの信頼度は `segmentConfidence` に区間順で入ります。コードの認識は保証ではなく根拠に基づく推定であり、音数が少ない素材や意図的に曖昧な素材では信頼度が低くなるため、この値を表示してください。

`keys` は局所的な調の読みを記録します。ユーザーが転調を確認する必要がある場面ではこちらを提示します。単一のラベルだけを出す場合は `prevailingKey` を使います。

`timeline.segments` は `generateBassLine` が期待する入力の形でもあります。そのため、生成されたラインは変換を挟まずに推定された和声に従います。

## 入力を正しく与える

- 曲の途中で拍子が変わる場合は `MeterMap` を、拍0より前から音が始まる場合は `pickupBeats` を渡します。
- 鳴っている音だけを渡します。長さが0以下のイベントは無視され、`dropSilentNotes` はインポート直後にその方針を明示的に適用します。
- `harmonicRhythm` は曲が実際に使うコードの変化間隔に合わせます。細かすぎると保持されたコードが分断され、粗すぎると実際の変化が併合されます。
- 和声を担うトラックだけを平坦化します。メロディやドラムのトラックをコード推定に流し込むと結果が動きます。

## 提示の仕方

生成した `bass` は新しいトラックとして扱い、ユーザーの音符の置き換えには使いません。元のイベントを保持し、推定結果は訂正できる形で提示します。権威ありげに見えて誤っているラベルより、ユーザーが直せるラベルのほうが役に立ちます。

変更のたびに再解析するエディタでは、`analyzeArrangement` を繰り返し呼ぶ代わりに `createArrangementSession` を保持します。[パフォーマンス](../performance.md)を参照してください。
