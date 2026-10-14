# コマンドライン

`cantus` は、ライブラリの op を 1 つ実行して、結果を JSON で出力します。すべてのバインディングが通るのと同じ入口の背後にある C++ コアなので、プレーンなデータを取る op なら、シェルやスクリプトから呼び出せます。

## 使い方

```sh
cantus <op> [ARGS_JSON | @file | -]
cantus list
cantus describe <op>
cantus version
```

`<op>` には、関数（`detectChord`）、静的メソッド（`Score.fromData`）、第 1 引数をレシーバとするインスタンスメソッド（`Score#transpose`）、定数（`$const:NAMED_SCALES`）の TypeScript 名を指定します。引数は位置引数をまとめた 1 つの JSON 配列で、コマンドラインの 1 語として渡すか、`@path` でファイルから、`-` で標準入力から読みます。省略すると引数なしになります。

```sh
cantus detectChordBest '[[60, 64, 67]]'
echo '[[60, 64, 67]]' | cantus detectChordBest -
cantus midiToNote '[61, "flat"]'
cantus '$const:ALGORITHM_VERSION'
```

最初のコマンドは `{"rootPc":0,"quality":"maj","intervals":[0,4,7]}` を出力します。`cantus list` は登録済みの全 op を、`callbacks` と `handles` のフラグつきで出力します。`cantus describe detectChord` は 1 件分を、`cantus version` はライブラリのバージョンを JSON 文字列で出力します。

`python -m libcantus` も同じ引数を受け取り、同じ出力と終了コードを返します。

## 結果とエラー

結果は標準出力に JSON で出ます。失敗は標準エラー出力に、`code`、`name`、`message`、そして列の途中で起きた `NO_SOLUTION` の場合は `at` を持つオブジェクトとして出ます。失敗の種類は終了コードで区別できます。

| 終了コード | 意味 |
| --- | --- |
| 0 | 成功 |
| 1 | `INVALID_INPUT` |
| 2 | `NO_SOLUTION` |
| 3 | `BUDGET_EXCEEDED` |
| 4 | `HOST_TYPE_ERROR` |
| 10 | `UNKNOWN_OP` |
| 11 | `BAD_REQUEST`: 引数の形式が不正、`@file` を読めない、または未対応の op |
| 99 | `INTERNAL` |

```sh
cantus detectChord '[[200]]'
```

このコマンドは、標準エラー出力に `{"code":"INVALID_INPUT","name":"InvalidInputError","message":"pitches[0] must be an integer in [0, 127]; received 200"}` を出力し、終了コード 1 で終わります。ステータスの番号は[エラーと検証](errors-and-validation.md#面ごとのステータスコード)のものと同じです。

コールバックやハンドルを必要とする op（`Score#filter`、`createRng`、`Rng#next`）は、`BAD_REQUEST` とメッセージ `callback arguments are not available from the CLI` で拒否されます。1 回の実行は 1 回の呼び出しで、実行をまたいだ状態は保持されません。

## ワイヤ形式

引数と結果は C ABI のワイヤ形式で、JSON にいくつかのタグ付きオブジェクトを足したものです。`$` で始まるキーを持つオブジェクトはすべてタグとして扱われるため、コマンドラインは意図を推測しません。

| タグ | 値 |
| --- | --- |
| `{"$n": "NaN"}` | JSON で持てない数。`"NaN"`、`"Infinity"`、`"-Infinity"`、`"-0"` のいずれか |
| `{"$u": 1}` | 配列の中の `undefined` の要素 |
| `{"$big": "10"}` | bigint を 10 進の文字列で表したもの |
| `{"$class": "Chord", …}` | model クラスのインスタンス。データのフィールドを持ちます |

未知の `$` タグは `BAD_REQUEST` です。自分のキーが `$` で始まる場合は `$$` と書きます。結果にそうしたキーがあれば、同じ形で出力されます。

```sh
cantus '$echo' '[{"$$note": 1}]'
```

このコマンドは `{"$$note":1}` を出力します。キーが `$note` のオブジェクトです。JavaScript と Python のバインディングは `$` の二重化と復元を自動で行うので、これが見えるのはコマンドラインだけです。

`1e400` は `JSON.parse` と同じく `Infinity` として読みます。文字列中の孤立サロゲートのエスケープ（`"\ud800"`）は受理され、エスケープのまま書き戻されます。入れ子が 4096 段を超えると `BAD_REQUEST` です。

## スクリプトでの利用

失敗ごとに終了コードが異なり、出力も構造化されているので、スクリプトはメッセージを解析せずに分岐できます。

```sh
if ! voiced=$(cantus voiceProgression "$args" 2>err.json); then
  status=$?
  [ "$status" -eq 2 ] && echo "no voicing fits"
fi
```

結果をさらに処理するには、JSON を扱うツールにパイプします。出力に空白は含まれず、オブジェクトのキーはライブラリが生成した順序のままです。
