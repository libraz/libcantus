# C++ コアと面ごとの差

このライブラリは C++17 のコアを持ち、結果もエラーメッセージも TypeScript のリファレンス実装と一語一句そろえています。WebAssembly、Node、Python、コマンドラインツールは、すべてこのコアの上に載った薄い層です。このページでは、C++ からコアを使う方法、層の構成、純 TypeScript と挙動が異なりうる点を説明します。どの面を何からインストールするかは[パッケージ構成](packages.md)にまとめています。

## C++ ライブラリを使う

パッケージ名は `cantus` で、次のターゲットを公開します。

| ターゲット | 提供するもの | リンクする場面 |
| --- | --- | --- |
| `cantus::cantus` | `include/cantus/` 以下の型付き C++ API。ヘッダに JSON の型は現れません。 | ライブラリを直接呼ぶアプリケーション。 |
| `cantus::ops` | JSON の op レイヤー（`cantus/ops.h`）と C ABI（`cantus/cantus_c.h`）。 | JSON をやり取りするホスト、またはバインディング。 |
| `cantus::shared` | 共有ライブラリとしての C ABI。`CANTUS_BUILD_SHARED=ON` のときだけビルドされ、この名前でリンクできるのはインストール済みパッケージからだけです。 | 共有ライブラリを読み込む言語ランタイム。 |

インストール済みのプレフィックスからは次のように使います。

```cmake
find_package(cantus REQUIRED)
target_link_libraries(app PRIVATE cantus::cantus)
```

ソースから取り込む場合、`cantus::cantus` と `cantus::ops` は同じ名前です。`cantus::shared` はインストール済みパッケージにだけ存在し、ソースビルドでは代わりに `cantus_shared` ターゲットをビルドします。

```cmake
include(FetchContent)
FetchContent_Declare(cantus GIT_REPOSITORY https://github.com/libraz/libcantus.git GIT_TAG main)
FetchContent_MakeAvailable(cantus)
target_link_libraries(app PRIVATE cantus::cantus)
```

`add_subdirectory` でも同じです。ライブラリがトップレベルのプロジェクトでないとき、テスト、コマンドラインツール、インストール規則は無効になります。オプションは次のとおりです。

| オプション | 既定値（トップレベルのとき） | 効果 |
| --- | --- | --- |
| `CANTUS_BUILD_TESTS` | `ON` | Catch2 のテストをビルドします。 |
| `CANTUS_BUILD_CLI` | `ON` | `cantus` コマンドラインツールをビルドします。 |
| `CANTUS_BUILD_SHARED` | `OFF` | Python バインディング用に `libcantus.{so,dylib}` をビルドします。 |
| `CANTUS_INSTALL` | `ON` | インストール規則と `find_package` 用の設定を生成します。 |

CMake 3.24 と C++17 のコンパイラが必要です。C++ API の変更は SemVer のメジャー変更として扱います。

## 型付き API

ヘッダはレイヤーごとに `<cantus/core/…>` から `<cantus/model/…>` まで分かれていて、`<cantus/cantus.h>` が全部を読み込みます。すべて `namespace cantus` に入っており、レイヤーはヘッダのパスにだけ現れます。

```cpp
#include <cantus/cantus.h>

#include <cstdio>
#include <string>

int main() {
  std::vector<cantus::ChordMatch> matches = cantus::detect_chord({60, 64, 67});
  const cantus::ChordMatch& best = matches.front();
  std::printf("%d %s\n", best.rootPc, std::string(cantus::to_string(best.quality)).c_str());

  try {
    cantus::detect_chord({128});
  } catch (const cantus::InvalidInputError& error) {
    std::printf("%s\n", error.what());
  }
}
```

TypeScript からの対応は機械的です。

- 関数は `snake_case` になります（`detectChord` は `detect_chord`）。型名と定数名は TypeScript のままです。
- 省略可能なフィールド `x?: T` は `std::optional<T>` です。`T | null` は `cantus::Nullable<T>` で、`null` として直列化されます。文字列リテラルの合併型は `to_string` と `parse_…` を持つ `enum class`、オブジェクトの合併型は `std::variant` です。
- オプションは、全フィールドが省略可能な集成体の構造体です（`DetectChordOptions`）。
- コールバックは `std::function` で受けます。コールバックの中で投げた例外は、そのまま呼び出し元に伝わります。
- model のクラスは `data()` を持つ不変の値型です。変形するメソッドは新しいインスタンスを返します。
- エラーは `std::runtime_error` を継承した `cantus::Error` から派生し、`code()` を持ちます。種類は `InvalidInputError`、`NoSolutionError`（`at()` つき）、`BudgetExceededError` です。メッセージは TypeScript と同一です。`try_…` のパーサは `ParseResult<T>` を返します。
- 数値は `double` です。ただし TypeScript が整数として検証する値は、検証範囲が収まる最小の固定幅整数型になります。

コアはグローバルな可変状態を持ちません。オブジェクトはスレッド間で共有しないでください。別々のインスタンスなら並行に使えます。

## JSON の op レイヤーと C ABI

すべてのバインディングは、1 つの入口を通ります。op は名前（`detectChord`、`Score.fromData`、`Score#transpose`、`$const:NAMED_SCALES`）で指定し、引数の JSON 配列を受け取って JSON を返します。同一プロセス内で使う形が `cantus::ops::call` です。

```cpp
#include <cantus/ops.h>

#include <cstdio>

int main() {
  cantus::ops::Result chord = cantus::ops::call("detectChordBest", "[[60, 64, 67]]");
  std::printf("%s\n", chord.json.c_str());
}
```

失敗しても例外は投げません。`status` が `CantusStatus` で、`json` は `{ "code", "name", "message", "at"? }` の形のオブジェクトです。ホストのコールバックやハンドルを必要とする op は、`call` では `BAD_REQUEST` で拒否されます。そうした op には、コールバック関数を渡せる `cantus/cantus_c.h` の `cantus_call` を使います。ステータスの一覧は[エラーと検証](errors-and-validation.md#面ごとのステータスコード)にあります。

JSON で表せない値は、タグ付きオブジェクトで運びます。`NaN`、`Infinity`、`-Infinity`、`-0` は `{"$n": "NaN"}`、配列内の `undefined` は `{"$u": 1}`、bigint は `{"$big": "10"}`、model クラスは `{"$class": "Chord", …}`、ハンドルは `{"$h": 1, "$type": "Rng"}`、コールバックは `{"$cb": 1}` です。利用者のキーが `$` で始まる場合は `$$` と書きます。JavaScript のファサードと Python のバインディングはこの変換を自動で行い、コマンドラインだけはワイヤ形式をそのまま受け取ります（[コマンドライン](cli.md#ワイヤ形式)）。

## どの面でも同じ答え

すべての面は 1 つの仕様を共有しています。共有のテストスイートは純 TypeScript、WebAssembly ビルド、ネイティブアドオンに対して実行されます。また、記録した呼び出しのコーパスを C ABI、Python、コマンドライン、2 つの JavaScript バックエンドで再生しています。結果、エラーの種類、エラーメッセージは一致します。浮動小数の結果もプラットフォームをまたいでビット単位で一致します。コアは `-ffp-contract=off` でコンパイルし、`double` だけを使い、V8 の `Math.log2`、`Math.exp`、`**` を移植して、libm の差が結果に出ないようにしています。`Math.round`、`sort`、数値の書式化は、C++ 標準ライブラリではなく ECMAScript の規則に従います。

既定値は C++ だけが持ちます。JavaScript のファサードと Python のバインディングは、省略した引数を省略のまま送るため、同じ呼び出しはどの面でも同じ答えになります。

## 純 TypeScript との差

以下の差は意図したもので、すべてを挙げています。ここにない差があれば不具合です。

**型付き API の暗黙変換。** 型付き C++ API の数値引数は、検証より前に C++ の規則で変換されます。`-1` は `uint32_t` になり、`63.7` は `int` になります。TypeScript なら拒否される値が、範囲内の値として届くことがあります。JSON の面は double で受け取って TypeScript と同じ検証をするので、たとえば velocity の `63.7` は拒否されます。

**Python の未知のキーワード引数。** Python は未知のキーワード引数を `TypeError` にします。TypeScript は未知のオプションキーを無視します。

**明示的な `undefined`。** `undefined` を入れたオブジェクトのフィールドはワイヤ上で省略されるため、省略との違いを調べる検査では「無い」と見なされます。データから拍子を読むときの `'numerator' in data` の判定が該当します。明示的な `undefined` を拒否する検査（countermelody の重み）は、省略されたフィールドを受理します。

**循環した引数。** JSON は循環を表せません。自分自身を含む引数は、繰り返し部分が空のオブジェクトまたは配列に切られて渡され、ファサードは切られた値が満たさない条件を報告します。純 TypeScript は循環そのものを報告します。

**オブジェクトの同一性。** 呼び出しごとに引数は新しいコピーを受け取り、結果も毎回新しくデコードされた値です。同一性が保たれるのは、ハンドルの getter が返すオブジェクト、ハンドル自身、そのまま返された `ChordTimeline` だけです。結果として、以前の結果と `toBe` で比べても別のオブジェクトになり、純 TypeScript が tempo map や meter map に対して持つオブジェクト単位のキャッシュも効きません。結果は変わらず、失われるのは節約だけです。

**ハイブリッド値のフィールドへの再代入。** ハイブリッド値のフィールドに再代入すると（`timeline.segments = other` など）、次のメソッド呼び出しでその値がコアへ送られるため、`timeline.at(beat)` は新しい segments から答えます。純 TypeScript は検索表を一度だけ作り、元の segments から答え続けます。

**モジュール単位のメモがない。** TypeScript が持つ、スケールの綴りのキャッシュを C++ コアは持ちません。同じ問いは毎回計算し直しますが、結果は同じです。

**ハンドル。** `Rng`、`NoteEventIndex`、`ArrangementSession` はコアの中にあり、明示的に解放します。JavaScript ではハンドルが `[Symbol.dispose]` を持ち、保険としてファイナライザが働きます。Python では `close()`、コンテキストマネージャ、`__del__` があります。解放済みのハンドルを使うと、コード `RELEASED_HANDLE` のエラーになります。同じハンドルを複数のスレッドから同時に使うことはできません。

**WebAssembly は ESM のみ。** モジュールはトップレベル await でインスタンス化されるため、import が終わった後はすべての呼び出しが同期になります。`require()` では `ERR_REQUIRE_ASYNC_MODULE` で失敗します。CommonJS のアプリケーションは純 TypeScript を使ってください。ブラウザ向けのバンドラは、ターゲットを es2022 以上にする必要があります。

**凍結される結果。** 結果は純 TypeScript が凍結するところだけが凍結され、凍結された結果への書き込みは strict mode で同じ `TypeError` になります。多くの結果は、どちらでも変更可能です。

端の値（`NaN`、`-0`、`null`、空の入力、範囲の限界）の挙動は、[エラーと検証](errors-and-validation.md#面ごとの端の値)で定義しています。

## スレッドとサイズの上限

- op レイヤーはスレッドセーフで、ハンドル表はミューテックスで守られています。1 つのハンドルを複数のスレッドから同時に使うことは、契約の対象外です。
- JSON パーサは、入れ子の深さを 4096 まで受け付けます。それより深い入力は `BAD_REQUEST` です。
- 文字列は UTF-8 で運び、孤立サロゲートは保持（WTF-8）して、`\udXXX` のエスケープで書き戻します。長さと切り詰めは、JavaScript と同じく UTF-16 コードユニットで数えます。
