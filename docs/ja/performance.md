# パフォーマンス

このライブラリはすべて同期・シングルスレッドで動作します。呼び出しは中断される前に返るため、問題になるのは各入り口がどれだけの仕事をするかと、ホストがそれを繰り返さない方法です。

## コストの所在

| 処理 | おおよそのコスト |
| --- | --- |
| 音高・音程・コード・スケールの演算 | 定数時間。12ビットマスクのビット操作です。 |
| `detectChord`、`detectKey` | 候補集合に比例。候補数は固定です。 |
| `chordTimelineFromNotes` | 音符とウィンドウの帰属数に比例。各音符は自身が鳴るウィンドウでのみ読まれ、ウィンドウ数は範囲と和声リズムから決まります。 |
| `keyTimelineFromNotes`、`detectModulations` | 同じ計算量を `minKeyBeats` のスロット単位で行い、加えてスロットごとに固定24候補の探索を行います。 |
| `voiceChord` | `maxCandidates`（既定4000）で上限が決まります。 |
| `voiceProgression` | コード数に比例。1コードあたりの探索に上限があるためです。 |
| `analyzeArrangement` | 和声トラックを平坦化したタイムライン処理が支配的です。 |
| 各ジェネレータ | 要求した小節数に比例します。 |

いずれも音符数に対して2乗で増えることはありませんが、長い曲全体のアレンジ解析は相応の仕事量です。1打鍵ごとに実行すれば体感に現れます。

## ノートイベントのインデックス

`createNoteEventIndex` は検査と安定ソートを一度だけ行い、以降は発音位置と鳴っている音の問い合わせに対数時間で答えます。

```ts
import { createNoteEventIndex } from '@libraz/libcantus';

const notes = [
  { pitch: 60, startBeat: 0, durationBeat: 2 },
  { pitch: 64, startBeat: 1, durationBeat: 2 },
  { pitch: 67, startBeat: 4, durationBeat: 1 },
];

const index = createNoteEventIndex(notes);

index.at(1.5)?.note.pitch; // 64
index.attacksAt(4); // true
index.attacksAt(3); // false
index.onsetsBetween(0, 5); // [1, 4]
```

変化しない1組の音符に対して位置の問い合わせを多数行う場合に使います。再生位置の表示、ホバー時の情報表示、拍ごとの注釈付けなどです。問い合わせが1回だけなら、線形走査のほうが安く済みます。

長さが正でない音符は、後で除外する呼び出し側のために保持されることがありますが、鳴っている音として数えられることはありません。

## アレンジ解析の差分更新

`createArrangementSession` は解析を編集をまたいで保持し、編集が影響し得る範囲だけを再解析します。

```ts
import { createArrangementSession } from '@libraz/libcantus';

const session = createArrangementSession([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
]);

const edited = session.update([
  {
    trackIndex: 0,
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
      { pitch: 65, startBeat: 4, durationBeat: 4 },
    ],
  },
]);

edited.analysis.timeline.segments.length >= 1; // true
session.analysis.timeline.segments.length >= 1; // true
```

結果は、編集後のトラックに対して `analyzeArrangement` を実行した場合と一致します。セグメント、信頼度、調区間、終止、注釈、衝突のいずれも同じであるため、セッションを長時間保持しても、その時点で新規に解析した結果からずれることはありません。差分の結果が信頼できない場合は、近似を返さずに全体の解析へ切り替えます。

`update` は新しいセッションを返し、元のセッションはそのまま残ります。アンドゥスタックが必要とするのはこの形で、前のセッションオブジェクトを保持しておけば、アンドゥは参照の差し替えで済みます。

音符は値として、かつ多重度も含めて比較されます。トラックの配列を並べ替えただけでは編集として扱われず、同じ音符をもう1つ追加した場合は編集として扱われます。

## 仕事量を明示的に制限する

上限のない要求を受け取り得る入り口は、予算を受け取ります。

- `chordTimelineFromNotes`、`keyTimelineFromNotes`、`detectModulations`、`voiceProgression` の `budget` は、入力または探索の規模を制限します。
- `voiceChord` と `voiceProgression` の `maxCandidates` は、1コードあたりの探索を制限します。上げると、時間と引き換えに最適解へ近いボイシングが得られます。
- `DEFAULT_GENERATION_BUDGET` が既定の上限で、超過するとブロックせずに `BudgetExceededError` を投げます。

これらの失敗の報告方法は[エラーと検証](errors-and-validation.md)を参照してください。

## UI の応答性を保つ

- 解析は編集の後ろでデバウンスし、1打鍵ごとに走らせません。
- アレンジ解析にはセッションを、位置の反復的な問い合わせにはインデックスを使います。
- 入力を絞ります。`chordTimelineFromNotes` は曲全体より画面上の小節だけのほうが速く、既にコードが分かっているホストは推定し直さずに `chordTimelineFromChords` を呼びます。
- 時間のかかる解析はワーカーへ移します。入出力はすべて JSON 互換のプレーンデータであるため、構造化クローンでワーカー境界を越えられ、復元処理は不要です。

## 計測

リポジトリにはタイムラインインデックスのベンチマークがあります。

```sh
yarn bench:timeline
```

先にパッケージをビルドし、ビルド後の出力に対して実行します。アプリケーションが実際に読み込むコードと同じものを測ります。
