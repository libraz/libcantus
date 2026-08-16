# ユースケース: 和声課題チェッカー

各時点を、低い順に並べた綴られた音の配列として表し、その時点で期待されるコードと組にします。綴りは重要です。MIDI だけの入力では対斜を判定できず、増4度と減5度も区別できません。

```ts
import { Chord, Key, checkPartWriting, parseNote } from '@libraz/libcantus';

const line = (names: string) => names.split(' ').map((name) => parseNote(name));
const key = Key.major('C').scale;

const violations = checkPartWriting(
  [line('G2 B3 D4 F4'), line('C3 C4 E4 G4')],
  [Chord.of('G', 'dom7').data, Chord.of('C', 'maj').data],
  key,
);

violations.every((violation) => typeof violation.rationale === 'string'); // true
violations.every((violation) => violation.fromIndex === 0); // true
```

各結果は `kind`、関係する声部、2つの位置、そして理由を持ちます。学習者の楽譜の横にそれを表示してください。黙って直してはいけません。

## 種目対位法

2声の種目対位法を採点するには、種目の番号とともに `checkSpecies` を呼びます。

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'G4', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)); // []
```

第1種から第4種は音数で対位声部を対応づけます。第5種は音価が混ざるため、定旋律の音を単位とする `opts.durations` が必要です。

## チェッカーが決めない採点上の選択

- **音域**: `range` の規則は4声では `SATB_RANGES` を使います。四声体でない課題では `ranges` を明示的に渡してください。それ以外の声部数では、勝手な音域を作らずに規則を適用しません。
- **間隔**: `maxSpacing` は上3声の隣接間で既定12半音です。カリキュラムに合わせて上下させます。
- **どの規則を見せるか**: すべての違反が `kind` を持ちます。別のチェックを要求するのではなく一覧を絞り込んでください。課程が規則を追加していっても、学習者が目にする語彙が一貫します。

## チェッカーが行わないこと

判定するのは慣用的な声部進行の規則であって、音楽の質ではありません。結果が空であれば規則違反がないという意味であり、違反があること自体はその箇所が誤りであることを意味しません。

課題の意図も決めません。曖昧な答案は、渡されたコード列に対して採点されます。そのコードを選ぶ行為自体が解析です。楽譜の入力、コードの選択、何を誤りとみなすかの判断は、いずれもアプリケーション側に残ります。

この上に教育用の UI を作る場合は、全規則と、音をドラッグしている最中に1つの進行を判定するための述語をまとめた[対位法と和声課題](../counterpoint-and-part-writing.md)が役立ちます。
