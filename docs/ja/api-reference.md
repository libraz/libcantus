# API リファレンス

手書きのガイドはモデルと典型的な使い方を説明します。シンボル単位の完全なリファレンスは、公開エントリポイントから TypeDoc が生成します。

## インポートパス

パッケージのルートは、公開されている全レイヤーを再エクスポートします。

```ts
import { Chord, Key, detectKey, generateMotif, parseNote } from '@libraz/libcantus';
```

境界を絞りたい場合はレイヤーのサブパスを使います。

```ts
import { parseNote, parseTimeSignature } from '@libraz/libcantus/core';
import { majorKey, scaleByName } from '@libraz/libcantus/theory';
import { detectKey, chordTimelineFromNotes } from '@libraz/libcantus/analyze';
import { generateBassLine, generateMotif } from '@libraz/libcantus/generate';
import { Chord, Key, Note } from '@libraz/libcantus/model';
```

公開されている入り口は次のとおりです。

- `core`: 音高、音程、拍子、音価、テンポ、音律、検証、乱数ユーティリティ、楽器プロファイル。
- `theory`: スケール、コード仕様、記号、綴り、機能規則、対位法、通奏低音、ボイシング。
- `analyze`: コード・調の検出、和声解析、タイムライン、縮約、旋律解析、形式、アレンジのレポート。
- `generate`: 進行、ベース、対旋律、ドラム、グルーヴ、和音付け、モチーフ、装飾、リズム、リハーモナイズ、vocabulary。
- `model`: 音、音程、コード、調、進行の不変ラッパー。

各レイヤーのバレルは、自身のシグネチャが名指す型も再エクスポートします。1つのサブパスだけをインポートした場合でも、そこで使う API のすべての型を書けます。

CommonJS と ESM の両方のビルドを配布し、それぞれに TypeScript の型宣言が付属します。

## 領域とページの対応

| 領域 | ページ |
| --- | --- |
| 音、音程、綴り | [音高と記譜](pitch-and-notation.md) |
| スケール、旋法、コードスケール | [スケールとモード](scales-and-modes.md) |
| コード、ローマ数字、機能 | [和声](harmony.md) |
| 調関係、転調 | [調関係と転調](key-relations-and-modulation.md) |
| 四声体とスタイル付きボイシング | [ボイシング](voicing.md) |
| 和声課題・種目対位法のチェッカー | [対位法と和声課題](counterpoint-and-part-writing.md) |
| 拍子、テンポ、アレンジ | [時間とアレンジ](time-and-arrangement.md) |
| 検出、タイムライン、形式 | [解析](analysis.md) |
| モチーフ、輪郭、対旋律 | [旋律とモチーフ](melody-and-motifs.md) |
| リズム、グルーヴ、ドラム | [リズムとグルーヴ](rhythm-and-groove.md) |
| 進行、パート、装飾 | [生成](generation.md) |
| 代理和音と和音付け | [リハーモナイズ](reharmonization.md) |
| プロファイル、演奏可能性、移調楽器 | [楽器と演奏可能性](instruments-and-playability.md) |
| 周波数、セント、EDO、純正比 | [音律と周波数](tuning-and-frequency.md) |
| シード、つまみ、アルゴリズムバージョン | [決定性とシード](determinism-and-seeding.md) |
| エラー分類、パーサ、表明 | [エラーと検証](errors-and-validation.md) |
| インデックス、セッション、予算 | [パフォーマンス](performance.md) |
| MIDI、ティック、各国語の音名 | [相互運用](interoperability.md) |

## 生成される TypeDoc

リポジトリのスクリプトで完全な API リファレンスを生成します。

```sh
yarn docs
```

TypeDoc は出力を `docs/api` に書き出します。この生成ディレクトリは、`docs/en` と `docs/ja` にある2言語の手書きガイドとは別物です。生成されたページを手で編集しないでください。

パラメータ、返り値、カテゴリ、例のリファレンスはソースのコメントです。生成されたリファレンスは、プロジェクトの API リファレンスのバッジからも公開されています。

## 例の検証

英語ガイドの `ts` コードブロックはすべて抽出されてテストスイートで実行され、末尾の `// 値` コメントがリテラルであれば期待値として検証されます。日本語ページは同じブロックをそのまま持ち、同じスイートがその一致を検証します。ここに載っている例は、いずれも実行されたものです。
