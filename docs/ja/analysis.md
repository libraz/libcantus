# 解析

解析は構造化された結果を返します。答えに加えて、その選択に使った根拠と、対応する API では退けた候補も保持します。

クラス API は、値そのものに問いを投げます。ピッチから認識した `Chord`、自身の終止を知っている `Timeline`、フレーズを言い当てられる `Score` といった具合です。関数 API は同じプレーンなデータを受け取り、同じ結果を返します。どちらか一方にしかできないことはないので、解析のコードはどちらの書き方でも構いません。

このページの結果はいずれも、根拠に支えられた読みであって、音符から復元された事実ではありません。結果を提示する UI は、根拠となる数値をあわせて表示し、上書きできるようにしてください。

## コードの認識

`Chord.detectBest` は MIDI ピッチからコードを認識し、`Chord.detectMatches` は根拠をあわせて返します。

```ts
import { Chord } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'

const [best] = Chord.detectMatches([60, 64, 67]);

best?.chord.symbol(); // 'C'
best?.match.quality; // 'maj'
best?.match.exact; // true
best?.match.inversion; // 0

Chord.detectMatches([64, 67, 72])[0]?.match.inversion; // 1
```

関数側の入り口は、クラス値をかぶせずに同じ順位づけをプレーンなデータで返します。

```ts
import { detectChord, detectChordBest } from '@libraz/libcantus';

detectChordBest([60, 64, 67])?.rootPc; // 0

const match = detectChord([60, 64, 67])[0];
match?.quality; // 'maj'
match?.exact; // true
match?.inversion; // 0

detectChord([64, 67, 72])[0]?.inversion; // 1
```

`detectChordBest` と `Chord.detectBest` はそのまま使えるコードを返し、`detectChord` と `Chord.detectMatches` は順位づけされた `ChordMatch` を返します。答えと同じくらい根拠が重要な場面で使うのは後者です。`ChordMatch` は、入力に含まれないコード構成音を `missingPcs`、コードに属さない入力ピッチを `extraPcs` として報告し、両者の集合が一致する場合に `exact` が真になります。`inversion` は転回形を特定できない場合に null になります。ベースのない順序なしピッチクラス集合の場合や、ベースがコード構成音でない場合で、後者では `bassPc` に値が入ります。

`input` は数値の読み方を決めます。`midi` は数値上もっとも低いピッチをベースとして扱い、`pitchClass` は順序なしとして扱います。既定の `auto` は、すべての値が 0..11 にある場合にのみピッチクラスとして解釈します。

## 調の認識

`Key.detectBest` と `Key.detectMatches` は、重み付きのピッチクラス分布から調を順位づけます。

```ts
import { Key } from '@libraz/libcantus';

const histogram = [2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2];

Key.detectMatches(histogram, { modes: true })[0]?.scaleName; // 'dorian'
Key.detectBest(histogram)?.toString(); // 'D melodic minor'
```

その背後にある関数が `detectKey` と `detectKeyBest` で、`Key` ではなくプレーンな key/scale を返します。

```ts
import { detectKey, detectKeyBest } from '@libraz/libcantus';

const histogram = [2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2];

detectKey(histogram, { modes: true })[0]?.scaleName; // 'dorian'
detectKeyBest(histogram)?.mode; // 'minor'
```

`KeyMatch` は、もっとも高く評価されたスケール、それにもっとも近い長調または短調、使っているスケール形（`variant`）、`NAMED_SCALES` 上の正確な名前、そしてスコアを持ちます。`Key.detectMatches` はそのすべてを、調自体は `Key` として返します。検出された `Key` は一致したスケール形をそのまま保つので、上の例は単なる minor ではなく melodic minor と名乗ります。`modes: true` は教会旋法を候補に加えます。指定しない場合の候補は長調と3種類の短調です。

`profile` は、観測された分布を何と相関させるかを選びます。既定は `krumhansl`、コーパスの比率を使う場合は `temperley`、重みなしの比較には `flat` を指定します。`weights` は各ピッチの重みです。`detectKeyFromNotes` は長さ × ベロシティを重みとして渡します。これはコード推定が自身のヒストグラムに使う重み付けと同じで、入力がヒストグラムではなくノートイベントの場合はこちらが適切な入り口になります。曲全体でもっとも長く保たれた調が欲しい場合は `Score.key()` が答えます。

## タイムラインと終止

`Timeline` は、時間上の位置を保った和声です。ルートと発音位置がすでに分かっているコードは `Timeline.fromChords` が並べ、`Score.timeline()` や `Timeline.fromNotes` はノートイベントからコード区間とその時点で効いている調を探します。

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [Chord.parse('C').span(0), Chord.parse('F').span(4), Chord.parse('G7').span(8)],
  12,
  Key.major('C'),
);

timeline.length; // 3
timeline.at(9)?.symbol(); // 'G7'
timeline.roman().map((entry) => entry.roman);
// ['I', 'IV', 'V7']
```

その下で動く関数が `chordTimelineFromChords` で、区間をプレーンなデータとして受け取ります。

```ts
import { chordTimelineFromChords, chordToRoman, majorKey } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
    { rootPc: 7, quality: 'dom7', startBeat: 8 },
  ],
  12,
);

timeline.segments.length; // 3
timeline.segments.map((segment) => chordToRoman(segment.chord, majorKey(0)));
// ['I', 'IV', 'V7']
```

`chordTimelineFromNotes` はタイムライン以外も返します。`keys` は解析が対象とした調区間、`prevailingKey` はもっとも長く保たれた調、`segmentConfidence` は区間順に1つずつの信頼度です。`Timeline` も同じ調区間を `timeline.keys` と `timeline.key` として持ちます。`key` を渡さないことで、転調する曲をその時点で実際に効いている調に対して解析できます。渡した場合は区間が1つになります。呼び出し側がすでに答えを出しているためです。

`timeline.cadences()` は範囲全体の到達点にラベルを付け、それぞれが到達する拍もあわせて返します。

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [Chord.parse('C').span(0), Chord.parse('G').span(4), Chord.parse('C').span(8)],
  12,
  Key.major('C'),
);

const hits = timeline.cadences();

hits.map((hit) => hit.cadence.type); // ['half', 'authentic']
hits[1]?.atBeat; // 8
```

2つのコードにラベルを付けるのが `detectCadence` で、タイムラインが自身の区間に対して走らせているのが `detectCadences` です。

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const key = Key.major('C').scale;
const g = Chord.of('G', 'maj').data;
const c = Chord.of('C', 'maj').data;

detectCadence(g, c, key).type; // 'authentic'
detectCadence(g, c, key).strength; // null
```

ソプラノを特定できるボイシングがない場合、`strength` は null になります。ボイシングを渡すと、正格終止が完全・不完全に分類されます。根音進行のない V の反復は終止として報告されません。時間軸を持たない対応物が `Progression.cadences` で、隣り合う組ごとに1つの終止を読みます。

終止は固定の半音距離ではなく、その調が実際に持つ度数に対して判定されます。旋法は自身の下中音へ偽終止し、属和音が導音を持たない旋法（エオリアンやドリアンの `v`）では、その属和音への到達も半終止になります。長調は導音を持つため、借用した短調の `v` は半終止になりません。

終止四六の和音は主和音の転回ではなく属和音そのものです。バスはすでに属音に到達しており、その上の音は属和音自身の構成音へ下行して解決します。属和音の前の和音を `approach` として渡すと、終止は1つの事象として報告されます。種類と拍は属和音の解決のまま変わらず、`rationale` が「終止は四六から始まった」と述べます。`IV–I64–IV` のようにバスが離れる四六は通常の主和音の転回として読まれます。

## 縮約と形式

`timeline.reduce()` は各コードを `structural`、`passing`、`neighbor` に分類し、理由と、そのコードが鳴る拍の範囲を付けます。装飾の2つの図形は `analyzeVoice` が音符に付けるラベルと同じ綴りなので、1つの凡例で両方の層を扱えます。

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [Chord.parse('Cmaj7').span(0), Chord.parse('C#dim7').span(4), Chord.parse('Dm7').span(8)],
  12,
  Key.major('C'),
);

timeline.reduce().map((entry) => entry.level);
// ['structural', 'passing', 'structural']
```

この読みには調が必要なので、調を持たないタイムライン（第3引数を省いた `Timeline.fromChords`）は推測せずに拒否します。関数版が `reduceProgression` で、調を独立した引数として受け取ります。

```ts
import { chordTimelineFromChords, majorKey, reduceProgression } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj7', startBeat: 0 },
    { rootPc: 1, quality: 'dim7', startBeat: 4 },
    { rootPc: 2, quality: 'min7', startBeat: 8 },
  ],
  12,
);

reduceProgression(timeline, majorKey(0)).map((entry) => entry.level);
// ['structural', 'passing', 'structural']
```

形式に関する問いには、`Score` が自身の持つ音符から答えます。`phrases()` は終止、休符、反復、ハイパーメーター上の位置からフレーズ境界を提案し、各フレーズはどの信号が寄与したかを記録します。`hypermeter()` は小節より上の拍節構造を求め、`sections()` は繰り返される単位を A、B などのラベルとして識別します。A が Verse だという主張はしません。背後にある関数は `phrasesFromTimeline`、`hypermeter`、`sectionsFromNotes` で、音符とコードタイムラインを別々に受け取ります。`structuralCadences` はフレーズ終止を順位づけます。

## 転調

`Score.keys()`、`keyTimelineFromNotes`、`detectModulations` は曲を調区間に分割します。各区間は信頼度を持ち、コードが支持する場合はピボットも持ちます。[調関係と転調](key-relations-and-modulation.md)を参照してください。

## 旋律の解析

繰り返しや変形を伴う旋律素材は `Score.motifs()` と `Score.contour()` が扱い、`Motif` は `relateTo` と `similarityTo` で別のモチーフと自身を比較します。関数としては `melodicContour`、`extractMotifs`、`relateMotifs`、`melodicSimilarity` です。[旋律とモチーフ](melody-and-motifs.md)を参照してください。

## アレンジのレポート

複数のトラックをまとめて読むのが `Arrangement` です。コードタイムライン、調区間、理論ラベル、音符と現在の和声の衝突をまとめ、返せるクラスがある場合はクラスで返します。`timeline()` は `Timeline` を、`track(name)` は `Score` を返します。

```ts
import { Arrangement } from '@libraz/libcantus';

const arrangement = Arrangement.of([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
]);

arrangement.timeline().at(0)?.symbol(); // 'C'
Array.isArray(arrangement.conflicts); // true
```

同じ読みを1回の呼び出しにまとめたものが `analyzeArrangement` です。レポートが持つのは `keys` と `prevailingKey`、`timeline` とその `segmentConfidence`、`cadences`、トラックごとの注釈である `tracks`、そして `conflicts` です。テンションはこれとは別の読みで、`tensionCurve` から得ます。

```ts
import { analyzeArrangement } from '@libraz/libcantus';

const report = analyzeArrangement([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
]);

report.timeline.segments.length >= 1; // true
Array.isArray(report.conflicts); // true
```

アレンジ全体の結果が不要な場合は、`tensionCurve` と `analyzeVoice` がその一部を返します。`toVoiceNotes` は単一トラックを声部レベルの解析向けに整えます。クラス側では `Arrangement.tension` と `Score.voices` が同じ2つの読みにあたります。編集をまたいで解析を保持する `createArrangementSession`（`Arrangement.update` が使っているのもこれです）については[パフォーマンス](performance.md)を参照してください。

`analyzeVoice` が名指す装飾音の図形——経過音・刺繍音・掛留・倚音・先取音・逸音——は、同じ音に対して `classifyMelodyTones` が使う語と同一です。1つの旋律を解析から読んでもハーモナイザから読んでも、返る語彙は1つに揃います。ただし `analyzeVoice` は拍節を受け取らず旋律形だけを見るため、もう一方より図形を名指す箇所が少なくなります。名前が食い違うのではなく、名前が付く範囲が狭いということです。
