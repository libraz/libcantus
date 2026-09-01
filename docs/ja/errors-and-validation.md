# エラーと検証

このライブラリが投げる失敗は3種類のいずれかに分類され、種類によって呼び出し側の対処が決まります。メッセージ文字列は契約にならないため、種類は `code` としてエラーに載ります。

## 3種類の失敗

| コード | クラス | 継承元 | 変えるべきもの |
| --- | --- | --- | --- |
| `INVALID_INPUT` | `InvalidInputError` | `RangeError` | 引数。形式が不正、範囲外、または未知の名前を指しています。 |
| `NO_SOLUTION` | `NoSolutionError` | `Error` | 制約。入力は妥当ですが、それを満たす解が存在しません。 |
| `BUDGET_EXCEEDED` | `BudgetExceededError` | `RangeError` | 要求の大きさ、または比較対象の予算。 |

各クラスは、呼び出し側がもともと catch するであろう組み込みエラーを継承しています。`code` は既存のカテゴリを置き換えるのではなく、その内側を細分化します。`unknown` からこの共用体へ絞り込むには `isLibcantusError` を使います。

```ts
import { isLibcantusError, parseChordSymbol, voiceChord } from '@libraz/libcantus';

function voiceOrCode(symbol: string, range: { min: number; max: number }): number[] | string {
  try {
    return voiceChord(parseChordSymbol(symbol), { ranges: [range] });
  } catch (error) {
    if (!isLibcantusError(error)) throw error;
    return error.code;
  }
}

voiceOrCode('C', { min: 60, max: 72 }); // [60]
voiceOrCode('C', { min: 61, max: 61 }); // 'NO_SOLUTION'
voiceOrCode('C', { min: 72, max: 60 }); // 'INVALID_INPUT'
```

ガードが弾いた値は再送出します。ライブラリ内部のバグに由来する `TypeError` は制約の問題ではなく、ここで捕まえるとクラッシュが誤った答えに変わります。

`NoSolutionError` は、処理が列を順に辿っていた場合に `at` を持ちます。4つ目のコードで失敗した進行は、進行全体ではなくその位置の失敗として報告できます。

## 例外を投げないテキスト解析

テキスト入力欄は1打鍵ごとに解析され、その大半は有効な記号の途中にあります。`try*` 系のパーサはそれを値として返します。

```ts
import {
  tryParseChordSymbol,
  tryParseInterval,
  tryParseKeyName,
  tryParseNote,
  tryParseTimeSignature,
} from '@libraz/libcantus';

tryParseNote('Bb3').ok; // true
tryParseNote('C#b').ok; // false
tryParseInterval('P5').ok; // true
tryParseChordSymbol('Cmaj7').ok; // true
tryParseKeyName('gis moll').ok; // true
tryParseTimeSignature('7/8').ok; // true
tryParseTimeSignature('7/').ok; // false

const typed = tryParseChordSymbol('C(');
const label = typed.ok ? typed.value.quality : typed.error.message;
```

`ParseResult<T>` は `{ ok: true; value: T }` または `{ ok: false; error: LibcantusError }` です。エラーを `null` に潰さず結果に載せるのは、入力欄が「入力された文字列の何が不正なのか」を表示する必要があるためです。テキストを読むパーサはいずれもこの対を持ちます。音名、音程、コードネーム、調名、拍子記号のすべてです。クラス API も、テキストを読むクラスごとに同じ対を持ちます。`Note.parse`、`Interval.parse`、`Key.parse`、`Chord.parse`、`Meter.parse` に対して `Note.tryParse`、`Interval.tryParse`、`Key.tryParse`、`Chord.tryParse`、`Meter.tryParse` です。

例外を投げるパーサは、いずれも投げないパーサの上に実装されています。`parseNote` と `tryParseNote` が妥当性の判定でずれることはありません。

音・調・和音を受け取るエントリポイントは、データだけでなくテキスト形式も受け取り、同じパーサで読みます（[相互運用](interoperability.md)を参照）。したがってこれらの関数は、何も指していない文字列に対して `InvalidInputError` を投げることがあります。プレーンデータの形では、値の範囲外でしか失敗しえなかったところです。名前が自分のコードではなく利用者から届く場面では、先に `try*` の側で解析し、その結果を渡してください。そうすれば失敗は、入力された欄そのもので表面化します。数回先の呼び出しではなく。

## ホストから渡された値の検証

TypeScript が文字列ユニオンを検査するのはコンパイル時だけです。JSON、プロジェクトファイル、プラグインホスト、JavaScript の呼び出し元から来た値は無検査のままエンジンに届き、対応する項目のないテーブルを引くことになります。同じ検査を自分の境界で使えるよう、`assert*` 系は公開されています。

```ts
import { assertMidiPitch, assertNoteEvents, assertOneOf, clampToMidi } from '@libraz/libcantus';

assertMidiPitch(60); // 60
assertOneOf('walking', ['pop', 'walking', 'root'], 'bass style'); // 'walking'
clampToMidi(140); // 127

assertNoteEvents([{ pitch: 60, startBeat: 0, durationBeat: 1 }]).length; // 1
```

いずれの関数も引数をそのまま返すため、独立した1行を割かずに値を包めます。`assertMidiPitch` と `clampToMidi` はどちらも整数を要求します。MIDI のバイトは小数を載せられないためです。両者の違いは範囲の扱いだけで、`assertMidiPitch` は 0..127 を外れたピッチを拒否し、`clampToMidi` は 0..127 に丸めます。インポート処理では後者が適することが多いです。

ノートイベントも同じ規則に従います。`pitch` は 0..127 の整数で、イベントが `velocity` を持つ場合もその領域は同じであり、検査のしかたも同じです。96.5 という velocity は上流で丸め損ねた値であり、これを通せば、フォーマットが保持できないノートを書き出し側に渡すことになります。イベントが `articulation` を持つ場合は、ライブラリが知る名前の一覧に照らして検査されます。綴り違いの奏法は入力の誤りとして扱われ、「その楽器はその奏法で演奏できない」という音楽上の主張にはなりません。`startBeat` と `durationBeat` は MIDI のバイトではなく拍なので、有限の値であれば受け取ります。

```ts
import { assertNoteEvents, isLibcantusError } from '@libraz/libcantus';

let reported = 'ok';
try {
  assertNoteEvents([{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 96.5 }], 'score notes');
} catch (error) {
  if (isLibcantusError(error)) reported = error.message;
}

reported; // 'score notes[0].velocity must be an integer in [0, 127]; received 96.5'
```

`assertNoteEvents` は配列をコピーせずに検査し、インポートに必要な緩和を受け取ります。

- `allowNonPositiveDuration`: MIDI インポートが生む長さ0のノートを受け入れます。取り除く前に配列を検査できます。
- `minStartBeat`: 宣言したアウフタクトより前から鳴る音を拒否します。アウフタクトとは最初の強拍へ導く音のことで、したがって拍0より前で鳴ります。そのため既定では開始位置に下限がありません。
- `budget`: イベント数の上限。

疎配列の穴と明示的な `undefined` は、どちらも拒否されます。黙って捨てられることも、後続の `TypeError` として現れることもありません。

楽器プロファイルも、受け取った時点で同じように検査されます。弦楽器のプロファイルは弦が最低1本必要で、各開放弦は 0..127 の MIDI ピッチ、フレット数は 0..127 の整数です。MIDI の音域より長いネックは、鳴らない位置を名指すことになるためです。打楽器のプロファイルは手の届く声部が最低1つ必要で、届く各声部は 0..127 の MIDI ピッチです。この範囲を外れたプロファイルは、後段での失敗ではなく、該当するフィールドを名指す `InvalidInputError` になります。

## 鳴らないノート

解析側の入り口は、長さが正でないイベントを無視します。`dropSilentNotes`（別名 `soundingNotesOnly`）はその方針を明示的に適用するもので、インポート直後に置くのに適しています。

```ts
import { dropSilentNotes } from '@libraz/libcantus';

dropSilentNotes([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 0 },
]).length; // 1
```

## 生成の予算

生成は同期的に実行されるため、100万小節の要求は失敗ではなくスレッドの停止として現れます。`assertGenerationBudget` は見積もりを上限と比較し、呼び出し側が待つと表明した以上の仕事量であれば `BudgetExceededError` を投げます。

```ts
import { assertGenerationBudget, DEFAULT_GENERATION_BUDGET, isLibcantusError } from '@libraz/libcantus';

DEFAULT_GENERATION_BUDGET; // 1000000

let code = 'ok';
try {
  assertGenerationBudget(5000, 'requested bars', 512);
} catch (error) {
  if (isLibcantusError(error)) code = error.code;
}
code; // 'BUDGET_EXCEEDED'
```

探索を伴う入り口 — `voiceProgression`、ドラムやベースのジェネレータ — は、それぞれ `budget` や `maxCandidates` を持ちます。これらが制限するのは答えの質ではなく仕事量です。`maxCandidates` を上げると、探索時間と引き換えに最適解へ近いボイシングが得られます。

## どこで検証するか

エンジンは自身の引数を検証するため、呼び出し側がすべてを事前に確認する必要はありません。`assert*` を置く場所は、型のないデータがアプリケーションに入る境界 — 開いたファイル、リクエストボディ、プラグインのパラメータ — です。その境界で問題のあるフィールド名を示すエラーは、3段先の呼び出しで投げられるエラーより有用です。
