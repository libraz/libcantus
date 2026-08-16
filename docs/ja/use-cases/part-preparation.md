# ユースケース: 奏者に渡すパートを整える

人が読むパートは、鳴っている音高だけでは満たせない2つの条件を満たす必要があります。その楽器で演奏可能であること、そしてその奏者が読む音高で書かれていることです。

```ts
import {
  BASS_4_STRING,
  canSound,
  foldIntoRange,
  formatNote,
  majorKey,
  midiToNote,
  playability,
  spellLine,
  toWrittenPitch,
} from '@libraz/libcantus';

const sounding = [27, 31, 34, 38, 41, 45].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
}));

const before = playability(sounding, BASS_4_STRING, 100);
before.issues[0]?.type; // 'noteOutOfRange'

const fitted = sounding.map((note) => ({ ...note, pitch: foldIntoRange(note.pitch, BASS_4_STRING) }));

fitted.every((note) => canSound(BASS_4_STRING, note.pitch)); // true
playability(fitted, BASS_4_STRING, 100).issues.length; // 0

const spelled = spellLine(fitted, null, majorKey(0));
formatNote(spelled[0] ?? midiToNote(0)); // 'Eb2'

formatNote(toWrittenPitch(midiToNote(60), 'clarinetBb')); // 'D4'
```

## パートを楽器に合わせる

`playability` は3つの層の障害を報告し、存在に関わるのは第1層だけです。`noteOutOfRange` は、その音が楽器にそもそも存在しないことを意味します。`foldIntoRange` はそうした音をオクターブ単位で移動して収めます。最低弦より低く書かれたベースラインに対して、奏者が実際に行う対応と同じです。

第2層 — ストレッチ、弦の衝突、手足の衝突、同時発音数 — は折り返しでは解決しません。音どうしの収まり方の問題だからです。第3層の `tooFast` は第3引数のテンポに依存します。テンポを渡さなければ、楽器そのものが決める範囲だけが見えます。

`difficulty` は1から5の単一の値で、パートの難易度表示に使えます。`placements` は各音の弦とフレット、あるいは叩く手足を返します。タブ譜やドラム譜の描画に必要な情報です。

## 正しい音高で書く

解析も生成も実音で動作します。移調楽器のパートは、出力時に変換します。

- `toWrittenPitch(note, instrument)` は奏者が読む音を返します。
- `toSoundingPitch(note, instrument)` は逆方向で、すでに移調されたパートが入力される場合に使います。

どちらも綴られた音を受け取ります。文字を決めるのは音程だからです。B♭管クラリネットでは実音の C は D と記譜されますが、半音数だけではその D を D と綴るべきか C ダブルシャープと綴るべきかを判断できません。`TRANSPOSING_INSTRUMENTS` は主要な楽器を名前で扱い、そこにない楽器は音程文字列で指定できます。

調号もパートとともに移動します。同じ音程で調を移調し、移調後の調に対して線を綴ってください。そうしないと臨時記号が調号と食い違います。

## 線を綴る

`spellLine` は声部全体に対してまとめて臨時記号を選ぶため、上行する半音階はシャープ、下行する半音階はフラットになります。第2引数にコードタイムラインを渡すと、各音を下で鳴っている和声に対して綴ります。[音高と記譜](../pitch-and-notation.md)を参照してください。

総譜には、`beatsToDuration` と `beatsToTiedDurations` が拍長を音価・付点・連符に変換します。[時間とアレンジ](../time-and-arrangement.md)を参照してください。

## ライブラリが扱わない部分

譜めくり、キュー音符、リハーサルマーク、アーティキュレーションの校訂はライブラリの範囲外です。音を折り返すか楽節を書き直すかの判断も同様です。折り返せばパートは演奏可能になりますが、線の途中でのオクターブ移動は音楽上の選択なので、ホストは黙って適用せず選択肢として提示してください。
