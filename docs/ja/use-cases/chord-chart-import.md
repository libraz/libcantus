# ユースケース: コード譜の取り込み

コード譜はテキストです。1小節に1つ、あるいは1小節に複数のコード記号が並びます。それをコードとして解析すること、時間上に配置すること、実際の音として実現することは3つの別の段階であり、それぞれ異なる失敗の仕方をします。

```ts
import {
  chordFromSpan,
  chordTimelineFromChords,
  chordPitchClasses,
  chordToRoman,
  detectKey,
  majorKey,
  tryParseChordSymbol,
  voiceChordStyled,
} from '@libraz/libcantus';

const chart = ['Dm7', 'G7', 'Cmaj7', 'A7(b9)'];

const parsed = chart.map((symbol) => tryParseChordSymbol(symbol));
const failures = chart.filter((_, index) => !parsed[index]?.ok);

failures; // []

const chords = parsed.flatMap((result) => (result.ok ? [result.value] : []));
const spans = chords.map((chord, bar) => ({
  rootPc: chord.rootPc,
  quality: chord.quality,
  startBeat: bar * 4,
}));

const timeline = chordTimelineFromChords(spans, chart.length * 4);
const guessed = detectKey(chords.flatMap((chord) => chordPitchClasses(chord)))[0]?.key;

timeline.segments.length; // 4
guessed?.rootPc; // 7

const key = majorKey(0);
timeline.segments.map((segment) => chordToRoman(segment.chord, key));
// ['ii7', 'V7', 'Imaj7', 'VI7b9']

const voicings = spans.map((span) => voiceChordStyled(chordFromSpan(span), { style: 'drop2' }));
voicings.length; // 4
```

## 解析

`tryParseChordSymbol` は失敗を値として返します。コード譜の取り込みで必要になるのはこの形です。認識できない記号が1つあるだけでファイル全体が中断してはいけません。失敗を集め、元の行とあわせて表示し、残りを取り込みます。

パーサは変化音、付加音、省略音、分数コードのベースを受け付けるため、コードが固定の名前一覧に含まれている必要はありません。クラス API では `Chord.tryParse` が同じ役割を持ちます。

## 調の推定

コード譜は調を書いていないことが多く、コードのピッチクラスをまとめて数えるのが、もっとも手軽な推定方法になります。上の例はその限界を示しています。`Dm7 G7 Cmaj7 A7(b9)` を重みなしで集計すると、結果は C ではなく G になります。14音のヒストグラムの中で、A7 の嬰ハが4小節分の根拠を上回るためです。

推定を良くする方法は2つあります。各コードが鳴る長さで重み付けし、2拍の経過的なコードが1小節保持されるコードより軽くなるようにすること。そして主音の候補を位置で重み付けし、コード譜の最終小節が3小節目より強く効くようにすることです。

いずれの場合も結果は提案として提示してください。イ短調のコード譜とハ長調のコード譜はピッチクラス集合を共有しており、どちらであるかを決めるのは音楽だけです。

## 配置

コード記号は長さを持ちません。1小節に1つか、1小節に2つか、コード譜自身の記法で示された分割かは、取り込み側が決めます。`chordTimelineFromChords` は配置済みのスパンと全体の長さを受け取り、後段のすべての関数が期待するタイムラインを返します。

## コード譜を音にする

`voiceChordStyled` はコンピング用のボイシングを直接組み立てます。音域探索がなく、スタイル名がそのまま響きを指します。歌ったり4声で演奏したりするコード譜には、代わりに音域を指定した `voiceProgression` を使います。[ボイシング](../voicing.md)を参照してください。

`generateBassLine` は `timeline.segments` の上にベースを書き、`chordToRoman` は推定した調に対して各コードにラベルを付けます。ユーザーに選ばせる代理和音については[リハーモナイズ](../reharmonization.md)を参照してください。
