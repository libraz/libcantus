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

ハ長調における G7 の裏コードは C#7 ではなく Db7 と綴られます。この調の下方第2度であり、綴りがそれを示しています。

4つの関係は次のとおりです。

| 種類 | 対象 | 内容 |
| --- | --- | --- |
| `tritone` | 属和音型 | 三全音離れた属和音に置き換えます。ガイドトーンが共有されます。 |
| `relative` | 三和音・七の和音 | 三和音の構成音を2つ共有するコードに差し替えます。 |
| `borrowed` | 任意 | 同主調から同じ度数を借ります。 |
| `chromaticMediant` | 任意 | 3度離れ、共通音1つと半音変化を伴います。 |

副属和音はこの一覧に入りません。どの属和音が当たるかは後続の和音が決めるもので、`substituteChord` が受け取るのは1つの和音と調だけだからです。対象が分かっている場面では `secondaryDominantOf` が指定した和音に対する副属和音を作ります。進行全体を選び直す場面では、`harmonizeMelody` が `reharmonize: 'secondaryDominant'` で語彙を広げます。

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
import { formatChordSymbol, majorKey, modalInterchangePalette } from '@libraz/libcantus';

modalInterchangePalette(majorKey(0)).map((borrowed) => formatChordSymbol(borrowed.chord));
// ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Db']
```

各項目はローマ数字と `source` を持つため、UI は借用元ごとにまとめて表示できます。綴りはフラット側に寄ります。長調における借用和音はそのように書かれるためです。

## ネガティブハーモニー

`negativeHarmonyMirror` は、調の軸に対してコードを反転させます。

```ts
import { majorKey, makeChord, negativeHarmonyMirror } from '@libraz/libcantus';

const mirrored = negativeHarmonyMirror(makeChord(7, 'maj'), majorKey(0));

mirrored.rootPc; // 5
mirrored.quality; // 'min'
```

C の軸で反転させた G メジャーは F マイナーになります。これは提案ではなく変換です。結果はちょうど1つで、それが曲に適するかどうかは作曲上の判断になります。

## 進行全体をリハーモナイズする

`generateProgression` には `reharmonize` フラグがあり、`complexity.harmonic` の中間値の略記です。コンテキストを直接指定すると、実行するかどうかではなくどの程度実行するかを指定できます。

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

`harmonic: 0` ではプリセットがそのまま使われます。1 では、声部進行の規則が許すすべてのコードが後続和音の副属和音に置き換わります。長さは変わりません。リハーモナイズは挿入ではなく置換であるためです。

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

メロディは終わるところで終止します。1フレーズずつ渡す呼び出し側にとってはこれが望ましい挙動です。1つのフレーズより長い旋律は各フレーズの区切りでも終止しますが、ハーモナイザ自身にはその位置が分かりません。すでにコードが付いている旋律であれば `phrasesFromTimeline` が区切りを見つけるので、フレーズごとに和声付けすれば各区切りにそれぞれの終止が付きます。

`classifyMelodyTones` は非和声音の分類だけを単体で実行します。ハーモナイズを確定させずに経過音や刺繍音を色分けする UI 向けです。

## リハーモナイズの提示

ここにある関数はいずれも理由付きの提案を返します。コードとあわせて理由も提示してください。`type` と `roman` が関係を示し、これはコード記号だけでは伝わりません。

元のコードは保持してください。リハーモナイズは既存の音楽に対する提案であり、ユーザーが比較・却下・復元できる必要があります。生成パートにも同じことが当てはまります。[生成](generation.md)を参照してください。
