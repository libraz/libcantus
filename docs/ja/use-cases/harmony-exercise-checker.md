# ユースケース: 和声課題チェッカー

四声体の課題の各時点は `Voicing` です。鳴っている音を低い順に並べた値になります。採点の対象は、ある時点から次の時点への進行を、それぞれが実現するコードと課題の調に対して読むことです。

```ts
import { Voicing } from '@libraz/libcantus';

const dominant = Voicing.of([43, 59, 62, 65]);
const tonic = Voicing.of([48, 60, 64, 67]);

const violations = dominant.checkTo(tonic, ['G7', 'C'], 'C major');

violations.map((violation) => violation.kind); // ['unresolvedSeventh']
violations[0]?.voices; // [3]
violations[0]?.rationale; // 'The chordal seventh does not fall by step'

dominant.spell('C major', 'G7').map((note) => note.name); // ['G2', 'B3', 'D4', 'F4']
```

`checkTo` は2つのボイシングを自分で綴ります。各音を、それが属するコードと周囲の調に対して読みます。規則が禁じるものの半分は音高だけでは見えないためです。増2度、減4度、対斜がそれにあたります。`spell` はチェックが実際に読んだ綴りを返します。学習者が判定に異議を唱えたときに示すのはこれです。

各違反は `kind`、関係する声部、2つの位置、そして理由を持ちます。学習者の楽譜の横にそれを表示してください。黙って直してはいけません。

## 課題全体を採点する

`checkTo` が採点するのは1つの進行で、これは学習者が次のコードを書いている最中に UI が確認する単位です。書き上がった課題は、その下にある関数が1回の呼び出しで採点します。すべてのボイシングとコードをまとめて受け取り、各違反をそれがまたぐ組とともに報告します。

学習者自身が書いた綴りを持っているアプリケーションの入口も、こちらです。`checkTo` は音高から出発して綴りを復元しますが、楽譜のエディタは学習者が変イと書いたのか嬰トと書いたのかをすでに知っています。採点できるのはその答えだけです。

```ts
import { Chord, Key, checkPartWriting, parseNote } from '@libraz/libcantus';

const line = (names: string) => names.split(' ').map((name) => parseNote(name));
const key = Key.major('C').scale;
const chords = [Chord.parse('C').data, Chord.parse('Ab').data];

// The same pitches, written two ways:
const asFlats = [line('C3 E3 G3 C4'), line('Ab2 Eb3 Ab3 C4')];
const asSharps = [line('C3 E3 G3 C4'), line('G#2 D#3 G#3 C4')];

checkPartWriting(asFlats, chords, key).map((violation) => violation.kind); // []
checkPartWriting(asSharps, chords, key).map((violation) => violation.kind); // ['crossRelation']
```

この呼び出しが受け取る値は、いずれもクラスが組み立てます。`Key.major('C').scale` と `Chord.parse('C').data` がそれで、周辺を手で組み立てる必要はありません。

## 種目対位法

ここでは `Voicing` が対位声部の旋律線になります。音は声部ごとではなく時間の枠ごとに1つずつ並び、定旋律は音名で渡します。

```ts
import { Voicing } from '@libraz/libcantus';

const counterpoint = Voicing.of([72, 69, 67, 71, 72]);

counterpoint.species(['C4', 'D4', 'E4', 'D4', 'C4'], 1, 'C major'); // []
```

第1種から第4種は音数で対位声部を対応づけます。第5種は音価が混ざるため、定旋律の音を単位とする `opts.durations` が必要です。

## 音を置く途中で確かめる

声部をドラッグしている最中に採点するエディタは、すでに鳴っている声部に対して候補の音を1つ問い合わせます。判定には代わりの音が付き、置ける範囲全体を列挙してヒントとして描くこともできます。

```ts
import { NoteSafety, Voicing } from '@libraz/libcantus';

const sounding = Voicing.of([48, 55, 64]);
const query = { profile: 'strict', chord: 'C', key: 'C major', strongBeat: true } as const;

sounding.safetyOf(72, query).safety === NoteSafety.Safe; // true
sounding.safetyOf(65, query).suggestions; // [64, 67, 60]
sounding.safePitches(query, 60, 72); // [72, 67, 64, 60]
```

## チェッカーが決めない採点上の選択

- **音域**: 4声は `Voicing.satbRanges` に対して判定されます。四声体でない課題では `ranges` を明示的に渡してください。それ以外の声部数では、勝手な音域を作らずに規則を適用しません。
- **間隔**: `maxSpacing` は上3声の隣接間で既定12半音です。カリキュラムに合わせて上下させます。
- **どの規則を見せるか**: すべての違反が `kind` を持ちます。別のチェックを要求するのではなく一覧を絞り込んでください。課程が規則を追加していっても、学習者が目にする語彙が一貫します。

## チェッカーが行わないこと

判定するのは慣用的な声部進行の規則であって、音楽の質ではありません。結果が空であれば規則違反がないという意味であり、違反があること自体はその箇所が誤りであることを意味しません。

課題の意図も決めません。曖昧な答案は、渡されたコード列に対して採点されます。そのコードを選ぶ行為自体が解析です。楽譜の入力、コードの選択、何を誤りとみなすかの判断は、いずれもアプリケーション側に残ります。

この上に教育用の UI を作る場合は、全規則と、1組の声部の1つの進行を判定するための述語をまとめた[対位法と和声課題](../counterpoint-and-part-writing.md)が役立ちます。
