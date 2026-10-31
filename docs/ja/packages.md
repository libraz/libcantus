# パッケージ構成

libcantus は 1 つの仕様を持つ 1 つのライブラリで、呼び出し方がいくつかあります。純 TypeScript がリファレンス実装で、C++17 のコアがそれを再現し、WebAssembly、Node、Python、コマンドラインの各面の土台になっています。どの面も、同じ関数、クラス、定数を同じ名前で公開し、同じ入力には同じ結果と同じエラーを返します。

## 面の一覧

| 面 | パッケージ | 入手先 | 動作環境 |
| --- | --- | --- | --- |
| 純 TypeScript | `@libraz/libcantus` | npm | Node.js 22 以降、ブラウザ、ワーカー |
| WebAssembly | `@libraz/libcantus-wasm` | npm | Node.js 22 以降、ブラウザ（ES2022） |
| Node ネイティブ | `@libraz/libcantus-node` | ソースからビルド。公開はしていません | Node.js 22 以降 |
| Python | `libcantus` | PyPI | Python 3.10 以降 |
| コマンドライン | `cantus` | GitHub のリリース資産 | macOS、Linux |
| C++ | CMake パッケージ `cantus` | `find_package`、`add_subdirectory`、FetchContent | C++17 のツールチェーン |

C++ コアの上に載る 2 つの JavaScript ビルド（`-wasm` と `-node`）は、純 TypeScript パッケージの型宣言を同梱しています。一方に対して書いたコードは、もう一方でもコンパイルできます。どちらも 1 つのファサードからビルドしているため、引数の符号化、結果の復号、エラーのクラスは同じです。

すべてのパッケージは同じバージョン番号を持ちます。

## 面の選び方

- **純 TypeScript** はネイティブコードを含まず、ツリーシェイキングでき、ESM と CommonJS の両方を提供します。依存をバンドルする Web アプリケーションや、`require()` が必要なコードに向いています。
- **WebAssembly** は、ネイティブビルドなしで JavaScript アプリケーションに C++ コアを持ち込みます。ESM のみで、トップレベル await でインスタンス化します。import が終われば、すべての呼び出しは同期です。
- **Node ネイティブ** は、同じファサードを Node-API アドオンの上に載せたものです。プラットフォームごとのビルドが必要なため公開していません。リポジトリのチェックアウトから使います。
- **Python** は `ctypes` でコアを呼びます。wheel が共有ライブラリを同梱しているので、インストールにコンパイラは要りません。
- **コマンドライン** は、プレーンなデータを取る op を、シェルやスクリプトから実行して JSON を出力します。
- **C++** は、ネイティブアプリケーション向けの型付き API で、ヘッダに JSON は現れません。

純 TypeScript と C++ コアを使う面の差は[C++ コアと面ごとの差](cpp.md)にまとめています。差は小さく、たとえばオブジェクトの同一性、型システム由来のいくつかの効果、モジュール形式があります。

## 面ごとのドキュメント

| 面 | ページ |
| --- | --- |
| 純 TypeScript | [使いはじめる](getting-started.md)と各分野のガイド |
| WebAssembly と Node | [C++ コアと面ごとの差](cpp.md) |
| Python | [Python](python.md) |
| コマンドライン | [コマンドライン](cli.md) |
| C++ | [C++ コアと面ごとの差](cpp.md) |
| 全面共通のエラーと端の値 | [エラーと検証](errors-and-validation.md) |

ガイドの例は TypeScript で書かれています。関数名はどの面でも対応します。`detectChord` は Python と C++ では `detect_chord`、コマンドラインでは `detectChord` です。

## 各面のインストール

純 TypeScript と WebAssembly:

```sh
yarn add @libraz/libcantus
yarn add @libraz/libcantus-wasm
```

Python:

```sh
pip install libcantus
```

コマンドラインツールは単体の実行ファイルです。リポジトリのリリースページから、お使いのプラットフォーム用のアーカイブ（`cantus-linux-x86_64.tar.gz`、`cantus-linux-aarch64.tar.gz`、`cantus-macos-arm64.tar.gz`）をダウンロードして展開し、中の `cantus` を `PATH` の通った場所に置きます。Linux 版は静的リンクなので、glibc のバージョンを問いません。macOS ではダウンロードしたバイナリに隔離属性が付くため、`xattr -d com.apple.quarantine cantus` で一度だけ外します。

## ソースからのビルド

チェックアウトからは、`make` ですべての面をビルドできます。ビルドは既定で 2 ジョブで動きます。変えるには `JOBS=` を指定します。

| コマンド | 結果 |
| --- | --- |
| `make build` | C++ コア、コマンドラインツール、C++ テストを `build/` に作る |
| `make test-cxx` | ビルドしてから C++ テストを実行する |
| `make wasm` | WebAssembly モジュールを含む `bindings/wasm/dist`（Emscripten が必要） |
| `make build-node` | Node-API アドオンと `bindings/node/dist` |
| `make build-shared` | Python バインディング用の `libcantus.{so,dylib}` |
| `make test-install` | 一時プレフィックスにインストールし、外部プロジェクトをそれに対してビルドする |
| `make examples` | `examples/` の例をビルドして実行する（ブラウザ向けのテンプレートを除く） |

Python バインディングは、チェックアウトでは `build-shared/` からライブラリを探します。別のファイルを読み込ませるには `CANTUS_LIB` を設定します。
