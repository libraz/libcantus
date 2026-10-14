# Python

`libcantus` パッケージは、`ctypes` で C++ コアを呼び出します。TypeScript パッケージと同じ関数、クラス、定数を Python の綴りで公開し、結果はプレーンな dict と list で返します。挙動とエラーメッセージは TypeScript のリファレンス実装と一致します。異なる点は[C++ コアと面ごとの差](cpp.md)に挙げています。

## インストール

Python 3.10 以降が必要です。

```sh
pip install libcantus
```

wheel には、そのプラットフォーム向けの共有ライブラリが同梱されています。ソースのチェックアウトでは `build-shared/`（`make build-shared`）のライブラリを使います。別のファイルを読み込ませるには、環境変数 `CANTUS_LIB` を設定します。ライブラリは最初の呼び出しで読み込まれるため、パッケージを import するだけなら何も要りません。

## 最初の呼び出し

```python
import libcantus

libcantus.detect_chord_best([60, 64, 67])
# {'rootPc': 0, 'quality': 'maj', 'intervals': [0, 4, 7]}

chords = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]]
notes = [
    {"pitch": pitch, "startBeat": bar * 4, "durationBeat": 4}
    for bar, pitches in enumerate(chords)
    for pitch in pitches
]

timeline = libcantus.Score.of(notes).timeline()
[entry["roman"] for entry in timeline.roman()]
# ['I', 'IV', 'V7', 'I']
```

`Score`、`Chord`、`Key` などの model クラスは、クラス名もメソッドもそのままです。静的メソッドは `snake_case` になります（`Score.from_data`）。getter はプロパティです（`score.total_beats`）。

## 名前と引数

- 関数名とメソッド名は、TypeScript の名前を `snake_case` にしたものです。`detectChord` は `detect_chord`、`Score#withTempo` は `with_tempo` です。
- オプションオブジェクトは、キーワード専用引数になります。名前も `snake_case` です（`detect_chord(pitches, input="midi", bass_pc=0)`）。ただし、渡す dict の中のフィールド名は TypeScript の綴り（`startBeat`、`durationBeat`）のままです。その dict がデータそのものだからです。
- キーワード引数の既定値は `None` で、`None` は「渡していない」を意味します。位置引数の `None`、および dict や list の中の `None` は JSON の `null` として送られるので、TypeScript が `null` を検証するのとまったく同じに検証されます。
- 未知のキーワード引数は、Python 自身が `TypeError` にします。TypeScript は未知のオプションキーを無視します。
- `int` は 10 進の整数、`nan` と `inf` を含む `float` はタグ付きの数値、`bool` は真偽値として送られます。数値の位置に `bool` や `str` を渡すと、TypeScript と同じメッセージで拒否されます。

## 結果

結果は、TypeScript と同じフィールド名の dict と list です。次の 3 種類の値はオブジェクトで返ります。

- model のインスタンス（`Score`、`Timeline`、`Chord` など）は、薄い不変のラッパーです。メソッドとプロパティはコアを呼び出し、`repr` でデータを確認できます。
- `chord_timeline_from_chords` が返す `ChordTimeline` のようなハイブリッドは、データのフィールドを属性として、メソッドをメソッドとして公開します。`timeline.segments`、`timeline.at(5)` のように使います。
- ハンドルは次の節で説明します。

定数はモジュールから読みます（`libcantus.NAMED_SCALES`、`libcantus.ALGORITHM_VERSION`）。`libcantus.version()` と `libcantus.algorithm_version()` は読み込んだライブラリの版を、`libcantus.list_ops()` は登録済みの op を返します。

## ハンドル

可変な状態や、作り直すのが高価な状態はコアの中に置かれ、ハンドルで保持します。対象は `Rng`、`NoteEventIndex`、`ArrangementSession` です。`close()` か `with` ブロックで解放します。解放を忘れた場合は、保険としてガーベジコレクションが解放します。

```python
import libcantus

with libcantus.create_rng(1) as rng:
    rng.next()
# 0.6270739405881613
```

閉じたハンドルを使うと、コード `RELEASED_HANDLE` の `CantusError` になります。ハンドルごとに呼び出しをロックで直列化しますが、1 つのハンドルを複数のスレッドで並行に使うことは避けてください。

## コールバック

TypeScript の API が関数を受け取る場所には、Python の呼び出し可能オブジェクトを渡します。引数は TypeScript と同じで、インデックスも含みます。

```python
import libcantus

notes = [{"pitch": pitch, "startBeat": beat, "durationBeat": 1} for beat, pitch in enumerate([60, 64, 67])]
libcantus.Score.of(notes).filter(lambda note, index: note["pitch"] > 60).notes
# [{'pitch': 64, 'startBeat': 1, 'durationBeat': 1}, {'pitch': 67, 'startBeat': 2, 'durationBeat': 1}]
```

コールバックの中で起きた例外は、包まれずに元の例外のまま呼び出し元へ伝わります。

## エラー

| クラス | 併せて継承 | 発生する場面 |
| --- | --- | --- |
| `CantusError` | `Exception` | 以下すべての基底。`code` を持ちます。 |
| `InvalidInputError` | `ValueError` | `INVALID_INPUT`: 引数が拒否された。 |
| `NoSolutionError` | | `NO_SOLUTION`: 入力は妥当だが解がない。`at` を持ちます。 |
| `BudgetExceededError` | `ValueError` | `BUDGET_EXCEEDED`: 要求が予算を超えた。 |

`code` は `libcantus.ErrorCode` のメンバーです。`ErrorCode` は `IntEnum` で、値は[エラーと検証](errors-and-validation.md#面ごとのステータスコード)のステータス番号と一致します。専用のクラスを持たないコード（`HOST_TYPE_ERROR`、`UNKNOWN_OP`、`BAD_REQUEST`、`RELEASED_HANDLE`、`INTERNAL`）は、`CantusError` 自身で送出されます。型ガードには `libcantus.is_libcantus_error(value)` を使います。

```python
import libcantus

try:
    libcantus.detect_chord([128])
except libcantus.InvalidInputError as error:
    error.code == libcantus.ErrorCode.INVALID_INPUT
    str(error)
    # 'pitches[0] must be an integer in [0, 127]; received 128'
```

## コマンドライン

`python -m libcantus` は、コンソールスクリプトを置かずに `cantus` ツールと同じ契約を提供します。たとえば `python -m libcantus detectChordBest '[[60, 64, 67]]'` と実行します。詳しくは[コマンドライン](cli.md)を参照してください。

## 型

パッケージには `py.typed` が含まれ、`.pyi` は関数と同じ manifest から生成されます。エディタや `mypy --strict` はキーワード名を認識できます。結果はプレーンなデータなので、戻り値の型は `Any` です。
