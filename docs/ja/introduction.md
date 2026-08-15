# はじめに

`@libraz/libcantus` は、すでにノートやコード記号を持っているソフトウェアのための TypeScript 音楽理論エンジンです。MIDI ピッチ、綴られた音名、コード、キー、時間付きノートイベントを扱います。MIDI ファイルの入出力、記譜、音声解析、再生は行いません。

## モデル

- `Note`、`Chord`、`Key`、`Progression` は不変のクラス API とプレーンデータの両方を持ちます。
- コレクションとタイムラインは `NoteEvent` 配列を受け取る純粋関数で扱います。

両者は混在できます。クラスの `.data` はプレーンな値であり、解析・生成結果はそのまま次の処理へ渡せます。

```ts
import type { NoteEvent } from '@libraz/libcantus';

const note: NoteEvent = { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 96 };
```

`startBeat` が負なら弱起です。`velocity` と `articulation` は時間モデルを変えずに演奏情報を加えます。

## レイヤー

| サブパス | 内容 |
| --- | --- |
| `core` | 音高、音程、拍子、テンポ、音律、検証、楽器情報 |
| `theory` | スケール、コード、綴り、和声規則、ボイシング |
| `analyze` | コード・キー検出、タイムライン、形式、アレンジ解析 |
| `generate` | 進行、モチーフ、リズム、ドラム、ベース、対旋律 |
| `model` | 不変の `Note`、`Interval`、`Chord`、`Key`、`Progression` |

和声解析は 12 のピッチクラスで動きます。周波数、セント、EDO、純正律は `core` で扱えますが、微分音のピッチクラス解析は対象外です。綴りが意味を持つ場面では、パートライティング・対位法・声部綴りは音名またはキー文脈を保ちます。
