# 音高と記譜

## 音と MIDI

`Note` は音名の文字、変化記号、任意のオクターブを保持します。音名の文字列からクラス値を得るには `Note.parse`、各要素から組み立てるには `Note.of`、プレーンデータ API には `parseNote` を使います。オクターブを持たない音はピッチクラスを持ちますが、MIDI 番号は持ちません。

```ts
import { Note, parseNote, tryParseNote } from '@libraz/libcantus';

const c4 = Note.parse('C4');
c4.name; // 'C4'
c4.midi; // 60
c4.transpose(7).name; // 'G4'

parseNote('Bb3'); // { letter: 6, alter: -1, octave: 3 }
tryParseNote('C#b').ok; // false
```

`tryParseNote` と、対応する `tryParseInterval`、`tryParseChordSymbol`、`tryParseKeyName`、`tryParseTimeSignature`、そして `Note`・`Interval`・`Key`・`Chord` の `tryParse` メソッドは、例外を投げる代わりに解析結果を返します。テキスト入力欄やインポート処理で役立ちます。[エラーと検証](errors-and-validation.md)を参照してください。

綴られた音と MIDI のあいだの変換は別々の関数になっています。失われる情報が異なるためです。

```ts
import { formatNote, midiToNote, noteToMidi, noteToPitchClass, parseNote } from '@libraz/libcantus';

noteToMidi(parseNote('Bb3')); // 58
noteToPitchClass(parseNote('Db')); // 1
formatNote(midiToNote(58)); // 'A#3'
```

`midiToNote` には調の文脈がないため、既定の綴りを選びます。綴りが問題になる場面では `spellPitch`、`spellPitchClass`、`spellLine` を使います。

## 綴られた音程

音程は全音階上の度数と半音数の両方を持ちます。この区別により、増4度と減5度の違いが保たれます。

```ts
import { Interval, Note } from '@libraz/libcantus';

Interval.between(Note.parse('C4'), Note.parse('F#4')).name; // 'A4'
Interval.between(Note.parse('C4'), Note.parse('Gb4')).name; // 'd5'
Note.parse('C4').transposeBy('A4').name; // 'F#4'
```

対応する関数は `spelledInterval`、`parseInterval`、`transposeByInterval`、`transposeNote` です。

音程は協和の分類も持ちます。対位法の規則はこの分類の上に組み立てられています。

```ts
import { classifyInterval, ConsonanceClass, isConsonantInterval, isPerfectInterval } from '@libraz/libcantus';

classifyInterval(7); // ConsonanceClass.PerfectConsonance
classifyInterval(5); // ConsonanceClass.Dissonance
classifyInterval(5, false); // ConsonanceClass.ImperfectConsonance
isPerfectInterval(7); // true
isConsonantInterval(4); // true
```

`classifyInterval` が第2引数を取るのは完全4度のためです。2声書法では不協和として扱われ、より厚いテクスチャで下から支えられている場合はそうではありません。既定は2声の読みで、種目対位法が前提とするものと一致します。

## 調とスケール

`Key` は主音の綴りとスケールマスクを組にします。よく使うスケールには名前付きのコンストラクタを、名前のある旋法には `Key.named` または `scaleByName` を使います。

```ts
import { Key, supportsFunctionalHarmony } from '@libraz/libcantus';

Key.major('C').relative().toString(); // 'A minor'
Key.minor('D').transposeBy('A4').toString(); // 'G# minor'
Key.named('miyakoBushi', 'E').noteNames(); // ['E', 'F', 'A', 'B', 'C']
supportsFunctionalHarmony('miyakoBushi'); // false
```

調関係は5度圏を使い、実用的な綴りを保ちます。たとえば変ニ長調の平行調は、嬰イ短調ではなく変ロ短調になります。関係の一覧は[調関係と転調](key-relations-and-modulation.md)、マスク表現は[スケールとモード](scales-and-modes.md)を参照してください。

## 旋律の綴り

`spellLine` は、ピッチごとに独立して臨時記号を選ぶのではなく、声部全体とその調またはコードタイムラインを考慮します。

```ts
import { majorKey, noteNames, spellLine } from '@libraz/libcantus';

const rising = [60, 61, 62, 63, 64].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
}));

noteNames(spellLine(rising, null, majorKey(0)));
// ['C4', 'C#4', 'D4', 'D#4', 'E4']
```

上行する半音階はシャープ、下行する半音階はフラットで綴られます。読み手が期待する形であり、1音ずつ独立に選ぶ方式では生成できない結果です。第2引数にコードタイムラインを渡すと、各音を下で鳴っている和声に対して綴ります。曲が慣用的な綴りと異なる書き方をしている場合は、オプションの `tonic` を渡します。

より小さな単位には関連する関数があります。調の中の1音には `spellPitch`、1つのピッチクラスには `spellPitchClass`、複数には `spellPitchClasses`、コードには `spellChord` と `spellChordFromRoot`、スケールには `spellScale`、ボイシングには `spellVoicing` を使います。

## 各国語の音名

音名は英語、ドイツ語、日本語、イタリア語、固定ドの5体系で読み書きします。解析時は体系を検出し、整形時は既定で英語表記になります。[相互運用](interoperability.md)を参照してください。

## 周波数

ここまでの内容に周波数は関わりません。ヘルツ単位の実際の音高が必要な場面 — チューナー、微分音の再生、解析との橋渡し — は[音律と周波数](tuning-and-frequency.md)を参照してください。
