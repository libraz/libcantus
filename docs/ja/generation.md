# 生成

生成関数は、キー、タイムライン、モチーフ、リズムからノートイベントを作ります。同じ seed とオプションなら結果は決定的です。

## 進行とモチーフ

```ts
import { generateMotif, generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
generateProgression({ key, style: 'idol', bars: 8, reharmonize: true, seed: 1 });
generateMotif({ key, bars: 2, contour: 'arch', seed: 1 });
```

`generateRhythm`、`motifToNoteEvents`、`developMotif`、`transformMotif` は素材選択、配置、変形を分けて使えます。

## パートと装飾

ベース、対旋律、ドラム、装飾は共通のノートイベントモデルを使います。

```ts
import { generateDrums, ornament } from '@libraz/libcantus';

generateDrums({
  bars: 4, style: 'funk', section: 'chorus',
  ctx: { seed: 1, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});
const notes = [60, 62, 64, 65].map((pitch, i) => ({ pitch, startBeat: i * 0.5, durationBeat: 0.5 }));
ornament(notes, { style: 'ghost', amount: 0.6, seed: 4 });
```

`generateBassLine`、`generateCounterMelody`、`imitate`、`harmonizeMelody`、`applyGrooveTemplate` もよく使う処理です。装飾は既存の素材にかける別操作です。

## 文脈と再現性

`GenerationContext` は seed、テンポ、楽器、語彙、複雑さ、難易度を持ちます。`complexity` の各値は 0..1、`difficulty` は 1..5 です。数値の文脈 `1` は `{ seed: 1 }` の省略形で、位置から導く乱数と `algorithmVersion` により生成契約を固定できます。

## 楽器制約

`InstrumentProfile` は音域と物理制約を表します。`canSound`、`foldIntoRange`、`playability` で生成結果を検査・調整できます。

```ts
import { GUITAR_DROP_D, GUITAR_STANDARD, canSound } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
```
