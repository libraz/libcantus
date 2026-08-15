# 和声

## コードは構造化された値

コード記号は基本形、七度、変化音、付加音、省略音、任意のベースを持つ `ChordSpec` へ解析されます。固定された名前の一覧には制限されません。

```ts
import { Chord, Key, chordSpecOf } from '@libraz/libcantus';

Key.major('C').roman('V7/V').symbol(); // 'D7'
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]
chordSpecOf(Chord.parse('C7(b9,#11)').data).alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
```

クラスのほか、`makeChord`、`chordFromSpec`、`chordPitchClasses`、`formatChordSymbol` が同じモデルを関数で扱います。

## 機能和声

キーを渡すと、ローマ数字と機能を根拠付きで読めます。

```ts
import { Chord, Key } from '@libraz/libcantus';

const result = Chord.of('F', 'min').analyze(Key.major('C'));
result.roman; // 'iv'
result.function; // 'subdominant'
result.borrowed; // true
```

`chordToRoman`、`romanToChord`、`analyzeChord`、`functionOf`、`explainRoman` が関数 API です。借用和音、セカンダリードミナント、増六の和音は綴りを保ち、必要なら退けた候補も報告します。

## 進行とボイシング

```ts
import { Key } from '@libraz/libcantus';

const c = Key.major('C');
c.chord(1, 'maj').progressionTo(c.chord(6, 'min'), c.chord(5, 'dom7'), c.chord(1, 'maj')).voice();
// [[48, 60, 64, 67], [45, 60, 64, 69], [43, 62, 65, 71], [48, 60, 64, 72]]
```

関数の `voiceChord`、`voiceProgression`、`nextVoicing`、`voiceLeadingCost` は細かな制御に使えます。`Chord.styledVoicing` と `voiceChordStyled` は shell、drop、comping のスタイルを扱います。

## 数字付き低音と対位法

`realizeFiguredBass`、`spellChord`、`checkPartWriting`、`checkSpecies` は綴られた音を扱い、違反や根拠を返します。

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, spellChord } from '@libraz/libcantus';

const chord = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(chord, parseNote('B'), Key.major('C').scale).map(formatNote);
// ['B', 'D', 'F']
```
