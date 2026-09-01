# 音律と周波数

音楽用語になじみがない場合は、入門編の[音高と音程](primer/pitch-and-intervals.md)がこのページで使う用語を説明します。

ピッチ層より上はすべて12個のピッチクラスで扱います。これは調性理論に範囲を絞るための意図的な設計です。このモジュールは、その範囲から外れる対象 — 実際の周波数、セント、12以外の平均律、平均律の背後にある純正比 — を扱います。

ここにある値は和声解析には戻りません。19-EDO のステップ番号はピッチクラスではなく、`detectKey` が読み取ることもありません。

## 周波数

`TuningTable` は基準ピッチとオクターブの等分数から成ります。12等分ではステップ番号がそのまま MIDI ノート番号になるため、既定値はどこでも `TWELVE_TET` です。

```ts
import { frequencyOf, nearestStep, stepOf, TWELVE_TET } from '@libraz/libcantus';

TWELVE_TET; // { refStep: 69, refFreq: 440, divisions: 12 }

frequencyOf(69); // 440
Math.round(frequencyOf(60) * 100) / 100; // 261.63
nearestStep(440); // 69
Math.round(stepOf(442) * 100) / 100; // 69.08
```

`nearestStep` は丸め、`stepOf` は丸めません。音名表示に必要なのは前者で、チューナー表示に必要なのは後者です。音高のずれを見る場面では小数部分が主要な情報になります。

基準ピッチの変更は移調ではなく、基準周波数の変更として表します。

```ts
import { edo, frequencyOf } from '@libraz/libcantus';

const a442 = edo(12, 442);
frequencyOf(69, a442); // 442
```

## セント

セントは対数尺の単位で、音域が異なってもチューニングの差を比較できます。変換は4方向あり、ホストが必要とする経路を覆っています。

```ts
import { centsBetweenFreq, centsFromNearestStep, centsOfSteps, centsToRatio } from '@libraz/libcantus';

centsOfSteps(1); // 100
Math.round(centsBetweenFreq(440, 880)); // 1200
Math.round(centsFromNearestStep(442)); // 8
Math.round(440 * centsToRatio(1200)); // 880
```

周波数にセントのオフセットを適用するのが `centsToRatio` で、ピッチベンドの指定やチューニングテーブルの値を実際の音高に変換します。逆方向、つまりセント値から小数ステップ数を求めるのが `stepsOfCents` です。

## 12以外の平均律

`edo(n)` は n 等分平均律を作ります。n が12でない場合、ステップ番号は MIDI 番号ではなくなるため、呼び出し側のデータモデルでは両者を区別する必要があります。

```ts
import { centsOfSteps, edo, frequencyOf } from '@libraz/libcantus';

const et19 = edo(19);
et19.divisions; // 19
Math.round(centsOfSteps(1, et19) * 100) / 100; // 63.16
Math.round(frequencyOf(69 + 19, et19)); // 880
```

19-EDO でも19ステップで1オクターブになります。基準ステップとオクターブは固定で、変わるのはその間の刻みだけです。

## 純正律

純正音程とは、2つの周波数が小さな整数比になる音程のことで、伴奏のないアンサンブルが寄っていく先であり、平均律が転調の自由と引き換えに手放したものです。`JUST_RATIOS` は各半音数に対する5リミットの比を保持します。0 から 12 までの13個で、ユニゾンの `[1, 1]` からオクターブの `[2, 1]` までです。型がキーをこの13個に絞るため、範囲外の添字は実行時の `undefined` ではなくコンパイルエラーになります。`justDeviationCents` は、平均律の各音程が純正からどれだけ離れているかを返します。

```ts
import { JUST_RATIOS, justDeviationCents, ratioToCents } from '@libraz/libcantus';

JUST_RATIOS[7]; // [3, 2]
Math.round(ratioToCents(3, 2) * 1000) / 1000; // 701.955
Math.round(justDeviationCents(7) * 100) / 100; // 1.96
Math.round(justDeviationCents(4) * 100) / 100; // -13.69
```

値が正の場合、純正音程のほうが平均律より広いことを表します。平均律の5度は純正5度より約2セント狭く、平均律の長3度は純正長3度より約14セント広くなります。後者の差が、持続した和音でうなりとして聞こえます。

## Tuning クラス

`TuningTable` は基準ステップ・基準周波数・等分数から成る素のデータで、`Tuning` はそれを包むクラスです。

ここまでの関数は2つのグループに分かれます。ステップと周波数の変換 — `frequencyOf`、`nearestStep`、`stepOf`、`centsFromNearestStep`、`stepsOfCents`、`centsOfSteps` — は、最後の引数として音律のテーブルを任意で取り、既定は `TWELVE_TET` です。比の変換 — `centsToRatio`、`centsBetweenFreq`、`ratioToCents`、`justDeviationCents` — は音律に左右される判断を含まないため、テーブルを取りません。クラスも同じ分け方に従い、テーブルを一度束縛して、前者をメソッド、後者を静的メソッドとして提供します。

```ts
import { Tuning } from '@libraz/libcantus';

const tuning = Tuning.twelveTet();

tuning.frequencyOf('A4'); // 440
Math.round(tuning.frequencyOf('C4') * 100) / 100; // 261.63
tuning.nearestStep(440); // 69
Math.round(tuning.centsFromNearestStep(442)); // 8
```

`frequencyOf` はライブラリの他の箇所と同じ形で音を受け取ります。音名、MIDI 番号、素のノートデータ、`Note` のいずれでも渡せるため、表示側で `noteToMidi` を挟む必要がありません。ステップ番号から同じ答えを得るのが `frequencyOfStep` で、12音の音名が付かない音律ではこちらを使います。

微分音を扱うホストは、音律を一度束縛してすべてをそのオブジェクトに問い合わせます。

```ts
import { Tuning } from '@libraz/libcantus';

const et19 = Tuning.edo(19);

et19.divisions; // 19
Math.round(et19.centsOfSteps(1) * 100) / 100; // 63.16
Math.round(et19.frequencyOfStep(69 + 19)); // 880
et19.toString(); // '19-EDO (step 69 = 440 Hz)'
```

音律に依存しない変換は静的メソッドのままです。また、`data` が返す素のテーブルを経由して往復できます。

```ts
import { Tuning } from '@libraz/libcantus';

Math.round(Tuning.ratioToCents(3, 2)); // 702
Math.round(Tuning.justDeviationCents(4) * 100) / 100; // -13.69
Tuning.edo(12, 442).data; // { refStep: 69, refFreq: 442, divisions: 12 }
Tuning.fromData(Tuning.edo(19).data).equals(Tuning.edo(19)); // true
```

## アプリケーションでの用途

- **チューナー・音程表示**: 正確な位置に `stepOf`、針の振れに `centsFromNearestStep`、ラベルに `midiToNote`。
- **微分音の再生**: 呼び出し側が組んだ `TuningTable` に `frequencyOf`、または12音のピッチを曲げる場合は `centsToRatio`。
- **合成・解析との橋渡し**: 検出した周波数を `nearestStep` で量子化し、ライブラリの他の部分が読めるピッチにします。
- **資料・教材**: 平均律の音程がうなる理由を示すのに `justDeviationCents`。

いずれも束縛済みの `Tuning` のメソッドとしても呼べます。1つの音律で動くホストではこの一覧がそのまま短くなり、`Tuning.edo(19)` を一度作ったあとは `stepOf`、`centsFromNearestStep`、`frequencyOf` をそのオブジェクトに対して呼ぶだけになります。

周波数を `nearestStep` で MIDI ピッチに変換してから解析にかける流れは通常の用法です。逆に、12以外のステップ番号をコードや調の解析へ渡した場合、結果は返りますが意味を持ちません。
