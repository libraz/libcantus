# 対位法と和声課題

このページが前提とする音楽用語（声部、進行の方向、不協和、終止形）は[入門の声部のページ](primer/voices.md)で説明しています。

これらのチェッカーは、テクスチャのどこが規則に反しているかを報告します。書き換えは行いません。採点対象は学習者の答案そのものであり、黙って修正すると課題が生み出すはずの情報が失われます。

扱う対象はすべて**オクターブを持つ綴られた音**です。MIDI ピッチでは増4度と減5度を区別できず、対斜は判定できません。数値を入力にすると、綴りに依存する規則が検査されないまま通過します。

## コラールを検査する

コードごとに1つのボイシングを、低い順に、声部ごとの綴られた音で与えます。そのボイシングが実現しているコード列も渡します。

```ts
import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';

const key = majorKey(0);
const chords = [makeChord(0, 'maj'), makeChord(2, 'min')];
const voicings = [
  [48, 55, 64, 72],
  [50, 57, 65, 69],
].map((pitches, index) => spellVoicing(pitches, chords[index] ?? chords[0], key));

const violations = checkPartWriting(voicings, chords, key);

violations[0]?.kind; // 'parallelFifth'
violations[0]?.voices; // [0, 1]
violations[0]?.fromIndex; // 0
violations[0]?.toIndex; // 1
```

各違反は、規則の種類、関係する声部、進行の開始位置と終了位置、そして一文の理由を持ちます。結果は音楽的な順序で返ります。まず和音内部の規則、次にその和音から次の和音への規則という並びです。

声部の番号は下から数え、`voiceChord` や `SATB_RANGES` と一致します。声部の組についての規則は両方を昇順で挙げ、単一の線についての規則は1つだけ挙げます。例外は対斜で、高さに関係なく先行音を持つ声部を先に挙げます。

`Voicing.checkTo` は、あるボイシングから次のボイシングへの進行1つを採点します。両側の綴りは渡された調で内部的に決まり、コードも調も呼び出し側が持っている形のまま渡せるため、コード記号と調名だけで足ります。

```ts
import { Voicing } from '@libraz/libcantus';

const from = Voicing.of([48, 55, 64, 72]);
const to = Voicing.of([50, 57, 65, 69]);

const violations = from.checkTo(to, ['C', 'Dm'], 'C major');

violations[0]?.kind; // 'parallelFifth'
violations[0]?.voices; // [0, 1]
```

こちらは対話的な用途です。声部を動かした直後に、その移動が何を破ったかを尋ねる形になります。課題全体を対象にする場合は `checkPartWriting` で、任意の長さのコラールを1回の呼び出しで採点します。

### 検査される規則

和音の内部: `voiceCrossing`、`spacing`、`range`。

連続する和音のあいだ: `parallelFifth`、`parallelOctave`、`hiddenPerfect`、`overlap`、`crossRelation`、`augmentedMelodicInterval`、`unresolvedLeadingTone`、`unresolvedSeventh`。

種目対位法ではさらに `wrongRhythmicRatio`、`unpreparedDissonance`、`unresolvedSuspension`、`illegalLeap`、`battuta`、`missingCadence`、`melodicShape` が加わります。`wrongRhythmicRatio` は「リズムが定旋律に対して読めない」場合全般を指します。定旋律1音あたりの音数が種目の要求と違う場合に加えて、音価が課題自身のものである第5種では、様式が書かない音価や、渡された対旋律を記述していない `durations` 配列もここに入ります。

`hiddenPerfect`（2声が同方向の進行で完全5度またはオクターブへ到達すること）は、ほかの規則より狭く判定され、しかも2つのチェッカーで判定の仕方が違います。`checkPartWriting` は外声だけで判定します。5度やオクターブがむき出しになるのは外声であり、内声はそれを覆う側だからです。そのため内声どうしの並達5度は報告されません。`checkSpecies` は2声としての厳格さで判定し、順次進行での接近という例外を完全に外します。2つの線のあいだに何も鳴っていない以上、上声がどう到達したかによらず、その到達は禁止されます。

`unresolvedLeadingTone` は導音が主音へ上行することを求めますが、様式自身が認める例外があります。内声の導音は、主和音の第5音へ3度下行してもかまいません。三和音を完全な形に保つために書かれる形（くじけた導音）であり、違反としては報告されません。線が露出する外声では報告されます。

### 対斜

対斜とは、同じ音名文字が異なる変化記号を持って、和音の変わり目に別々の声部へ現れることです。この規則が禁じているのはテクスチャを跨いで露出した半音関係であり、次の3つはその露出を取り去るため、いずれも違反として報告しません。

- 2つの音のどちらかが順次進行で導かれている場合。半音階的な音は、突然置かれるのではなくこうして導入されます。
- 2つの音がどちらも内声にある場合。古典的な規範は、外声間の対斜を内声に含むそれよりはるかに厳しく扱います。
- 離れる側または到達する側の和音が、副次ドミナント、ナポリ、増六和音である場合。これらの和音は、その定義自体に矛盾する音を含んでいます。

副次ドミナントかどうかは解決先から読み取ります。長調の第3度上の同じ長三和音は、`vi` が続けば `V/vi` であり、何も続かなければ半音階的中音和音です。持ち込む音が許されるのは前者だけです。

```ts
import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';

const key = majorKey(0);
const chords = [makeChord(0, 'maj'), makeChord(4, 'dom7'), makeChord(9, 'min')];
const voicings = [
  [48, 52, 60, 67],
  [52, 56, 59, 62],
  [45, 57, 57, 60],
].map((pitches, index) => spellVoicing(pitches, chords[index] ?? chords[0], key));

// I - V7/vi - vi: the soprano's G is contradicted by the tenor's G#, which is
// what tonicizing vi sounds like.
checkPartWriting(voicings, chords, key); // []
```

1つの対斜は、どちらの向きから見つかっても声部の組ごとに1件だけ報告します。増六和音は、その名の由来である音程を書かれた文字から読み取って判定します。同じ音を bVI7 として綴れば増六度は鳴らず、矛盾はそのまま報告されます。

### 音域と間隔

```ts
import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';

const key = majorKey(0);
const chords = [makeChord(0, 'maj')];
const voicings = [spellVoicing([48, 60, 76, 79], chords[0] ?? makeChord(0, 'maj'), key)];

checkPartWriting(voicings, chords, key).map((violation) => violation.kind);
// ['spacing', 'range']
```

`range` の判定は、4声の課題では `SATB_RANGES` に対して行います（`Voicing.satbRanges` はその複製を返す同じ4つの音域です）。それ以外の声部数には前提にできる慣用的な音域がないため、`ranges` を渡さない限りこの規則は適用されません。四声体でない課題では音域を明示的に渡してください。`maxSpacing` は上3声の隣接間で既定12半音、バスとテノールの組は慣例どおり対象外です。

どちらのオプションも、規則を1つも実行しないうちに、ボイシング探索と同じ検証を通ります。有限かつ非負の数でない `maxSpacing`、および空・不正・採点する声部数に足りない `ranges` は、規則を黙って無効化するのではなく `InvalidInputError` を投げます。したがって結果が空であることは、チェッカーが判定した規則が1つも破られていないことを意味します。ここで唯一その保証が及ばないのが、上で述べた省略される `range` 規則です。4声以外の声部数で `ranges` を渡さなかった場合、音域はまったく判定されず、それについては何も報告されません。

## 種目対位法

`checkSpecies` は2声の課題を第1種から第5種まで採点します。2つの声部は、与えられた線である定旋律と、それに対して書かれる対位声部です。種目は定旋律1音に対して対位声部の音が何個置かれるかを決め、それに伴ってそのリズムがどの不協和を許すかも決まります。

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'G4', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)); // []
```

`Voicing.species` はボイシングを書かれた対位声部の線として読み、与えられた定旋律に対して採点します。

```ts
import { Voicing } from '@libraz/libcantus';

const counterpoint = Voicing.of([72, 69, 67, 71, 72]);

counterpoint.species(['C4', 'D4', 'E4', 'D4', 'C4'], 1, 'C major'); // []
```

ここでのピッチは音域上の声部ではなく時間上のスロットです。ボイシングが線として読まれるのは、このメソッドと `Voicing.independence` だけです。判定の前に両方の線が同じ旋法で綴られ、定旋律も例外ではありません。したがって定旋律を MIDI ピッチで渡しても、対位声部と同じ規則で綴られます。これは重要な性質です。文字を読む規則（増2度、減4度）は、異なる規則で綴られた2つの線には適用できず、呼び出し側が手で綴った線は別の規則で綴られている可能性があるからです。

定旋律は1小節1音です。対位声部は書かれたリズムではなく位置で対応づけます。第1種から第4種は1小節あたりの音数が固定であるため、音数だけで各音の位置が決まります。終止小節が全音符1つで書かれている場合は、慣例として受け入れます。

第5種は音価が混ざるため `opts.durations` が必要です（定旋律の音を単位とします）。`opts.counterpointAbove` は対位声部が上下どちらにあるかを指定するもので、既定では各声部の平均音高から推定します。

種目ごとに許される不協和は異なり、チェッカーはその種目の規則を適用します。許可を決めるのは強拍かどうかだけで、小節のどこまで進んだかではありません。第1種はどこでも許しません。第2種と第3種は強拍を外れたところであればどこでも経過的不協和を許し（2つ目の2分音符、あるいは最初以外のどの4分音符でも）、強拍では許しません。第4種は強拍での準備された繋留だけを許し、強拍を外れたところでは許しません。第5種は強拍で繋留を、強拍を外れたところで経過的不協和を許します。

違反は規則の種類ごとにまとめるのではなく、課題の時間順で返ります。最初に報告されるものが最初に聞こえるものなので、譜面の頭から順に学生へ説明できます。

第3種と第5種では、不協和を跳躍で去る2つの定型も書かれます。チェッカーはこれらを本来の位置で受け入れます。1つは**カンビアータ**（協和音、順次下行で到達した不協和、3度下行の跳躍で到達する協和音、順次上行の4音）、もう1つは**二重刺繍**（ある音の片側へ順次進行し、3度の跳躍で反対側へ渡り、順次で戻る形）です。第2種では認めません。2分音符の動きは、この様式が定型を書く場所ではないためです。

### 線の形

音程だけでなく、`checkSpecies` は対位声部を旋律として判定し、`melodicShape` の違反を返します。どの形が破られたかは `rationale` が述べます。

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'C5', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)).map((violation) => violation.kind); // ['melodicShape']
```

上の対位声部は C5 を3回書いていますが、この規則の数え方では2度到達しています。終止音は比較の対象から外れるためです。線がどこで終わるかを決めるのは終止形であって、線自身の形ではありません。外さなければ、終止音へ向かって上りつめた対位声部が、頂点に2度到達したものと見なされてしまいます。到達が2度あると、線が目指す頂点がなくなります。規則は次の5つです。最高音への到達は1度だけ（同音の連続は1度の到達として数え、終止音は対象外）。同方向の跳躍は連続2回まで、かつ合計が1オクターブ以内。6度以上の跳躍は反対方向への順次進行で答える。転回点から転回点までの音の連なりが三全音を描かない。第2種と第3種では同音を反復しない（終止小節は例外で、そこでの反復は終止音を保続しているものと見なします）。

これらは種目対位法の規則です。`checkPartWriting` はコラールを和音ごとに採点し、和声が求めれば声部は跳躍してよいため、これらは適用しません。

違反は定旋律を声部0、対位声部を声部1として示し、位置は対位声部への添字で表します。

## 個々の規則

チェッカーが使う規則は個別にも公開されています。完成した課題を採点するのではなく、音をドラッグしている最中など、1つの進行だけを判定したいホスト向けです。

```ts
import { createsParallelPerfect, createsVoiceCrossing, isForbiddenMelodicLeap, parseNote } from '@libraz/libcantus';

const n = (name: string) => parseNote(name);

createsParallelPerfect(n('C4'), n('D4'), n('G4'), n('A4')); // true
createsVoiceCrossing(n('C4'), n('E4')); // true
isForbiddenMelodicLeap(n('Ab4'), n('B4')); // true
isForbiddenMelodicLeap(68, 71); // false
```

最後の2行は同じ2つのピッチです。綴られた音として見ると増2度で禁止、MIDI 番号として見ると短3度で許容されます。チェッカーが綴り付きの入力を取るのはこのためです。

各述語は綴られた音と MIDI 番号のどちらも受け取り、数値形式では綴りを必要とする規則だけが適用されません。一覧は `createsParallelPerfect`、`createsParallelOctave`、`createsParallelUnison`、`createsHiddenParallelPerfect`、`createsVoiceCrossing`、`createsVoiceOverlap`、`createsVerticalDissonance`、`createsBattuta`、`exceedsSpacing`、`isForbiddenMelodicLeap`、`isAugmentedMelodicInterval`、`isLeadingToneResolution` です。

`createsHiddenParallelPerfect` だけは、ほかの述語に対応するもののない5番目の引数を取ります。2つのテクスチャがこの規則について一致しないためで、`strictness` は `'fourPart'` か `'twoVoice'` のいずれかを取り、既定は `'fourPart'` です。既定はコラールの例外を適用し、上声が順次進行で動く場合の到達を許します。残り2声がそれを覆うからです。`'twoVoice'` は何も除外せず、`checkSpecies` が使うのはこちらの読みです。

```ts
import { createsHiddenParallelPerfect, parseNote } from '@libraz/libcantus';

const n = (name: string) => parseNote(name);

// The bass leaps C4 to F4 under a soprano stepping B4 to C5, arriving at a fifth.
createsHiddenParallelPerfect(n('B4'), n('C5'), n('C4'), n('F4')); // false
createsHiddenParallelPerfect(n('B4'), n('C5'), n('C4'), n('F4'), 'twoVoice'); // true
```

## 声部の独立性

`voiceIndependence` は、書かれた2つの線がどれだけ別々の声部として振る舞っているか（1本の線を重ねただけになっていないか）を測ります。

```ts
import { parseNote, voiceIndependence } from '@libraz/libcantus';

const lead = ['C5', 'D5', 'E5'].map((name) => parseNote(name));
const counter = ['E4', 'F4', 'G4'].map((name) => parseNote(name));

voiceIndependence(lead, counter).motion.parallel; // 1
```

`Voicing.independence` は、保持している2つの線に対する同じ測定です。`key` を渡すと両方の線がその調で綴られます。

```ts
import { Voicing } from '@libraz/libcantus';

const lead = Voicing.of([72, 74, 76]);
const counter = Voicing.of([64, 65, 67]);

lead.independence(counter, { key: 'C major' }).motion.parallel; // 1
```

`motion` は反行・斜行・並行・平行それぞれの割合で、合計が1になります。上のハモリはリードの6度下を保っているため全体が平行になりますが、これは規則違反ではなく、書かれた内容の記述です。どちらの声部も動かない位置は動きとして数えないため、ほとんど止まっている伴奏でも反行が大半という結果になり得ます。

レポートにはほかに `rhythmicComplementarity`（リードが伸ばしている箇所でカウンターがどれだけ発音するか）、`separation`（平均距離と最接近距離）、`crossings`、`longestPerfectRun`、そして `sounding`（両方の線が鳴っている位置の数）が含まれます。`sounding` は `separation` の平均を取る母数であり、まばらな対旋律のほかの数値をこれに照らして読みます。これらを合わせると、第2声部と厚みを増した第1声部の違いが判別できます。生成した対旋律の評価や、学習者に自分の線の実態を示す用途に使えます。

## これらのチェッカーの範囲外

判定するのは慣用的な声部進行の規則であり、音楽の質ではありません。結果が空であることは規則違反がないことを意味し、違反があること自体はその箇所が誤りであることを意味しません。実際のレパートリーはこれらの規則を意図的に、かつ頻繁に破ります。

課題の意図を決めることもしません。曖昧な答案に対して `checkPartWriting` が採点するのは、渡されたコード列に対してです。そのコードを選ぶ行為自体が解析であり、呼び出し側の担当になります。
