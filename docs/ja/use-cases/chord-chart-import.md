# ユースケース: コード譜の取り込み

コード譜はテキストです。1小節に1つ、あるいは1小節に複数のコード記号が並びます。それをコードとして解析すること、時間上に配置すること、実際の音として実現することは3つの別の段階であり、それぞれ異なる失敗の仕方をします。

```ts
import { Chord, Key, Progression } from '@libraz/libcantus';

const chart = ['Dm7', 'G7', 'Cmaj7', 'A7(b9)'];

const parsed = chart.map((symbol) => Chord.tryParse(symbol));
const failures = chart.filter((_, index) => !parsed[index]?.ok);

failures; // []

const chords = parsed.flatMap((result) => (result.ok ? [result.value] : []));

// A chart says nothing about how long a chord sounds; a bar each is the importer's choice.
const timeline = new Progression(chords).timeline(4);

timeline.segments.length; // 4
timeline.totalBeats; // 16

// The cheapest key guess is the pitch classes of the chords, pooled:
Key.detectBest(chords.flatMap((chord) => chord.pitchClasses()))?.rootPc; // 7

const key = Key.major('C');
timeline.roman(key).map((entry) => entry.roman);
// ['ii7', 'V7', 'Imaj7', 'VI7b9']
```

## 解析

`Chord.tryParse` は失敗を値として返します。コード譜の取り込みで必要になるのはこの形です。認識できない記号が1つあるだけでファイル全体が中断してはいけません。失敗を集め、元の行とあわせて表示し、残りを取り込みます。

パーサは変化音、付加音、省略音、分数コードのベースを受け付けるため、コードが固定の名前一覧に含まれている必要はありません。返るのは `Chord` で、`symbol()`、`pitchClasses()`、`roman(key)` といった問い合わせを自分で持ちます。コードを JSON として保存するホストには、`chord.data` がプレーンなオブジェクトを渡します。

## 調の推定

コード譜は調を書いていないことが多く、ピッチクラスをまとめて `Key.detectBest` に渡すのが、もっとも手軽な推定方法になります。上の例はその限界を示しています。`Dm7 G7 Cmaj7 A7(b9)` を重みなしで集計すると、結果は C ではなく G になります。14音のヒストグラムの中で、A7 の嬰ハが4小節分の根拠を上回るためです。

推定を良くする方法は2つあります。各コードが鳴る長さで重み付けし、2拍の経過的なコードが1小節保持されるコードより軽くなるようにすること。そして主音の候補を位置で重み付けし、コード譜の最終小節が3小節目より強く効くようにすることです。

いずれの場合も結果は提案として提示してください。イ短調のコード譜とハ長調のコード譜はピッチクラス集合を共有しており、どちらであるかを決めるのは音楽だけです。

## 配置

コード記号は長さを持ちません。1小節に1つか、1小節に2つか、コード譜自身の記法で示された分割かは、取り込み側が決めます。等間隔の場合は `Progression.timeline(beats)` がすべてのコードに同じ長さを与えます。コード譜が小節を分割している場合は、`Chord.span(startBeat)` で1つずつ位置を決め、そのスパンからタイムラインを組み立てます。

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const key = Key.major('C');
const spans = [Chord.parse('Dm7').span(0), Chord.parse('G7').span(2), Chord.parse('Cmaj7').span(4)];

const timeline = Timeline.fromChords(spans, 8, key);

timeline.segments.map((segment) => [segment.startBeat, segment.endBeat]);
// [[0, 2], [2, 4], [4, 8]]
timeline.at(3)?.symbol(); // 'G7'
```

タイムラインは調を自分で持ち歩くため、後段に調をもう一度伝える必要はありません。

## コード譜を音にする

`Voicing.forChord` はコンピング用のボイシングを直接組み立てます。音域探索がなく、スタイル名がそのまま響きを指します。もう1つの実現の仕方が `Progression.voice` で、こちらは声部の動きをなめらかに保った4声を返します。歌ったり複数のパートで演奏したりするコード譜にはこちらを使います。ベースは `Composer` が同じタイムラインの下に書き、調はタイムラインが持っているものがそのまま使われます。

```ts
import { Chord, Composer, Key, Progression, Voicing } from '@libraz/libcantus';

const key = Key.major('C');
const progression = new Progression(
  ['Dm7', 'G7', 'Cmaj7', 'A7(b9)'].map((symbol) => Chord.parse(symbol)),
  key,
);

const comping = progression.chords.map((chord) => Voicing.forChord(chord, { style: 'drop2' }));
comping[0]?.pitches; // [57, 62, 65, 72]

const parts = progression.voice();
parts[0]; // [50, 60, 65, 69]

const bass = Composer.of({ key, bpm: 96, seed: 3 }).bass(progression.timeline(4), {
  style: 'walking',
});
bass.notes.length; // 16
```

音域を明示して声部を配置する場合は[ボイシング](../voicing.md)を参照してください。ユーザーに選ばせる代理和音は `progression.substitute` がその場で置き換えます。[リハーモナイズ](../reharmonization.md)を参照してください。
