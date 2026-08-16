# はじめに

`@libraz/libcantus` は、すでにノートやコード記号を持っているソフトウェアのための TypeScript 音楽理論エンジンです。MIDI ピッチ、綴られた音名、コード仕様、調、時間付きノートイベントを扱います。MIDI ファイルの読み書き、記譜の描画、音声解析、再生は行いません。

パッケージに実行時依存はなく、すべての入り口が同期的で、返る値はすべて JSON 互換のプレーンデータです。

## モデル

公開されている操作は2種類あります。

- `Note`、`Chord`、`Key`、`Progression` などの値は、不変のクラスラッパーとプレーンデータの両方の形を持ちます。
- コレクションとタイムラインは、`NoteEvent` の配列に対する純粋関数で扱います。

両者は組み合わせて使えます。クラスは `.data` でプレーンな値を公開し、解析や生成の関数が返すデータは、そのまま別の関数に渡すことも、クラスで包むこともできます。

`NoteEvent` は MIDI ピッチと4分音符を単位とする拍で表します。

```ts
import type { NoteEvent } from '@libraz/libcantus';

const note: NoteEvent = {
  pitch: 60,
  startBeat: 0,
  durationBeat: 1,
  velocity: 96,
};
```

`startBeat` が負の値ならアウフタクトを表します。任意の `velocity` と `articulation` は、時間モデルを変えずに演奏情報を加えます。

## レイヤー

パッケージのルートは公開 API 全体をエクスポートします。同じエクスポートは5つのサブパスにも分かれています。

| サブパス | 対象 |
| --- | --- |
| `@libraz/libcantus/core` | 音高、音程、拍子、テンポ、音律、検証、楽器データ |
| `@libraz/libcantus/theory` | スケール、コード、綴り、和声規則、ボイシング |
| `@libraz/libcantus/analyze` | コード・調の検出、タイムライン、形式、アレンジ解析 |
| `@libraz/libcantus/generate` | 進行、モチーフ、リズム、ドラム、ベース、対旋律 |
| `@libraz/libcantus/model` | 不変の `Note`、`Interval`、`Chord`、`Key`、`Progression` クラス |

レイヤーは積み重なっています。`theory` は `core` の上に、`analyze` は `theory` の上に、`generate` はその3つの上に構築されています。サブパスからのインポートはパッケージングの選択であり、別の API ではありません。

## 3つの原則

**解析は根拠を報告し、判断は下しません。** コードタイムラインは信頼度を、調区間は相関を、縮約は理由を、違反は破られた規則を持ちます。読みが本当に曖昧な場合、結果はそのことを示します。1つを選んで曖昧さを隠すことはしません。

**検査は書き換えません。** `checkPartWriting` は課題の誤りを報告し、課題そのものは変更せずに返します。`playability` は楽節を演奏できるかを答え、何も編集しません。書き換えを行うのはジェネレータで、入力を変更せずに新しい素材を返します。

**生成は再現可能です。** シードとアルゴリズムバージョンを固定すれば、そのバージョンを受け付けるどのビルドからも同じ音が得られます。乱数は呼び出し順ではなく位置で指定されるため、パラメータを1つ変えても、それ以降が引き直しになりません。

## エンジンの前提

ピッチ層より上の解析は12のピッチクラスで動作します。周波数、セント、オクターブの等分平均律、純正律の比は `core` で扱えますが、和声解析は微分音のピッチクラスをモデル化しません。

機能和声は、それが成り立つ調性素材を対象とします。ローマ数字や終止の読みを適用する前に、`supportsFunctionalHarmony` で対象のスケールを確認できます。全音音階など機能和声が成り立たないスケールに対する正しい答えは、その解析が適用できないということです。

綴りが意味を持つ場面では、エンジンは綴りの情報を保ちます。減5度と増4度はピッチクラス上の距離が同じですが、書かれた音程としては別物です。そのため和声課題、対位法、旋律の綴りは、すべてを数値に還元せず、綴られた音または調の文脈を受け取ります。

## 次に読むページ

- [はじめかた](getting-started.md) — インストールと最初の動く例。
- [ユースケース](use-cases/index.md) — アプリケーションが手元に持つデータから始まる一連の流れ。
- 各領域のページ（おおよそ深さ順）: [音高と記譜](pitch-and-notation.md)、[スケールとモード](scales-and-modes.md)、[和声](harmony.md)、[調関係と転調](key-relations-and-modulation.md)、[ボイシング](voicing.md)、[対位法と和声課題](counterpoint-and-part-writing.md)、[時間とアレンジ](time-and-arrangement.md)、[解析](analysis.md)、[旋律とモチーフ](melody-and-motifs.md)、[リズムとグルーヴ](rhythm-and-groove.md)、[生成](generation.md)、[リハーモナイズ](reharmonization.md)、[楽器と演奏可能性](instruments-and-playability.md)、[音律と周波数](tuning-and-frequency.md)。
- 横断的な話題: [決定性とシード](determinism-and-seeding.md)、[エラーと検証](errors-and-validation.md)、[パフォーマンス](performance.md)、[相互運用](interoperability.md)。
- リファレンス: [API リファレンス](api-reference.md)、[用語集](glossary.md)、[疑問と制限](faq.md)。
