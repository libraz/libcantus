# リハーモナイズ

リハーモナイズは、何か1つを固定したまま — メロディ、ベース、機能、あるいは長さだけ — その下のコードを置き換える処理です。このライブラリは代理和音を理由付きの提案として返すため、ホストはそれを提示してユーザーに選ばせられます。

## 1つのコードに対する代理

`substituteChord` は、ある調におけるそのコードの代理として根拠を示せるものをすべて返します。各項目は関係、ローマ数字、和声機能を持ちます。

```ts
import { formatChordSymbol, majorKey, makeChord, substituteChord } from '@libraz/libcantus';

const subs = substituteChord(makeChord(7, 'dom7'), majorKey(0));

subs.map((sub) => sub.type).includes('tritone'); // true
formatChordSymbol(subs.find((sub) => sub.type === 'tritone')?.chord ?? makeChord(0, 'maj'));
// 'Db7'
```

ハ長調における G7 の裏コードは C#7 ではなく Db7 と綴られます。この調の ♭II（第2度を半音下げた度数）であり、綴りがそれを示しています。

クラス API では `Chord.substitutions` が同じ問い合わせにあたり、`Progression.substitute` はそのうち1つを実際に差し替えます。

```ts
import { Chord, Key, Progression } from '@libraz/libcantus';

const subs = Chord.parse('G7').withKey(Key.major('C')).substitutions();
subs.find((sub) => sub.type === 'tritone')?.chord.rootPc; // 1

const progression = new Progression([Chord.parse('G7'), Chord.parse('C')], Key.major('C'));
progression.substitute(0, 'tritone').toString(); // 'Db7 C'
```

4つの関係は次のとおりです。

| 種類 | 対象 | 内容 |
| --- | --- | --- |
| `tritone` | 属和音型 | 三全音離れた属和音に置き換えます。ガイドトーンが共有されます。 |
| `relative` | 三和音・七の和音 | 三和音の構成音を2つ共有するコードに差し替えます。 |
| `borrowed` | 任意 | 同主調から同じ度数を借ります。 |
| `chromaticMediant` | 任意 | 3度離れ、共通音1つと半音変化を伴います。 |

副属和音はこの一覧に入りません。どの属和音が当たるかは後続の和音が決めるもので、`substituteChord` が受け取るのは1つの和音と調だけだからです。対象が分かっている場面では `secondaryDominantOf`（クラスでは `Chord.secondaryDominant`）が指定した和音に対する副属和音を作ります。進行全体を選び直す場面では、`harmonizeMelody` が `reharmonize: 'secondaryDominant'` で語彙を広げます。

### メロディとの整合を保つ

上に乗る音とぶつかる代理は代理になりません。メロディのピッチクラスを渡すと、それらをすべて含むコードだけが残ります。

```ts
import { majorKey, makeChord, substituteChord } from '@libraz/libcantus';

const all = substituteChord(makeChord(0, 'maj'), majorKey(0));
const overE = substituteChord(makeChord(0, 'maj'), majorKey(0), { melodyPcs: [4] });

overE.length <= all.length; // true
overE.every((sub) => sub.chord.intervals.length > 0); // true
```

指定しない場合は理論上利用できる代理の全体が返り、指定した場合はすでに書かれたメロディに適合するものだけが残ります。

## モーダルインターチェンジのパレット

コードごとに問い合わせる代わりに、同主調から利用できるコードをまとめて取得できます。

```ts
import { Chord, formatChordSymbol, Key, majorKey, modalInterchangePalette } from '@libraz/libcantus';

modalInterchangePalette(majorKey(0)).map((borrowed) => formatChordSymbol(borrowed.chord));
// ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Db']

Chord.parse('C').withKey(Key.major('C')).modalInterchange().length; // 8
```

各項目はローマ数字と `source` を持つため、UI は借用元ごとにまとめて表示できます。綴りはフラット側に寄ります。長調における借用和音はそのように書かれるためです。パレットは個々のコードではなく調に属するので、`Chord.modalInterchange` も同じ一覧を返します。コードから辿れるようにしてあるのは、次の行き先を探している呼び出し側がすでにコードのところにいるからです。

## ネガティブハーモニー

`negativeHarmonyMirror` は、調の軸に対してコードを反転させます。

```ts
import { Chord, Key, majorKey, makeChord, negativeHarmonyMirror } from '@libraz/libcantus';

const mirrored = negativeHarmonyMirror(makeChord(7, 'maj'), majorKey(0));

mirrored.rootPc; // 5
mirrored.quality; // 'min'

Chord.parse('G').negativeHarmony(Key.major('C')).symbol(); // 'Fm'
```

C の軸で反転させた G メジャーは F マイナーになります。これは提案ではなく変換です。結果はちょうど1つで、それが曲に適するかどうかは作曲上の判断になります。

## 進行全体をリハーモナイズする

`generateProgression` のリハーモナイズはコンテキストで指定します。`ctx.complexity.harmonic` は進行のどれだけを後続和音の副属和音に置き換えるかを決めるもので、実行するかどうかではなくどの程度実行するかを指定できます。

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const plain = generateProgression({ key, style: 'idol', bars: 8, ctx: { seed: 5 } });
const rich = generateProgression({
  key,
  style: 'idol',
  bars: 8,
  ctx: { seed: 5, complexity: { harmonic: 1 } },
});

plain.length; // 8
rich.length; // 8
```

既定値の `harmonic: 0` ではプリセットがそのまま使われ、0.5 では声部進行の規則が許すもののおよそ半分、1 ではそのすべてが置き換わります。長さは変わりません。リハーモナイズは挿入ではなく置換であるためです。どのコードが置き換わるかは `seed` が固定するため、同じシードなら常に同じ進行になります。

`presetId` は組み込みの特定の進行を指定し、`preset` は呼び出し側の度数列を渡します。全音階外の度数には `BORROWED_DEGREES` の名前を使います。

```ts
import { BORROWED_DEGREES, generateProgression, majorKey } from '@libraz/libcantus';

BORROWED_DEGREES.bVII; // 10

const chords = generateProgression({
  key: majorKey(0),
  style: 'rock',
  bars: 4,
  preset: { degrees: [1, BORROWED_DEGREES.bVII, 4, 1] },
});

chords.map((span) => span.rootPc); // [0, 10, 5, 0]
```

## メロディから和音を付ける

`harmonizeMelody` は逆方向の処理で、メロディを与えるとその下のコードを選びます。まず各メロディ音を分類するため、経過音が和声を引きずることはありません。

```ts
import { harmonizeMelody } from '@libraz/libcantus';

const result = harmonizeMelody({
  melody: [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 62, startBeat: 1, durationBeat: 1 },
    { pitch: 64, startBeat: 2, durationBeat: 1 },
    { pitch: 65, startBeat: 3, durationBeat: 1 },
    { pitch: 67, startBeat: 4, durationBeat: 4 },
  ],
});

result.chords.length >= 1; // true
result.melodyRoles.length; // 5
result.transposeSemitones; // 0
```

`result.chords` は和声リズムの格子上でのコード変化ごとに1つの `ChordSpan` を持ち、`result.melodyRoles` は各メロディ音が最終的に下に来たコードの中で果たす役割を返します。`result.key` はコードが書かれている調で、`transposeSemitones` はそこへ到達するためにメロディを移動した量です。ハーモナイザが扱える調になかったメロディは、誤った調のコードではなく、そこへ移すための移動量とともに返ります。

`Composer.harmonize` はこの最後の2手順を呼び出し側に代わって行います。移動量をメロディに適用し、コードをタイムラインの上に配置するため、返ってくるのは互いに整合したメロディと和声です。

```ts
import { Composer, Score } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major' });
const melody = Score.of([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
  { pitch: 65, startBeat: 3, durationBeat: 1 },
  { pitch: 67, startBeat: 4, durationBeat: 4 },
]);

const harmonized = composer.harmonize(melody);

harmonized.chords.at(0)?.symbol(); // 'C'
harmonized.chords.totalBeats; // 8
harmonized.melody.notes.length; // 5
harmonized.transposeSemitones; // 0
```

メロディは終わるところで終止します。1フレーズずつ渡す呼び出し側にとってはこれが望ましい挙動です。1つのフレーズより長い旋律は各フレーズの区切りでも終止しますが、ハーモナイザ自身にはその位置が分かりません。区切りを名指しするのが `phraseEnds` で、すでにコードが付いている旋律であれば `phrasesFromTimeline` がその位置を見つけます。名指しした拍はコードのグリッドを分割し、そこで閉じるスロットへ和声が動き、フレーズが落ち着く音は次のフレーズの頭に対する装飾音ではなく構造音として読まれます。したがって旋律全体を1回の呼び出しで和声付けでき、フレーズごとに和声付けして繋ぐ必要はありません。

```ts
import { harmonizeMelody } from '@libraz/libcantus';

// Two four-bar phrases in C, each coming to rest on the tonic.
const period = [60, 62, 64, 65, 67, 65, 64, 60, 64, 65, 67, 69, 71, 67, 62, 60].map(
  (pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 }),
);

const whole = harmonizeMelody({ melody: period, phraseEnds: [8] });
const runOn = harmonizeMelody({ melody: period });

// The chord under the first phrase's close, on the last slot before beat 8.
whole.chords.some((chord) => chord.startBeat === 6); // true
// Without the boundary the close is swallowed by the chord already sounding.
runOn.chords.some((chord) => chord.startBeat === 6); // false
```

`classifyMelodyTones` は非和声音の分類だけを単体で実行します。ハーモナイズを確定させずに経過音や刺繍音を色分けする UI 向けです。

## リハーモナイズの提示

ここにある関数はいずれも理由付きの提案を返します。コードとあわせて理由も提示してください。`type` と `roman` が関係を示し、これはコード記号だけでは伝わりません。

元のコードは保持してください。リハーモナイズは既存の音楽に対する提案であり、ユーザーが比較・却下・復元できる必要があります。生成パートにも同じことが当てはまります。[生成](generation.md)を参照してください。
