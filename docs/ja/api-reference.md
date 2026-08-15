# API リファレンス

手書きのページはモデルとよく使うワークフローを説明します。シンボル単位の完全な参照は、公開 TypeScript エントリーポイントから TypeDoc が生成します。

## インポートパス

パッケージルートはすべての公開レイヤーを再エクスポートします。

```ts
import { Chord, Key, detectKey, generateMotif, parseNote } from '@libraz/libcantus';
```

より狭い境界にはサブパスを使えます。

```ts
import { parseNote, parseTimeSignature } from '@libraz/libcantus/core';
import { majorKey, scaleByName } from '@libraz/libcantus/theory';
import { detectKey, chordTimelineFromNotes } from '@libraz/libcantus/analyze';
import { generateBassLine, generateMotif } from '@libraz/libcantus/generate';
import { Chord, Key, Note } from '@libraz/libcantus/model';
```

`core` は基礎的な音高・時間・音律、`theory` は理論とボイシング、`analyze` は認識と分析、`generate` は素材とパート生成、`model` は不変クラスを提供します。

## 生成される TypeDoc

完全な API リファレンスは次で生成します。

```sh
yarn docs
```

TypeDoc の出力先は `docs/api` です。このディレクトリは `docs/en` と `docs/ja` の手書きガイドとは別で、直接編集しません。引数・戻り値・カテゴリ・例の正本はソースコメントです。生成済みリファレンスはプロジェクトの API-reference バッジからも公開されています。
