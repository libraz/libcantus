# 旋律とモチーフ

モチーフは、変形されながら繰り返される短いパターンです。このライブラリはモチーフの解析と生成を、同じ語彙を2方向から読むものとして扱います。すなわち、2つの提示のあいだの変形を名指すことと、その変形を適用することです。`Motif` はセルを保持するため、`relateTo` と `transform` というメソッドで2方向をそのままつなげられます。同じ操作をプレーンなセルに対して行う関数が `transformMotif` で、`relateMotifs` のほうは `motifFromNotes` が返す読みの2つを取り、その関係を名指します。

モチーフはピッチと同じだけリズムでもあり、このページのオプションはすべて拍と小節で数えられます。その2つは[リズムと拍子の入門](primer/rhythm-and-meter.md)で扱っています。

## 輪郭

`Score` は自身の線を、進行方向とその総和に還元します。

```ts
import { Score } from '@libraz/libcantus';

const arch = Score.of(
  [60, 64, 67, 64, 60].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
);

arch.contour().shape; // 'arch'
arch.contour().directions; // ['up', 'up', 'down', 'down']
arch.contour().peakIndex; // 2
```

`melodicContour` は、素のノートイベント配列に対する同じ読み取りです。

```ts
import { melodicContour } from '@libraz/libcantus';

const arch = [60, 64, 67, 64, 60].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));

melodicContour(arch).shape; // 'arch'
```

形状は `arch`、`ascending`、`descending`、`wave`、`static` です。最初の4つはモチーフ生成器の `contour` オプションと同じ語彙であるため、既存の線から読み取った形状をそのまま生成器に指定できます。`static` は生成側では要求されず、解析では頻繁に現れる形状で、動かない線を指します。いったん下がって戻る線は `wave` として読まれます。共有する語彙に、逆向きのアーチを表す名前がないためです。

波と聞こえるには方向転換が2回以上必要です。そのため生成器との往復は、`arch`・`ascending`・`descending` については長さを問わず一致し、`wave` については3小節以上で一致します。生成器が `wave` に対して書く1〜2小節のセルは方向転換が1回しかなく、`arch` として読み戻されます。

## 旋律の中からモチーフを見つける

```ts
import { Score } from '@libraz/libcantus';

const melody = Score.of([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
  { pitch: 67, startBeat: 4, durationBeat: 1 },
  { pitch: 69, startBeat: 5, durationBeat: 1 },
  { pitch: 71, startBeat: 6, durationBeat: 1 },
]);

const motifs = melody.motifs();

motifs.length >= 1; // true
motifs[0]?.occurrences.length >= 2; // true
```

その下で呼ばれている関数が `extractMotifs` で、ノートイベントを直接受け取ります。

```ts
import { extractMotifs } from '@libraz/libcantus';

const phrase = (from: number, at: number) =>
  [0, 2, 4].map((step, i) => ({ pitch: from + step, startBeat: at + i, durationBeat: 1 }));

extractMotifs([...phrase(60, 0), ...phrase(67, 4)]).length >= 1; // true
```

`MotifData` は音程とリズムのパターン、および各出現とその開始位置を持ちます。上の2つのフレーズは5度離れた同じ形であるため、2つのモチーフではなく、2回出現する1つのモチーフになります。

探索は、連続する `minNotes` 個から `maxNotes` 個までの音の並びをすべて候補として読みます。既定は3個から8個です。そのうえで `minOccurrences` 回以上繰り返されたパターンだけを報告し、この既定値は2です。偶然の反復が多い線から、聴き手がモチーフとして捉える図形だけに絞り込むには `minOccurrences` を上げます。

## 2つの提示の関係を名指す

```ts
import { Motif } from '@libraz/libcantus';

const subject = Motif.fromNotes([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
]);
const answer = Motif.fromNotes([
  { pitch: 67, startBeat: 3, durationBeat: 1 },
  { pitch: 69, startBeat: 4, durationBeat: 1 },
  { pitch: 71, startBeat: 5, durationBeat: 1 },
]);

subject.relateTo(answer)?.kind; // 'transposition'
subject.relateTo(answer, 'C major')?.kind; // 'transposition'
```

`motifFromNotes` は音の並びをプレーンなセルとして読み、`relateMotifs` はそのセル2つを比べます。

```ts
import { majorKey, motifFromNotes, relateMotifs } from '@libraz/libcantus';

const statement = (from: number, at: number) =>
  motifFromNotes(
    [0, 2, 4].map((step, i) => ({ pitch: from + step, startBeat: at + i, durationBeat: 1 })),
  );

const subject = statement(60, 0);
const answer = statement(67, 3);

relateMotifs(subject, answer)?.kind; // 'transposition'
relateMotifs(subject, answer, majorKey(0))?.kind; // 'transposition'
```

種類は `repetition`、`transposition`、`tonalTransposition`、`inversion`、`retrograde`、`retrogradeInversion`、`augmentation`、`diminution` です。調を渡すと、音程を厳密に保つ移高と、音度を保つ `tonalTransposition` を区別できます。

関係には、2つ目の提示が1つ目の終わりから始まるかどうかも記録されます。これが、ゼクエンツと曲中の別の箇所での再提示を分ける情報になります。

`Motif.similarityTo`、関数としては `melodicSimilarity`、その隣に `compareMelodies` があり、名前の付く変形が当てはまらない場合に、2つのフレーズがどれだけ似ているかというより緩い問いに答えます。

## モチーフを生成する

```ts
import { Motif } from '@libraz/libcantus';

const cell = Motif.generate({ key: 'C major', bars: 2, contour: 'arch', ctx: { seed: 1 } });
const score = cell.toScore();

cell.notes.length >= 1; // true
score.notes.every((note) => note.durationBeat > 0); // true
```

モチーフは素材で、スコアは配置です。両者を分けているのは、同じセルを変形し、ゼクエンツにしてから配置できるようにするためで、`toScore` は最初ではなく最後の段階になります。`generateMotif` と `motifToNoteEvents` も、`MotifCell` とノートイベントのあいだに同じ線を引きます。

```ts
import { generateMotif, majorKey, motifToNoteEvents } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', ctx: { seed: 1 } });
const notes = motifToNoteEvents(cell);

notes.length >= 1; // true
notes.every((note) => note.durationBeat > 0); // true
```

`chord` は、小節の頭——小節の第1拍です——に落ちる音を、そのコードのもっとも近い構成音へ引き寄せます。それ以外の音は、輪郭と調が置いた位置のままです。`contour` は形状を選び、`ts` は `bars` を数える拍子を指定します。既定は4/4で、これにより4拍と決め打ちせず他の生成器と小節のグリッドを共有できます。`jitter` は、音が全音階で1度ぶんずらされる確率を [0, 1] で指定します。ずれる向きは上下で等確率です。`ctx: { complexity: { ornament } }` の糖衣構文で、両方を渡した場合はコンテキストが優先されます。既定値は0で、要求した輪郭をそのまま再現します。結果はシードに対して決定的で、シードの既定値は0です。

## 変形と展開

```ts
import { Motif } from '@libraz/libcantus';

const cell = Motif.generate({ key: 'C major', bars: 1, ctx: { seed: 2 } });

cell.transform('invert').notes.length === cell.notes.length; // true
cell.transform('retrograde').notes.length === cell.notes.length; // true
cell.transform('transposeDiatonic', 1, 'C major').notes.length === cell.notes.length; // true
```

`transformMotif` は、セル、変形の種類、その量、そして全音階的な変形を読むための調を受け取ります。

```ts
import { generateMotif, majorKey, transformMotif } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 1, ctx: { seed: 2 } });
const inverted = transformMotif(cell, 'invert');
const retrograde = transformMotif(cell, 'retrograde');

inverted.notes.length; // cell.notes.length
retrograde.notes.length; // cell.notes.length
```

同じ操作でも生成側と解析側で名前が異なるため、対応関係を表として示します。

| `transform` / `transformMotif` | `relateTo` / `relateMotifs` |
| --- | --- |
| `transposeDiatonic` | 調を渡せば `tonalTransposition`、渡さなければ音程の並びだけで決まる名前 |
| `transposeChromatic` | `transposition` |
| `invert` | `inversion` |
| `retrograde` | `retrograde` |
| `augment` | `augmentation` |
| `diminish` | `diminution` |
| `sequence` | 対応なし |

`sequence` だけは対応する関係を持ちません。移高した複製を後ろに連結するため、結果の音数はモデルの2倍になり、音を1つずつ対応させて比べる関係付けは null を返します。代わりに結果の前半と後半を比べてください。調が手元にあれば、両者は `transposition` または `tonalTransposition` として、`sequence` フラグが立った状態で対応します。調なしで読んだ全音階的なゼクエンツには名前が付きません。

逆に、単独の変形が対応しない関係も2つあります。セルをそのまま繰り返す `repetition` と、`retrograde` に続けて `invert` を適用した `retrogradeInversion` です。

調が手元にあるなら渡してください。渡さない場合は調性的な読みが選択肢に入らないため、全音階的な再提示は音程の並びだけから名前が決まります。移動によって全音程がそのまま保たれたときは `transposition` になり、そうでなければ、名前が付かないか、同じ音程の並びを持つ逆行系の関係が返ります。三和音を1度上げると2つの音程の幅が入れ替わりますが、これは逆行反行が同じ三和音に対して行うことでもあり、音価が等しいと前から読んでも後ろから読んでも同じ並びになります。したがって C E G に対する D F A は、調を渡さなければ `retrogradeInversion`、渡せば実際の姿である `tonalTransposition` として返ります。

どの変形も、返すノートを発音位置の昇順で並べます。`retrograde` も同様で、時間の並びは逆向きに読まれますが、配列は前から順に並びます。旋律を受け取る解析はこの順序を前提とします。したがって `invert` の軸は最初に鳴る音であり、`retrograde` のあとに `invert` を適用すると、逆行後にもっとも早い発音位置となった音が軸になります。

鍵盤の外へ音を押し出す移高は、範囲内へ折り返さずに拒否されます。変形後のピッチが 0..127 を出ると `transformMotif` は例外を投げ、`imitate` も同じ条件で例外を投げます。切り詰めた結果のピッチは、呼び出し側が指定していない音程で応答することになるためです。

モチーフはセルを保持しているため、変形を名指してその関係を読み戻すところまでを1つの式で書けます。

```ts
import { Motif } from '@libraz/libcantus';

const model = Motif.fromNotes(
  [60, 64, 62, 67].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
);
const name = (t: 'invert' | 'retrograde' | 'transposeDiatonic') =>
  model.relateTo(model.transform(t, 2, 'C major'), 'C major')?.kind;

name('invert'); // 'inversion'
name('retrograde'); // 'retrograde'
name('transposeDiatonic'); // 'tonalTransposition'
```

同じ往復を関数で書くと、各段階でセルを名指し直すことになります。

```ts
import {
  majorKey,
  motifFromNotes,
  motifToNoteEvents,
  relateMotifs,
  transformMotif,
} from '@libraz/libcantus';

const key = majorKey(0);
const figure = {
  notes: [60, 64, 62, 67].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
};
const model = motifFromNotes(motifToNoteEvents(figure));
const name = (t: 'invert' | 'retrograde' | 'transposeDiatonic') =>
  relateMotifs(model, motifFromNotes(motifToNoteEvents(transformMotif(figure, t, 2, key))), key)
    ?.kind;

name('invert'); // 'inversion'
name('retrograde'); // 'retrograde'
name('transposeDiatonic'); // 'tonalTransposition'
```

展開はコードタイムライン全体に対して変形を適用するため、展開された素材は和声の上で繰り返すのではなく、和声に沿います。

```ts
import { Motif, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
  ],
  8,
  'C major',
);

const developed = Motif.generate({ key: 'C major', bars: 1, ctx: { seed: 3 } }).develop(
  timeline,
  'C major',
  2,
  '4/4',
);

developed.notes.length >= 1; // true
```

セルは要求された長さを埋めるように連続して並べられます。構造的に重い音——各タイルの先頭と小節線——は、その発音位置で鳴っているセグメントのもっとも近いコード構成音へ引き寄せられ、展開された線が背後の和声を綴ります。その間の音は経過音・隣接音として調内に留まります。セル内で異なるピッチは展開後も異なるため、結果はコードそのものではなく、新しい和声の下で鳴るモチーフとして読めます。

その下にある関数が `developMotif` です。他のモチーフ操作と同様に `MotifCell` を返すため、配置が必要な段階で `motifToNoteEvents` を呼びます。

```ts
import { chordTimelineFromChords, developMotif, generateMotif, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
  ],
  8,
);

const developed = developMotif(
  generateMotif({ key, bars: 1, ctx: { seed: 3 } }),
  timeline,
  key,
  2,
  '4/4',
);

developed.notes.length >= 1; // true
```

## 対旋律と模倣

composer は、メロディとその和声に対して自由な第2声部を書きます。

```ts
import { Composer, parseChordSymbol, Score } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', seed: 5 });
const melody = Score.of([
  { pitch: 72, startBeat: 0, durationBeat: 2 },
  { pitch: 71, startBeat: 2, durationBeat: 2 },
]);

const counter = composer.counterMelody(melody, { chordAt: () => parseChordSymbol('C') });

counter.notes.length >= 1; // true
```

`generateCounterMelody` は同じ生成器を、メロディ・調・コンテキストを呼び出しごとに指定して使う形です。

```ts
import {
  chordTimelineFromChords,
  generateCounterMelody,
  majorKey,
  spanFromChord,
  parseChordSymbol,
} from '@libraz/libcantus';

const melody = [
  { pitch: 72, startBeat: 0, durationBeat: 2 },
  { pitch: 71, startBeat: 2, durationBeat: 2 },
];

const harmony = chordTimelineFromChords(
  [spanFromChord(parseChordSymbol('C'), 0), spanFromChord(parseChordSymbol('G7'), 2)],
  4,
);

const counter = generateCounterMelody({
  melody,
  timeline: harmony,
  key: majorKey(0),
  ctx: 5,
});

counter.length >= 1; // true
```

和声は上の例のように `timeline` で渡すか、タイムラインを持たないホストのために `chordAt` コールバックで渡します。推奨は `timeline` です。タイムラインは自身の区間境界を列挙するのでどこで起きたコード変化も見えますが、コールバックは中身が見えず、`chordChangeBeats` で変化点を明示しないかぎり半拍のグリッドで探りを入れることになります。スイングやアンティシペーションで生じるグリッド外のコード変化は、そのままでは跨いで保持される音から見えません。

`register` は対旋律が旋律のどちら側に置かれるかを決め、指定しなければ `'below'` です。既定の音域もこれを基準に決まり、`pitchLow` と `pitchHigh` を渡すとその音域を直接置き換えます。オンセットを決めるのは `rhythm` で、`'complement'` は旋律が音を保つか休んでいる位置で動き、`'follow'` は旋律自身のオンセットをなぞります。`profile` は、何を却下し、残った候補の中で何を好むかを決めます。`'strict'` は反行を求め、既定の `'pop'` は3度や6度の平行が続く形をアレンジャーが書くハモリの線として扱います。どちらのプロファイルでも表せない好みは `weights` で個々の評価重みを上書きします。結果が第2声部として機能しているかは、[対位法と和声課題](counterpoint-and-part-writing.md)の `voiceIndependence` で確認できます。

`imitate` は、指定した音程と遅れで線を再提示します。カノン的な応答にあたります。対応するクラスのメソッドはありません。先行する線だけを受け取って応答を返し、2声をどう並べるかは呼び出し側に委ねるためです。

```ts
import { imitate, majorKey } from '@libraz/libcantus';

const lead = [0, 1, 2].map((beat) => ({ pitch: 60 + beat, startBeat: beat, durationBeat: 1 }));
const answer = imitate(lead, { atBeat: 2, interval: 'P5', key: majorKey(0) });

answer.length; // 3
answer[0]?.startBeat; // 2
```

`answer: 'tonal'` は半音ではなく音階度で数え、`invert` は主題を、最初に鳴る音を軸に反転してから移高します。tonal の応答では、調外の音はその下にある音階音からの距離を保ったまま、他と同じように反転されます。半音階の経過音は経過音のまま応答に現れます。反転先が全音階の半音の内側に当たると音の入る余地がなく、そこの音階音に着地します。全体が半音階で動く主題では応答に同じ音が重なることがあり、そこが real の応答を選ぶ分かれ目です。既定の `'real'` の応答は音程の半音数をすべてのピッチに加えるだけで、音階をいっさい参照しません。主題の音程がそのまま保たれ、調は移高した先に落ちます。

`from` と `to` は複製する先行声部の範囲を区切り、既定では線の先頭から末尾までです。`velocityScale` は複製したベロシティに掛かる係数で、先行する声部の下に置く応答のために使います。鳴らない音は複製しないため、応答に含まれるのは実際に鳴る音だけです。

## 装飾

装飾は既存の素材に対する独立したパスであるため、装飾のオプションを変えても元の線は再生成されません。

```ts
import { ORNAMENT_STYLES, Score } from '@libraz/libcantus';

ORNAMENT_STYLES; // ['ghost', 'flam', 'drag', 'slide', 'accent']

const line = Score.of(
  [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
    pitch,
    startBeat: i * 0.5,
    durationBeat: 0.5,
  })),
);

line.ornament({ style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).notes.length; // 8
```

素の配列に対する同じパスが `ornament` です。

```ts
import { ornament } from '@libraz/libcantus';

const line = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(line, { style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).length; // 8
```

`ghost` は弱い位置の音を弱め、`accent` は強い位置の音を持ち上げます。`flam` は `accent` と同じ強い位置に付き、`drag` は次のオンセットが強い位置に来る弱い位置の音に付き、`slide` は線が動いて到達した音に付きます。順次進行でも跳躍でも付き、まったく動いていない同音反復だけが外れます。`amount` は影響を受ける音の割合を調整します。選択はシードに基づくため、同じオプションからは同じ結果が得られます。鳴らない音は取り除かれるため、結果が入力より短くなることがあります。
