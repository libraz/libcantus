# エラーと検証

このライブラリが投げる失敗は3種類のいずれかに分類され、種類によって呼び出し側の対処が決まります。メッセージ文字列は契約にならないため、種類は `code` としてエラーに載ります。C++ コアの上に載る面では、ホスト言語とコアの境界で使うコードがいくつか加わります。[面ごとのステータスコード](#面ごとのステータスコード)を参照してください。

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

## 不正なテキストを例外にしない解析

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

`ParseResult<T>` は `{ ok: true; value: T }` または `{ ok: false; error: LibcantusError }` です。不正な文字列を `null` に潰さず結果に載せるのは、入力欄が「入力された文字列の何が不正なのか」を表示する必要があるためです。テキストを読むパーサはいずれもこの対を持ちます。音名、音程、コードネーム、調名、拍子記号のすべてです。クラス API も、テキストを読むクラスごとに同じ対を持ちます。`Note.parse`、`Interval.parse`、`Key.parse`、`Chord.parse`、`Meter.parse` に対して `Note.tryParse`、`Interval.tryParse`、`Key.tryParse`、`Chord.tryParse`、`Meter.tryParse` です。

パーサの options はテキストではなく API の引数です。解析より先に検証されるため、JavaScript から来た `null` を含む不正な options は、投げる形式でも `try*` 形式でも `InvalidInputError` になります。options が不要なら省略し、入力途中の文字列だけを `ParseResult` で扱います。

例外を投げるパーサは、いずれも投げないパーサの上に実装されています。`parseNote` と `tryParseNote` が妥当性の判定でずれることはありません。

音・調・和音を受け取るエントリポイントは、（[相互運用](interoperability.md)に挙げたデータ層のヘルパーを除いて）データだけでなくテキスト形式も受け取り、同じパーサで読みます（[相互運用](interoperability.md)を参照）。したがってこれらの関数は、何も指していない文字列に対して `InvalidInputError` を投げることがあります。プレーンデータの形では、値の範囲外でしか失敗しえなかったところです。名前が自分のコードではなく利用者から届く場面では、先に `try*` の側で解析し、その結果を渡してください。そうすれば失敗は、入力された欄そのもので表面化します。数回先の呼び出しではなく。

## ホストから渡された値の検証

TypeScript が文字列ユニオンを検査するのはコンパイル時だけです。JSON、プロジェクトファイル、プラグインホスト、JavaScript の呼び出し元から来た値は無検査のままエンジンに届き、対応する項目のないテーブルを引くことになります。同じ検査を自分の境界で使えるよう、`assert*` 系は公開されています。

```ts
import { assertMidiPitch, assertNoteEvents, assertOneOf, clampToMidi } from '@libraz/libcantus';

assertMidiPitch(60); // 60
assertOneOf('walking', ['pop', 'walking', 'root'], 'bass style'); // 'walking'
clampToMidi(140); // 127

assertNoteEvents([{ pitch: 60, startBeat: 0, durationBeat: 1 }]).length; // 1
```

`assertChordTimeline` は、アプリケーションの別の場所ですでに作られたタイムラインにも同じ境界検証を行います。`at` 関数、区間の配列、各区間の有限な境界を要求し、同じタイムラインを返します。JSON の値は `at` を持たないため、この検証に渡す前にタイムラインへ復元する必要があります。

```ts
import { assertChordTimeline, chordTimelineFromChords } from '@libraz/libcantus';

const timeline = chordTimelineFromChords([], 4);
assertChordTimeline(timeline) === timeline; // true
```

いずれの関数も引数をそのまま返すため、独立した1行を割かずに値を包めます。`assertMidiPitch` と `clampToMidi` はどちらも整数を要求します。MIDI のバイトは小数を載せられないためです。両者の違いは範囲の扱いだけで、`assertMidiPitch` は 0..127 を外れたピッチを拒否し、`clampToMidi` は 0..127 に丸めます。インポート処理では後者が適することが多いです。

ノートイベントも同じ規則に従います。`pitch` は 0..127 の整数で、イベントが `velocity` を持つ場合もその領域は同じであり、検査のしかたも同じです。96.5 という velocity は上流で丸め損ねた値であり、これを通せば、フォーマットが保持できないノートを書き出し側に渡すことになります。イベントが `articulation` を持つ場合は、ライブラリが知る名前の一覧に照らして検査されます。綴り違いの奏法は入力の誤りとして扱われ、「その楽器はその奏法で演奏できない」という音楽上の主張にはなりません。`startBeat` と `durationBeat` は MIDI のバイトではなく拍なので、0..127 に限られません。どちらも絶対値が `Number.MAX_SAFE_INTEGER` 以内の有限値でなければならず（`startBeat` の下限は `minStartBeat` で引き上げられます）、`durationBeat` は `allowNonPositiveDuration` を指定しない限り正である必要があります。

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

集計を行う解析側の入り口は、長さが正でないイベントを無視します。音符ごとに結果を返す `analyzeVoice` と `spellLine` は、入力イベント1つにつき1件を返し、そうしたイベントも残します。`dropSilentNotes`（別名 `soundingNotesOnly`）はその方針を明示的に適用するもので、インポート直後に置くのに適しています。

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

## 面ごとのステータスコード

C++ コア、WebAssembly と Node のパッケージ、Python、コマンドラインは、1 つのエラー表を共有しています。ライブラリ自身が投げるのは、前述の 3 種類だけです。ホスト言語とコアの境界では、音楽的な入力とは関係のない失敗のためのコードが加わります。言語レベルの型エラー、未知の op、不正な要求、解放済みのハンドル、内部の障害です。各コードには固定のステータス番号があり、コマンドラインツールでは該当するものがそのまま終了コードになります。

| コード | ステータス | 発生する場面 | C++ 型付き API | JavaScript | Python | CLI 終了コード |
| --- | --- | --- | --- | --- | --- | --- |
| `INVALID_INPUT` | 1 | 引数が拒否された | `InvalidInputError` | `InvalidInputError`（`RangeError`） | `InvalidInputError`（`ValueError`） | 1 |
| `NO_SOLUTION` | 2 | 入力は妥当だが解がない | `at()` を持つ `NoSolutionError` | `at` を持つ `NoSolutionError` | `at` を持つ `NoSolutionError` | 2 |
| `BUDGET_EXCEEDED` | 3 | 要求が予算を超えた | `BudgetExceededError` | `BudgetExceededError`（`RangeError`） | `BudgetExceededError`（`ValueError`） | 3 |
| `HOST_TYPE_ERROR` | 4 | メッセージに `Symbol` を埋め込むなど、言語自身が値を拒否した | 発生しない | `TypeError`。メッセージは純 TypeScript と同じ | `CantusError` | 4 |
| `UNKNOWN_OP` | 10 | op 名が登録されていない | 発生しない | `code` を持つ `Error` | `CantusError` | 10 |
| `BAD_REQUEST` | 11 | 要求の形式が不正（未知の `$` タグ、深すぎる JSON の入れ子など） | 発生しない | `code` を持つ `Error` | `CantusError` | 11 |
| `CALLBACK_FAILED` | 12 | 渡したコールバックが例外を投げた | 例外がそのまま伝わる | 元の例外を再送出する | 元の例外を再送出する | 発生しない |
| `RELEASED_HANDLE` | 13 | 解放済みのハンドルを使った | 発生しない | `code` を持つ `Error` | `CantusError` | 発生しない |
| `INTERNAL` | 99 | コア内部のそれ以外の失敗 | `std::exception` | `code` を持つ `Error` | `CantusError` | 99 |

エラーのクラスは TypeScript の分類に従います。型の誤りも値域の誤りも `InvalidInputError` です。メッセージはどの面でも一語一句同じなので、TypeScript で照合しているメッセージは他の面でもそのまま一致します。3 つのライブラリのクラスへの絞り込みには、JavaScript では `isLibcantusError`、Python では `is_libcantus_error`、C++ では `cantus::is_libcantus_error` を使います。コマンドラインは、エラーオブジェクト `{ "code", "name", "message", "at"? }` を標準エラー出力に出します。

```js
import { InvalidInputError, detectChord, isLibcantusError } from '@libraz/libcantus-wasm';

try {
  detectChord([128]);
} catch (error) {
  if (!isLibcantusError(error)) throw error;
  error.code === 'INVALID_INPUT' && error instanceof InvalidInputError;
}
```

```python
import libcantus

try:
    libcantus.detect_chord([128])
except libcantus.CantusError as error:
    error.code == libcantus.ErrorCode.INVALID_INPUT
```

```cpp
#include <cantus/cantus.h>

try {
  cantus::detect_chord({128});
} catch (const cantus::Error& error) {
  bool invalid = error.code() == cantus::ErrorCode::kInvalidInput;
}
```

## 面ごとの端の値

各行は純 TypeScript の挙動で、列に断りがない限り、どの面も同じ結果か同じエラーを返します。コマンドラインと Python が送れるのは JSON で表せる値だけなので、JSON にない値（`undefined`、bigint、`Symbol`）の行は JavaScript の面にだけ当てはまります。

| 入力 | 挙動 | C++ 型付き API | Python と JSON の面 |
| --- | --- | --- | --- |
| 0 | 範囲内の値はそのまま使われます。0 小節の生成は拒否されます: `rhythm bars must be an integer in [1, 1000000]; received 0`。 | 同じ | 同じ |
| 負のゼロ | 検証は `-0` をそのまま返し、結果が `-0` になるものもあります。`+0` に正規化する箇所も一部にあります。`String(-0)` は `"0"` です。 | `double` が `-0` を保持する | ワイヤ上は `{"$n": "-0"}`。Python では `-0.0` |
| `NaN` | 拒否されます: `midi must be finite; received NaN`。配列の穴や `null` の要素も、コードが `NaN` として読む箇所では同じメッセージになります。 | 同じ | `{"$n": "NaN"}`。Python では `float("nan")` |
| `Infinity`、`-Infinity` | 拒否されます: `received Infinity`。音律の結果は `[5e-324, 1.7976931348623157e+308]` の範囲で検査されます。 | 同じ | `{"$n": "Infinity"}`。JSON の `1e400` は `Infinity` として読まれる |
| 引数としての `null` | 検証で拒否されます: `opts must be an object; received null`。 | 起きない。型が排除する | 同じメッセージ。位置引数の `None` は `null` として送られる |
| オプション値としての `null` | 多くのオプションでは既定値として扱われ、一部では拒否されます。省略と `null` を区別するオプションだけが違いを保ちます。 | 起きない | オプションごとに同じ。`None` のままのキーワードは送られない |
| list や dict の中の `null` | その要素の検査で拒否されるか、`NaN` として読まれます。 | 起きない | `null` として送られるので、同じ検査が働く |
| 欠落、または `undefined` | 省略したオプションは `{}` になり、省略した引数は既定値になります。 | `std::optional` | キーが無い。配列の中の `undefined` は `{"$u": 1}` |
| `undefined` を入れたフィールド | `in` で調べる検査と、明示的な `undefined` を拒否する検査の 2 か所では「ある」と数えられます。 | 起きない | ワイヤ上で省略され、「無い」と数えられる（[C++ コアと面ごとの差](cpp.md)を参照） |
| 空の list や文字列 | `detectChord([])` は `[]`、`detectChordBest([])` は `null`、`parseChordSymbol('')` は `Invalid chord symbol: ""` で失敗します。空の meter map と tempo map は拒否されます。 | 同じ | 同じ |
| 限界値 | 範囲はすべて閉区間です。pitch と velocity は `0..127`、seed は `0..0xffffffff`、テンポは `0.1..1000`（context のテンポは `Number.MIN_VALUE` から）、ppq は `1e6` 以下、予算は `1e6` 以下です。 | 同じ定数 | 同じ |
| 限界の 1 つ外 | 拒否されます: `must be an integer in [0, 127]; received 128`。`midiToNote` と `pitchClassOf` は有限の任意の数を受け取り、丸めて使います。 | 同じ | 同じ |
| 2^31、2^32、2^53 を超える値 | safe integer の検査で、範囲外が拒否されます。 | 検査してから狭めます。ただし呼び出し側の暗黙変換が先に起きます（下記参照） | double はワイヤ上で検査される。Python の `int` は 10 進で送られる |
| 整数の位置の小数 | 拒否されます: velocity の `63.7`。 | 検査の前に C++ が変換するので、`63` として届くことがある | 拒否される |
| 数値の位置の真偽値や文字列 | 拒否されます: `received true`、`received 5`。 | 起きない | 拒否される |
| 数値の位置の `toJSON` を持つオブジェクト | 拒否されます: `received [object Object]`、または利用者の `toString` の結果。 | 起きない | JavaScript のファサードが `{"$tojson": …, "$repr": …}` のタグで送る |
| データとして読む位置の `toJSON` を持つオブジェクト | `toJSON` の結果が使われます。 | `.data()` を持つ型を受け付ける | JavaScript のファサードでは使われ、Python では dict |
| `Symbol` | 言語自身の `TypeError` になります。 | 起きない | `HOST_TYPE_ERROR`。JavaScript では `TypeError`、Python では `CantusError` |
| `bigint` | 拒否されます: `received 10`。 | 起きない | JavaScript では `{"$big": "10"}`。Python では `int` |
| 未知のオプションキー | 無視されます。 | 起きない | ワイヤ上では無視される。Python のキーワード引数では `TypeError` |
| 非 ASCII の文字列と孤立サロゲート | 長さと切り詰めは UTF-16 コードユニットで数えます。 | WTF-8 で保持し、UTF-16 コードユニットで数える | WTF-8 で読み、`\udXXX` のエスケープで書く。Python は `surrogatepass` |
| 浮動小数の出力 | beats、seconds、Hz、cents、スコア。 | TypeScript とビット単位で一致 | 往復可能な最短の表記。Python では `float` |

符号なし整数として宣言された位置に `-1` を、`int` として宣言された位置に `63.7` を渡す C++ の呼び出しでは、検証の前に数値が変換されます。これは規則が違うのではなく C++ の型システムによるもので、double を受け取る JSON の面では、同じ値が拒否されます。値が外部から来る場合は、境界で検証してください。
