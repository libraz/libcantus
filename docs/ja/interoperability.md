# 相互運用

このライブラリは MIDI ファイルの読み書き、記譜の描画、音声解析、再生を行いません。これらはホストの担当であり、このページではその境界での変換を扱います。

## データの取り決め

2つの約束がすべてを支えます。

- **ピッチは MIDI ノート番号です。** 中央ハは60です。[音律と周波数](tuning-and-frequency.md)を使わない限り、周波数は現れません。
- **時間は4分音符を単位とする拍です。** `startBeat` と `durationBeat` は浮動小数の拍数で、ティックでも秒でもありません。拍0が最初の強拍で、アウフタクトは負の拍から始まります。

解析と生成の結果は JSON 互換のプレーンデータです。関数 API にクラスインスタンスは現れず、隠れたプロトタイプもありません。結果はそのままプロジェクトファイルに直列化でき、復元処理なしで読み戻せます。クラス API は同じデータを包み、`.data` で公開します。

データではなく検索関数であるフィールドが1つだけあります。コードタイムラインは `segments` と、それを引く `at` の組で、関数は `JSON.stringify` を通り抜けられません。解析結果の報告フィールドは `timeline.segments` を含めてそのまま往復し、`at` は保存した segments から `chordTimelineFromChords` で作り直せます。作り直したものは、元のタイムラインとすべての拍で同じ和音を返します。

例外はハンドルで、これらは結果ではありません。`createNoteEventIndex`、`createArrangementSession`、`createRng`、`createPositionalRng`、`resolveContext` が返すのはライブオブジェクトです。メソッドや関数のフィールドは `JSON.stringify` を通り抜けられません。保存するのは、それらを組み立てた入力のほうです。ノートイベント、シード、解決後の `algorithmVersion` を保存し、読み込み時に作り直してください。[決定性とシード](determinism-and-seeding.md)を参照してください。

## ティックと秒

MIDI ファイルは指定した PPQ のもとでティックにより時間を表します。入力時に変換し、出力時に戻します。

```ts
import { beatsToTicks, ticksToBeats } from '@libraz/libcantus';

ticksToBeats(960, 480); // 2
beatsToTicks(2, 480); // 960
```

秒への変換にはテンポマップが必要です。テンポ変化のある曲には単一の換算係数が存在しないためです。

```ts
import { beatsToSeconds, secondsToBeats } from '@libraz/libcantus';

const tempo = [
  { startBeat: 0, bpm: 120 },
  { startBeat: 4, bpm: 60 },
];

beatsToSeconds(8, tempo); // 6
secondsToBeats(6, tempo); // 8
```

`TempoMap` は区分定数で、変化をまたいで積分されます。テンポ変化をまたぐ音は、どちらか一方の値で計算した長さではなく、正しい長さになります。

マップの最初のイベントが時間の原点です。`beatsToSeconds` はそこで 0 を返します。ピックアップはその前に鳴るため、拍・秒・tick のいずれも負になり、冒頭のテンポでそのまま計算されます。`beatsToSeconds(-1, tempo)` は `-0.5`、`beatsToTicks(-1, 480)` は `-480` です。変換のために全体をずらす必要はありません。

## MIDI ファイルの取り込み

ホストが既に持つ MIDI パーサを使う場合の一般的な流れです。

1. 各イベントのティック位置と長さを `ticksToBeats` で拍に変換します。
2. 長さ0のイベントを残すか捨てるかを明示的に決めます。`dropSilentNotes` は解析側の方針を適用し、`assertNoteEvents` に `allowNonPositiveDuration` を渡すとその判断の前に検査できます。
3. ファイルの拍子イベントから拍子マップを、テンポイベントからテンポマップを組み立てます。
4. 和声に寄与するトラックを1つの配列にまとめて `chordTimelineFromNotes` に渡し、それ以外は `ArrangementTrack` として個別に保ち `analyzeArrangement` に渡します。ノートを読む入り口はいずれも `readonly NoteEvent[]` を受け取るため、`ArrangementTrack.notes` はコピーせずそのまま渡せます。

```ts
import { assertNoteEvents, dropSilentNotes, ticksToBeats } from '@libraz/libcantus';

const raw = [
  { midi: 60, tick: 0, lengthTicks: 480 },
  { midi: 64, tick: 0, lengthTicks: 0 },
];

const imported = raw.map((event) => ({
  pitch: event.midi,
  startBeat: ticksToBeats(event.tick, 480),
  durationBeat: ticksToBeats(event.lengthTicks, 480),
}));

assertNoteEvents(imported, 'imported notes', { allowNonPositiveDuration: true }).length; // 2
dropSilentNotes(imported).length; // 1
```

MIDI ファイルのチャンネル10の打楽器も、他と同じノートイベントです。`drumVoiceOf` と `DRUM_NOTES` が General MIDI の番号と名前付きのドラム声部を対応づけます。

## 書き出し

逆方向では、ジェネレータが返すパートはすでにノートイベントです。拍をティックに変換し、ホストが決めたチャンネルとプログラムを付けてファイルに書きます。生成されたパートに書き出し形式への依存はありません。

記譜の書き出しでは、`beatsToDuration` と `beatsToTiedDurations` が拍長を音価・付点・連符に変換し、`spellLine` と `spellVoicing` が音名を与えます。[時間とアレンジ](time-and-arrangement.md)と[音高と記譜](pitch-and-notation.md)を参照してください。

## 各国語の音名

音名と調名は5つの体系で読み書きします。解析時は名前から体系を検出し、整形時は既定で英語表記になります。

```ts
import { detectNoteNameSystem, formatKeyName, formatNote, parseKeyName, parseNote } from '@libraz/libcantus';

detectNoteNameSystem('B'); // 'english'
detectNoteNameSystem('gis moll'); // 'german'

const key = parseKeyName('gis moll');
formatNote(key.tonic); // 'G#'
key.mode; // 'minor'

formatKeyName(key); // 'G# minor'
formatKeyName(key, { system: 'german' }); // 'gis moll'
formatNote(parseNote('Bb'), { system: 'german' }); // 'b'
```

体系は `english`、`german`、`japanese`、`italian`、`fixedDo` です。`B` は英語表記とドイツ語表記で実際に曖昧ですが、`detectNoteNameSystem` はドイツ語の変ロではなく英語として解決します。出所の分からない単独の `B` は英語表記であることが圧倒的に多いためです。出所が分かっている場合は `system` を明示的に渡します。

## 移調楽器

移調楽器用に書かれたパートは実音ではありません。解析の前に `toSoundingPitch` で変換し、その奏者のパートを出力する際に `toWrittenPitch` で戻します。[楽器と演奏可能性](instruments-and-playability.md)を参照してください。

## プロジェクトファイルへの保存

- **解析結果**は派生データです。保存せずに再計算します。ホストの要件に対して再計算が遅すぎる場合のみ、元になった音符をキーとするキャッシュとして保存します。
- **生成されたパート**は同じ意味での派生データではありません。再現にはシード、解決後の `algorithmVersion`、ジェネレータの全オプションが必要です。これらを保存し、可能なら出力されたノートも保存します。[決定性とシード](determinism-and-seeding.md)を参照してください。
- **ユーザーの編集を常に優先します。** ユーザーの編集の上に再生成をかけると、その作業は失われます。生成されたパートと編集されたパートは別のオブジェクトとして保持します。

## ライブラリが判断しないこと

冒頭の調を決めること、A セクションを Verse と呼ぶこと、曖昧なコードを作曲者の意図に沿って解釈すること — これらはいずれも読みです。ライブラリは根拠を報告し、読みはホストに委ねます。推定結果を提示する UI は、信頼度をあわせて表示し、上書きできるようにしてください。
