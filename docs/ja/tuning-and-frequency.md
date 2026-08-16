# 音律と周波数

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

`JUST_RATIOS` は、ユニゾンから上の12種類の音程クラスについて5リミットの比を半音数で引ける形で保持します。`justDeviationCents` は、平均律の各音程が純正からどれだけ離れているかを返します。

```ts
import { JUST_RATIOS, justDeviationCents, ratioToCents } from '@libraz/libcantus';

JUST_RATIOS[7]; // [3, 2]
Math.round(ratioToCents(3, 2) * 1000) / 1000; // 701.955
Math.round(justDeviationCents(7) * 100) / 100; // 1.96
Math.round(justDeviationCents(4) * 100) / 100; // -13.69
```

値が正の場合、純正音程のほうが平均律より広いことを表します。平均律の5度は純正5度より約2セント狭く、平均律の長3度は純正長3度より約14セント広くなります。後者の差が、持続した和音でうなりとして聞こえます。

## アプリケーションでの用途

- **チューナー・音程表示**: 正確な位置に `stepOf`、針の振れに `centsFromNearestStep`、ラベルに `midiToNote`。
- **微分音の再生**: 呼び出し側が組んだ `TuningTable` に `frequencyOf`、または12音のピッチを曲げる場合は `centsToRatio`。
- **合成・解析との橋渡し**: 検出した周波数を `nearestStep` で量子化し、ライブラリの他の部分が読めるピッチにします。
- **資料・教材**: 平均律の音程がうなる理由を示すのに `justDeviationCents`。

周波数を `nearestStep` で MIDI ピッチに変換してから解析にかける流れは通常の用法です。逆に、12以外のステップ番号をコードや調の解析へ渡した場合、結果は返りますが意味を持ちません。
