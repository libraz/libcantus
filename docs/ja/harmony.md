# 和声

このページが前提とする音楽用語（和音、度数、機能、終止形）は[入門の和声のページ](primer/harmony.md)で説明しています。

## コードは構造を持つ値

コード記号はコードのデータとして解析されます。ルートのピッチクラス、その上に積まれた音程、任意のベースです。そのデータを構造として読むのは別の段階で、`chordSpecOf` が `ChordSpec` を導きます。基本の性質に加えて、7th、変化音、付加音、省略音、任意のベースを持つ形です。固定のコード名一覧に縛られたモデルではありません。

```ts
import { Chord, Key, chordSpecOf } from '@libraz/libcantus';

Key.major('C').roman('V7/V').symbol(); // 'D7'
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]

const altered = Chord.parse('C7(b9,#11)');

altered.spec.alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
chordSpecOf(altered.data).alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
```

1段で得たいときは `Chord.spec` を使います。`chordSpecOf` が受け取るのはプレーンなコードデータであり、`chord.data` を渡す必要があるのはそのためです。`Chord` の値は転回、移調、整形、進行への変換ができます。純粋関数の `makeChord`、`chordFromSpec`、`chordPitchClasses`、`formatChordSymbol` は、クラスラッパーなしで同じデータモデルを公開します。

記号は往復しても保たれ（どの品質名にも当てはまらない和音を含みます）、転回は音程リストの並べ替えではなくベースのピッチクラスとして保持されます。例外は省略音です。和音が省いた音は書き出されないため、`'C7(omit3)'` は `'C7'` として整形され、読み戻すと3度が戻ります。往復が保証するのはルート、スラッシュのベース、そして鳴っている構成音であり、`chordSpecOf(chord).omissions` が名指す度数はその対象から外れます。

```ts
import { Chord, formatChordSymbol, parseChordSymbol } from '@libraz/libcantus';

formatChordSymbol(parseChordSymbol('Cmaj7')); // 'Cmaj7'
formatChordSymbol(parseChordSymbol('Cmaj7sus4')); // 'Cmaj7sus4'
formatChordSymbol(parseChordSymbol('C6/9(#11)')); // 'C6/9(#11)'
Chord.parse('C/E').data.bassPc; // 4
Chord.parse('C/E').pitchClasses(); // [0, 4, 7]
```

`chordToneRole` はピッチクラスがそのコードの中で果たす役割を返し、`isChordMember` は所属を判定します。ピアノロールを現在の和声に対して色分けする UI が必要とするのはこの2つです。

`chordQualities()` は品質名の語彙をすべて返します。品質を選ばせるピッカーはこれを元に作ります。並びは品質が宣言された順で、安定しています。コード検出がこの順を最後のタイブレークに使うためで、これを元に作ったメニューは実行のたびに並びが変わりません。アルファベット順でもランキングでもありません。

```ts
import { chordQualities } from '@libraz/libcantus';

chordQualities().length; // 43
chordQualities().slice(0, 4); // ['maj', 'min', 'dim', 'aug']
```

`transposeChord` はコードデータを符号付きの半音数だけ動かします。ルートとベースはまとめて動きます。`transposeChordSymbol` は同じことをテキストに対して行い、読み込んだ表記体系のまま書き戻します。`ChordSymbolOptions.flats` は記号全体をどちら側で書くかを選ぶので、フラットのルートにシャープのベースが付いた記号が返ることはありません。

```ts
import { formatChordSymbol, parseChordSymbol, transposeChord, transposeChordSymbol } from '@libraz/libcantus';

formatChordSymbol(transposeChord(parseChordSymbol('C/E'), 2)); // 'D/F#'
transposeChordSymbol('Bb/F', 1); // 'B/F#'
transposeChordSymbol('Bb/F', 1, { flats: true }); // 'Cb/Gb'
```

何も指定しなければ、譜面が書かない名前になってしまう音は綴り直されます。`Bb/F` を半音上げると `B/F#` になるのはそのためです。`flats` を指定すると和音は片側にとどまり、`Cb/Gb` になります。`B/Gb` はそもそも和音として成立しません。

## 調からコードを組み立てる

コードはルートではなく音度からも組み立てられます。これにより、進行を度数で書き、調を差し替えるだけで移調できます。

```ts
import { chordFromDegree, diatonicSeventh, diatonicTriad, formatChordSymbol, majorKey } from '@libraz/libcantus';

const key = majorKey(0);

formatChordSymbol(diatonicTriad(2, key)); // 'Dm'
formatChordSymbol(diatonicSeventh(5, key)); // 'G7'
formatChordSymbol(chordFromDegree(6, 'min7', key)); // 'Am7'
```

## 機能和声

調を与えると、コードはローマ数字と機能の読みになります。結果は選ばれた解釈と、その根拠を持ちます。

```ts
import { Chord, Key } from '@libraz/libcantus';

const result = Chord.of('F', 'min').analyze(Key.major('C'));
result.roman; // 'iv'
result.function; // 'subdominant'
result.borrowed; // true
result.source; // 'parallelMinor'
```

`rationale` は常に存在し、機能を決定した規則を述べます。`alternatives` は明示的に要求した場合を除いて空です。

```ts
import { analyzeChord, makeChord, majorKey } from '@libraz/libcantus';

const plain = analyzeChord(makeChord(2, 'dom7'), majorKey(0));
const withRivals = analyzeChord(makeChord(2, 'dom7'), majorKey(0), { alternatives: true });

plain.alternatives.length; // 0
withRivals.alternatives.length >= 1; // true
typeof withRivals.rationale; // 'string'
```

ここでの候補は、解析が退けた読みです。度数だけから決まったはずの機能、属和音的な響きが持ち得た一時的転調の読み、他の出力オプションが生成したはずのローマ数字などが含まれます。多くの呼び出し側には不要な計算を伴うため、既定では無効になっています。`explainRoman` は同じ推論を1つのローマ数字に添えて返します。

対応する関数 API は `chordToRoman`、`romanToChord`、`analyzeChord`、`functionOf`、`isDiatonic`、`isMinorKey` です。

## 綴りを保つ半音階的な和音

増六の和音3種は、下げた第6度をベースに置き、ドミナントへ向かう和音です。そのベースの上に増6度を持ち、増6度は外側に開いてドミナントへ解決します。音程は書かれた文字の問題であるため、これらの和音はピッチクラスではなく綴りから同定されます。Ab のベースの上では増6度は F# であり、同じ響きの音を Gb と書けば、それはただの bVI7 の短7度です。

```ts
import { augmentedSixthChord, augmentedSixthKind, chordToRoman, formatNote, majorKey, spellAugmentedSixth, parseNote } from '@libraz/libcantus';

const key = majorKey(0);
const german = augmentedSixthChord('german', key);

augmentedSixthKind(german, key); // 'german'
chordToRoman(german, key); // 'Ger6'
spellAugmentedSixth('german', parseNote('C')).map((note) => formatNote(note)); // ['Ab', 'C', 'Eb', 'F#']
```

増六の和音を綴るローマ数字は存在しないため、3種類は常に `It6`、`Fr6`、`Ger6` として出力され、出力を切り替えるオプションを持ちません。ただし他のローマ数字と同じように対象を取れるので、`applied: true` のもとでは、半音階的なドミナント前の和音がどの度数を指しているかを解析が言えます。

```ts
import { chordToRoman, majorKey, romanToChord } from '@libraz/libcantus';

const home = majorKey(0);
const pointingAtV = romanToChord('Ger6/V', home);

chordToRoman(pointingAtV, home, { applied: true }); // 'Ger6/V'
chordToRoman(pointingAtV, home); // 'bIII7'
```

この読みが行われるのは、和音が自身の構成音の綴りを持っている場合だけです。文字を伴わずに届いた和音は3度の積み重ねとして綴られ、その積み方はフランスの増六を偶然正しく書いてしまいます。素のピッチクラスから6つの候補度数を読めば、誰も綴っていない変化属和音を珍しい和音として拾い上げることになります。ピッチクラスしか持たない呼び出し側は `augmentedSixthFromPitchClasses` から文字を得ます。鳴っているベースの上に鳴っているピッチクラスの集合を読み、綴られた和音を返します。増六の和音を綴らない集合であれば `null` です。

```ts
import { augmentedSixthFromPitchClasses, majorKey, noteNames } from '@libraz/libcantus';

const home = majorKey(0);
const german = augmentedSixthFromPitchClasses([8, 0, 3, 6], 8, home);

noteNames(german?.toneSpellings ?? []); // ['Ab', 'C', 'Eb', 'F#']
augmentedSixthFromPitchClasses([0, 4, 7], 0, home); // null
```

ナポリの和音（下げた第2度の上に立つ長三和音）にはローマ数字があり、第1転回形では `bII6` になります。`N6` になるのは `neapolitan: true` のときだけです。どちらの綴りも正しく、選択は表記の流儀だからです。

副属和音と借用和音は[調関係と転調](key-relations-and-modulation.md)、意図的な置き換えは[リハーモナイズ](reharmonization.md)で扱います。

## 進行とボイシング

クラス API は調の度数から進行を組み立て、四声体としてボイシングできます。

```ts
import { Key } from '@libraz/libcantus';

const c = Key.major('C');
const voicing = c
  .chord(1, 'maj')
  .progressionTo(c.chord(6, 'min'), c.chord(5, 'dom7'), c.chord(1, 'maj'))
  .voice();

voicing;
// [[48, 60, 64, 67], [45, 60, 64, 69], [43, 62, 65, 71], [48, 60, 64, 72]]
```

対応する関数は `voiceChord`、`voiceProgression`、`nextVoicing`、`voiceLeadingCost` です。シェル、ドロップ、コンピング系のスタイルは `Chord.styledVoicing` と `voiceChordStyled` が扱います。探索オプションとスタイルの一覧は[ボイシング](voicing.md)を参照してください。

## 通奏低音と対位法

通奏低音は和声をベース音の下の数字として書く記譜で、各数字はベースからの音程を表します。その音程は調から取られるため、同じ数字でも度数が違えば異なる綴りになります。`realizeFiguredBass`、`spellChord`、`checkPartWriting`、`checkSpecies` は綴られた音を扱い、課題を黙って書き換えるのではなく違反や説明を返します。綴り関数にはその調自身の主音を渡してください。調の根音と異なるピッチクラスを鳴らす主音は、綴られずに拒否されます。

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, spellChord } from '@libraz/libcantus';

const chord = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(chord, parseNote('C'), Key.major('C').scale).map((note) => formatNote(note));
// ['B', 'D', 'F']
```

`figuredBassOf` は逆方向で、あるコードとベースがどの数字で書かれるかを返します。`figuredBassRealization` は行き方向の完全な読みで、和音、綴られた音、そして `4-3` のような動く数字が示す掛留を返します。`realizeFiguredBass` が返すのは和音だけです。両方向は厳密に互いの逆です。`figuredBassOf` は返す前に自分の書いた数字を読み戻すので、数字の付いた和音はその和音自身に実現され、数字が近似にしかならない和音は、実現に失敗する数字ではなく数字なしになります。

数字に書かれた変化記号は、譜面上で同じ記号がそうするのと同じく、その音そのものを名指します。調からの隔たりを表すのではありません。したがって、調号がすでに第7度を下げている短調は、導音を `#3` ではなく `n3` と書きます。ハ短調では属音の上の3度は調号が下げている B で、譜面はその前にナチュラルを刷るからです。音程を名指すのではなく動かす記号は、斜線付きの数字（入力では `+`）だけです。調が与える音程を半音上げるので、`+3` はどちらの調でも導音になります。

```ts
import { figuredBassOf, figuredBassRealization, Key, makeChord, noteNames, parseNote } from '@libraz/libcantus';

figuredBassOf(makeChord(7, 'maj'), Key.minor('C')); // 'n3'
figuredBassOf(makeChord(4, 'maj'), Key.minor('A')); // '#3'

noteNames(figuredBassRealization(parseNote('G'), '+3', Key.minor('C')).notes); // ['G', 'B', 'D']
noteNames(figuredBassRealization(parseNote('E'), '+3', Key.minor('A')).notes); // ['E', 'G#', 'B']
```

増六の和音のうち、自身のルートの上に3度で積み上がるのはフランスの増六だけです。そのためこれだけが記譜の届く範囲にあり、`#643` と書かれます。イタリアとドイツの増六はルートを持たずに積み上がるため、数字を持ちません。

```ts
import { augmentedSixthChord, figuredBassOf, figuredBassRealization, majorKey, noteNames, parseNote } from '@libraz/libcantus';

figuredBassOf(augmentedSixthChord('french', majorKey(0)), majorKey(0)); // '#643'
noteNames(figuredBassRealization(parseNote('Ab'), '#643', majorKey(0)).notes);
// ['Ab', 'C', 'D', 'F#']
```

和声課題と種目対位法のチェッカーは[対位法と和声課題](counterpoint-and-part-writing.md)で扱います。

## 和声が与えられるのではなく推定される場合

ここまでは、呼び出し側がすでにコードを持っている前提でした。ノートイベントからコードを認識し、時間軸上でラベル付けし、終止を見つける処理は[解析](analysis.md)で扱います。
