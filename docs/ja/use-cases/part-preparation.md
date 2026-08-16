# ユースケース: 奏者に渡すパートを整える

人が読むパートは、鳴っている音高だけでは満たせない2つの条件を満たす必要があります。その楽器で演奏可能であること、そしてその奏者が読む音高で書かれていることです。

```ts
import { Instrument, Score } from '@libraz/libcantus';

const bass = Instrument.bass4();
const part = Score.of(
  [27, 31, 34, 38, 41, 45].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
  { tempo: 100 },
);

// The score reads itself against the instrument, at its own tempo:
part.playability(bass.data).issues[0]?.type; // 'noteOutOfRange'

const fitted = part.map((note) => ({ ...note, pitch: bass.foldIntoRange(note.pitch) }));

fitted.notes.every((note) => bass.canSound(note.pitch)); // true
fitted.playability(bass.data).issues.length; // 0
bass.range(); // { low: 28, high: 67 }
```

## パートを楽器に合わせる

`playability` は3つの層の障害を報告し、存在に関わるのは第1層だけです。`noteOutOfRange` は、その音が楽器にそもそも存在しないことを意味します。`Instrument.foldIntoRange` はそうした音をオクターブ単位で移動して収めます。最低弦より低く書かれたベースラインに対して、奏者が実際に行う対応と同じです。`Score.map` はパート全体をその折り返しに通し、拍子とテンポはそのまま保ちます。

第2層 — ストレッチ、弦の衝突、手足の衝突、同時発音数 — は折り返しでは解決しません。音どうしの収まり方の問題だからです。第3層の `tooFast` はテンポに依存し、テンポは `Score` がすでに保持しています。楽器そのものが決める範囲だけを見たい場合は、bpm を渡さずに `Instrument.playability(notes)` を呼びます。

`difficulty` は1から5の単一の値で、パートの難易度表示に使えます。`placements` は各音の弦とフレット、あるいは叩く手足を返します。タブ譜やドラム譜の描画に必要な情報です。1音についての同じ問いには `Instrument.fingerings(pitch)` が答えます。運指の候補をユーザーに提示する場面で使うものです。

## 正しい音高で書く

解析も生成も実音で動作します。移調楽器のパートは出力時に変換し、調号もいっしょに移します。

```ts
import { Instrument, Key, Note, Score, spellLine } from '@libraz/libcantus';

const bass = Instrument.bass4();
const key = Key.major('C');
const line = Score.of(
  [27, 31, 34, 38, 41, 45].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
).map((note) => ({ ...note, pitch: bass.foldIntoRange(note.pitch) }));

// Accidentals are chosen for the line as a whole. That is a question about a
// melody, and a melody is the one thing here with no class to hold it:
const spelled = spellLine(line.notes, null, key.scale);
spelled.map((note) => Note.fromData(note).name); // ['Eb2', 'G1', 'Bb1', 'D2', 'F2', 'A2']

Note.parse('C4').forInstrument('clarinetBb').name; // 'D4'
key.forInstrument('clarinetBb').toString(); // 'D major'
```

先頭の Eb2 だけが1オクターブ高いのは、それが折り返された音だからです。

`Note.forInstrument` は奏者が読む音を返します。逆方向は `toSoundingPitch` で、すでに移調されたパートが入力される場合に使います。どちらも綴られた音を扱います。文字を決めるのは音程だからです。B♭管クラリネットでは実音の C は D と記譜されますが、半音数だけではその D を D と綴るべきか C ダブルシャープと綴るべきかを判断できません。`TRANSPOSING_INSTRUMENTS` は主要な楽器を名前で扱い、そこにない楽器は音程文字列で指定できます。

`Key.forInstrument` は調号を同じ音程で移します。移調後のその調に対して線を綴ってください。そうしないと臨時記号が調号と食い違います。

## 線を綴る

`spellLine` は声部全体に対してまとめて臨時記号を選ぶため、上行する半音階はシャープ、下行する半音階はフラットになります。第2引数にコードタイムラインを渡すと、各音を下で鳴っている和声に対して綴ります。渡すべき形は `score.timeline().chordTimeline` です。[音高と記譜](../pitch-and-notation.md)を参照してください。

総譜には、`Duration.ofBeats` が拍長を音価・付点・連符に変換し、`Duration.tieChain` が単一の音価では書けない長さをタイでつないだ音価に分割します。[時間とアレンジ](../time-and-arrangement.md)を参照してください。

## ライブラリが扱わない部分

譜めくり、キュー音符、リハーサルマーク、アーティキュレーションの校訂はライブラリの範囲外です。音を折り返すか楽節を書き直すかの判断も同様です。折り返せばパートは演奏可能になりますが、線の途中でのオクターブ移動は音楽上の選択なので、ホストは黙って適用せず選択肢として提示してください。
