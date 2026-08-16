# @libraz/libcantus

MIDI ノートイベントを扱う、TypeScript 製の音楽理論ライブラリです。コードの組み立てと綴り、和声とキーの解析、曲の形式の読み取り、パート生成を同じデータモデルで行えます。実行時依存はありません。

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus)](https://www.npmjs.com/package/@libraz/libcantus)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![docs](https://img.shields.io/badge/docs-API%20reference-b5892e)](https://libraz.github.io/libcantus/)

## できること

すでにノートやコード記号を持っているソフトウェア（DAW のプロジェクト、MIDI パーサー、練習支援ツールなど）と、その音が和声的に何を意味するかとの間を埋めます。ノートイベントを渡せば和声が求まり、その和声を渡せばそれに沿ったパートが書けます。

```ts
import { Composer, Score } from '@libraz/libcantus';

// DAW から渡ってくる形の、4 小節のブロックコード:
const harmony = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const chords = Score.of(harmony).timeline();
chords.roman().map((entry) => entry.roman); // ['I', 'IV', 'V7', 'I']
chords.cadences().at(-1)?.cadence.type; // 'authentic'

// 求まった和声の上に、ウォーキングベースを書く:
Composer.of({ key: chords.key, bpm: 120, seed: 1 }).bass(chords, { style: 'walking' }).notes;
// 16 音: [{ pitch: 36, startBeat: 0, durationBeat: 1, velocity: 100 }, ...]
```

コードの境界は決め打ちせずに探索し、キーも同様に探します。転調する曲を、冒頭のキーのまま読み続けることはありません。

各レイヤーが受け持つ範囲は次のとおりです。

- **[音高と記譜](docs/ja/pitch-and-notation.md)** — 綴りを保った音名と音程、MIDI 変換、英語・ドイツ語・日本語・イタリア語・固定ドでの読み書き、そして 1 音ずつではなく声部全体を 1 本の経路として解く綴り付け。テキストのパーサーにはいずれも例外を投げない対 (`tryParseNote`、`tryParseInterval`、`tryParseChordSymbol`、`tryParseKeyName`、`tryParseTimeSignature`、および `Note`・`Interval`・`Key`・`Chord` の `tryParse`) があるので、入力欄の 1 打鍵ごとに `try`/`catch` を書く必要はありません。
- **[和声](docs/ja/harmony.md)** — 構造を持つ値としてのコード、教会旋法やペンタトニックに加えて `WORLD_SCALES` を含むスケール、ローマ数字と和声機能、ヴォイシング、数字付き低音、そして違反した声部と理由まで返す声部書法・種目対位法のチェッカー。
- **[解析](docs/ja/analysis.md)** — ノートイベントからのコード・キー検出、タイムラインとカデンツ、和声的な還元、フレーズ、セクション、ハイパーメーター、モチーフ、アレンジ全体のレポート。
- **[生成](docs/ja/generation.md)** — プログレッション、モチーフ、リズム、ドラム、ベース、対旋律。いずれも 1 つの `GenerationContext` を参照します。プロジェクトのシード、加算的な 3 つの複雑さのダイヤル（リズム・和声・装飾）、それとは別枠の難易度の上限、テンポ、各パートの対象楽器がそこに入ります。同じコンテキストからは同じ結果が出ます。
- **[時間とアレンジ](docs/ja/time-and-arrangement.md)** — 拍子、テンポ、小節と拍による位置、複数トラックをまたぐ解析。

答えには、そう読んだ理由が付きます。`analyzeChord`、`detectCadence`、`explainRoman` は `rationale` を必ず返し、`detectKey` は要求があれば付けます。いずれも、退けた解釈を `alternatives` として報告できます。渡された情報だけでは決まらない場合、それらしい答えを作らずに `null` を返します。カデンツが完全か不完全かはヴォイシングがなければ決まりません。ソプラノに何があるかはヴォイシングだけが答えられるからです。

答えを左右する場面では、綴りの情報を落としません。減 5 度と増 4 度はピッチクラス上の距離が同じでも同じ音程ではないので、声部書法と対位法のチェッカーは数値ではなく綴られた音を受け取ります。

アプリケーションが手元に持っているデータから始まるガイドが 7 本あります。[DAW との連携](docs/ja/use-cases/daw-workflow.md)、[曲の解析](docs/ja/use-cases/piece-analysis.md)、[転調レポート](docs/ja/use-cases/modulation-report.md)、[和声課題のチェック](docs/ja/use-cases/harmony-exercise-checker.md)、[生成によるアレンジ](docs/ja/use-cases/generative-arrangement.md)、[コード譜の取り込み](docs/ja/use-cases/chord-chart-import.md)、[パートの準備](docs/ja/use-cases/part-preparation.md)です。

## やらないこと

- **入出力・記譜・音声を扱いません。** MIDI ファイルの読み書き、楽譜の描画、音声解析、再生はありません。パーサーは各自で用意し、ノートイベントとして渡してください。その層こそが必要なら、[libsonare](https://github.com/libraz/libsonare) が音声解析、マスタリング、合成、SMF 入出力を扱います。両者はコードを共有せず、どちらも相手を必要としません。
- **微分音の解析はしません。** 周波数、セント、オクターブの等分割、純正律の比は `core` にありますが、音高より上の層はすべて 12 のピッチクラスで動きます。半音より細かい単位で組み立てられた音楽は範囲外です。半フラットの音度を持つマカームを 12 音の近い音で代用せず `WORLD_SCALES` から外しているのも、同じ理由です。
- **旋法体系そのものは扱いません。** `WORLD_SCALES` が収録するのは、thāt やマカーム、日本の音階といった伝統が名を与えた音組織であって、その上に立つ体系ではありません。上行形と下行形、フレーズが寄りかかる音、旋律型の文法は、マスクには入りません。
- **調性を前提にしません。** ローマ数字と機能和声は西洋の慣習を前提とします。その読み方が適用できるスケールかどうかは `supportsFunctionalHarmony` が答えます（`'dorian'` は真、`'miyakoBushi'` は偽）。
- **コーパスは持ちません。** 統計を取るためのデータは同梱していません。
- **機能和声には既知の穴があります。** `functionOf` は和音と調だけから答えるため、終止四六の和音はその層では主和音の転回として読まれます。属和音としての読みは時間軸を見る層のものであり、属和音の前の和音を `approach` として渡したときに `detectCadence` がそれを示します。

## 要件

Node.js >= 22。

## インストール

```sh
yarn add @libraz/libcantus
```

## 最初の例

理論の本体はツリーシェイク可能な純粋関数にあります。その上に、理論を語るときの言い方に近い不変のクラス API（`Note`、`Interval`、`Chord`、`Key`、`Progression`）が乗っています。

```ts
import { Chord, Key } from '@libraz/libcantus';

const key = Key.major('C');
const dominant = key.chord(5, 'dom7');

dominant.symbol(); // 'G7'
dominant.analyze(key).roman; // 'V7'
Chord.parse('C7(b9,#11)').pitchClasses(); // [0, 1, 4, 6, 7, 10]
```

本体は関数で、クラスはいずれもその薄い外皮です。クラスは `.data` でプレーンな値を公開し、関数が返したデータからクラスを作れます。どちらかが閉じた世界になることはなく、返す答えも同じです。クラスが足すのは、値とその文脈をひとまとめに保持することです。呼び出しを連ねるときに同じ事実を書き直さずに済みます。`Score` は音符と拍子・テンポ・調をまとめて持ち、`Composer` は 1 曲を書くときの調・テンポ・シードを持ちます。

## インポートパス

ルートからすべてを export しています。1 つのレイヤーだけを取り込みたい場合は、サブパスを使ってください。

```ts
import { parseNote, edo } from '@libraz/libcantus/core'; // 音高、拍子、テンポ、音律
import { majorKey, makeChord } from '@libraz/libcantus/theory'; // スケール、コード、ヴォイシング、規則
import { analyzeArrangement, detectKey } from '@libraz/libcantus/analyze';
import { generateDrums, generateProgression } from '@libraz/libcantus/generate';
import { Chord, Key, Note } from '@libraz/libcantus/model'; // クラス API
```

いずれのパスにも ESM と CommonJS の両方のビルドがあります。

## ドキュメント

最初に読むページ: [概要](docs/ja/introduction.md)、[使い始める](docs/ja/getting-started.md)、[ユースケース](docs/ja/use-cases/index.md)。

各領域のガイド: [音高と記譜](docs/ja/pitch-and-notation.md)、[スケールとモード](docs/ja/scales-and-modes.md)、[和声](docs/ja/harmony.md)、[調関係と転調](docs/ja/key-relations-and-modulation.md)、[ボイシング](docs/ja/voicing.md)、[対位法と和声課題](docs/ja/counterpoint-and-part-writing.md)、[時間とアレンジ](docs/ja/time-and-arrangement.md)、[解析](docs/ja/analysis.md)、[旋律とモチーフ](docs/ja/melody-and-motifs.md)、[リズムとグルーヴ](docs/ja/rhythm-and-groove.md)、[生成](docs/ja/generation.md)、[リハーモナイズ](docs/ja/reharmonization.md)、[楽器と演奏可能性](docs/ja/instruments-and-playability.md)、[音律と周波数](docs/ja/tuning-and-frequency.md)。

横断的な話題: [決定性とシード](docs/ja/determinism-and-seeding.md)、[エラーと検証](docs/ja/errors-and-validation.md)、[パフォーマンス](docs/ja/performance.md)、[相互運用](docs/ja/interoperability.md)。

リファレンス: [API リファレンス](docs/ja/api-reference.md)、[用語集](docs/ja/glossary.md)、[疑問と制限](docs/ja/faq.md)。

これらのガイドの `ts` の例はすべてテストスイートで実行され、末尾コメントに書いた期待値は実際の返り値と照合されます。生成される TypeDoc のリファレンスは `docs/api` に出力され、手書きガイドとは分かれています。

## ライセンス

[@libraz/libcantus](https://github.com/libraz/libcantus) は [Apache License 2.0](LICENSE) で提供します。
