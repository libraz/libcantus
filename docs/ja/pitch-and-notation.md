# 音高と表記

## 音名と MIDI

`Note` は音名、変化記号、任意のオクターブを保持します。`Note.of` はクラス値、`parseNote` はプレーンデータを返します。

```ts
import { Note, parseNote, tryParseNote } from '@libraz/libcantus';

const c4 = Note.of('C4');
c4.midi; // 60
c4.transpose(7).name; // 'G4'
parseNote('Bb3'); // { letter: 6, alter: -1, octave: 3 }
tryParseNote('C#b'); // { ok: false, error: InvalidInputError }
```

`tryParseNote`、`tryParseInterval`、`tryParseChordSymbol`、`Chord.tryParse` は例外を投げず、入力欄やインポータ向けにパース結果を返します。

## 綴られた音程

音程は全音階的な度数と半音幅の両方を持つため、増四度と減五度を区別できます。

```ts
import { Interval, Note } from '@libraz/libcantus';

Interval.between(Note.of('C4'), Note.of('F#4')).name; // 'A4'
Interval.between(Note.of('C4'), Note.of('Gb4')).name; // 'd5'
Note.of('C4').transposeBy('A4').name; // 'F#4'
```

関数形には `spelledInterval`、`parseInterval`、`transposeByInterval`、`transposeNote` があります。

## キーとスケール

`Key` は綴られた主音とスケールマスクを組にします。

```ts
import { Key, supportsFunctionalHarmony } from '@libraz/libcantus';

Key.major('C').relative().toString(); // 'A minor'
Key.minor('D').transposeBy('A4').toString(); // 'G# minor'
Key.named('miyakoBushi', 'E').noteNames(); // ['E', 'F', 'A', 'B', 'C']
supportsFunctionalHarmony('miyakoBushi'); // false
```

キー関係は五度圏上で計算され、実用的な綴りを保ちます。

## 声部を綴る

`spellLine` は各音を単独で選ばず、声部全体とキーまたはコードタイムラインを見ます。

```ts
import { majorKey, noteNames, spellLine } from '@libraz/libcantus';

const rising = [60, 61, 62, 63, 64].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
noteNames(spellLine(rising, null, majorKey(0)));
// ['C4', 'C#4', 'D4', 'D#4', 'E4']
```
