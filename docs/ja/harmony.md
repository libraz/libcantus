# 和声

## コードは構造を持つ値

コード記号は `ChordSpec` として解析されます。基本の性質に加えて、7th、変化音、付加音、省略音、任意のベースを持ちます。固定のコード名一覧に縛られたモデルではありません。

```ts
import { Chord, Key, chordSpecOf } from '@libraz/libcantus';

Key.major('C').roman('V7/V').symbol(); // 'D7'
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]

const altered = Chord.parse('C7(b9,#11)');
chordSpecOf(altered.data).alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
```

`Chord` の値は転回、移調、整形、進行への変換ができます。純粋関数の `makeChord`、`chordFromSpec`、`chordPitchClasses`、`formatChordSymbol` は、クラスラッパーなしで同じデータモデルを公開します。

記号は往復しても保たれ（どの品質名にも当てはまらない和音を含みます）、転回は音程リストの並べ替えではなくベースのピッチクラスとして保持されます。

```ts
import { Chord, formatChordSymbol, parseChordSymbol } from '@libraz/libcantus';

formatChordSymbol(parseChordSymbol('Cmaj7')); // 'Cmaj7'
formatChordSymbol(parseChordSymbol('Cmaj7sus4')); // 'Cmaj7sus4'
formatChordSymbol(parseChordSymbol('C6/9(#11)')); // 'C6/9(#11)'
Chord.parse('C/E').data.bassPc; // 4
Chord.parse('C/E').pitchClasses(); // [0, 4, 7]
```

`chordToneRole` はピッチクラスがそのコードの中で果たす役割を返し、`isChordMember` は所属を判定します。ピアノロールを現在の和声に対して色分けする UI が必要とするのはこの2つです。

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

```ts
import { augmentedSixthChord, augmentedSixthKind, chordToRoman, formatNote, majorKey, spellAugmentedSixth, parseNote } from '@libraz/libcantus';

const key = majorKey(0);
const german = augmentedSixthChord('german', key);

augmentedSixthKind(german, key); // 'german'
chordToRoman(german, key); // 'Ger6'
spellAugmentedSixth('german', parseNote('C')).map((note) => formatNote(note)); // ['Ab', 'C', 'Eb', 'F#']
```

増六の和音を表すローマ数字は存在しないため、3種類は `It6`、`Fr6`、`Ger6` として出力されます。ナポリの和音にはローマ数字があり、第1転回形では `bII6` になります。`N6` になるのは `neapolitan: true` のときだけです。どちらの綴りも正しく、選択は表記の流儀だからです。

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

通奏低音の音程は調から取られるため、同じ数字でも度数が違えば異なる綴りになります。`realizeFiguredBass`、`spellChord`、`checkPartWriting`、`checkSpecies` は綴られた音を扱い、課題を黙って書き換えるのではなく違反や説明を返します。綴り関数にはその調自身の主音を渡してください。調の根音と異なるピッチクラスを鳴らす主音は、綴られずに拒否されます。

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, spellChord } from '@libraz/libcantus';

const chord = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(chord, parseNote('C'), Key.major('C').scale).map((note) => formatNote(note));
// ['B', 'D', 'F']
```

`figuredBassOf` は逆方向で、あるコードとベースがどの数字で書かれるかを返します。和声課題と種目対位法のチェッカーは[対位法と和声課題](counterpoint-and-part-writing.md)で扱います。

## 和声が与えられるのではなく推定される場合

ここまでは、呼び出し側がすでにコードを持っている前提でした。ノートイベントからコードを認識し、時間軸上でラベル付けし、終止を見つける処理は[解析](analysis.md)で扱います。
