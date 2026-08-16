# 対位法と和声課題

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

### 検査される規則

和音の内部: `voiceCrossing`、`spacing`、`range`。

連続する和音のあいだ: `parallelFifth`、`parallelOctave`、`hiddenPerfect`、`overlap`、`crossRelation`、`augmentedMelodicInterval`、`unresolvedLeadingTone`、`unresolvedSeventh`。

種目対位法ではさらに `wrongRhythmicRatio`、`unpreparedDissonance`、`unresolvedSuspension`、`illegalLeap`、`battuta`、`missingCadence`、`melodicShape` が加わります。

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

`range` の判定は、4声の課題では `SATB_RANGES` に対して行います。それ以外の声部数には前提にできる慣用的な音域がないため、`ranges` を渡さない限りこの規則は適用されません。四声体でない課題では音域を明示的に渡してください。`maxSpacing` は上3声の隣接間で既定12半音、バスとテノールの組は慣例どおり対象外です。

どちらのオプションも、規則を1つも実行しないうちに、ボイシング探索と同じ検証を通ります。有限かつ非負の数でない `maxSpacing`、および空・不正・採点する声部数に足りない `ranges` は、規則を黙って無効化するのではなく `InvalidInputError` を投げます。したがって結果が空であることは、規則が破られていないことだけを意味し、判定できなかったことを意味しません。

## 種目対位法

`checkSpecies` は2声の課題を第1種から第5種まで採点します。

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'G4', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)); // []
```

定旋律は1小節1音です。対位声部は書かれたリズムではなく位置で対応づけます。第1種から第4種は1小節あたりの音数が固定であるため、音数だけで各音の位置が決まります。終止小節が全音符1つで書かれている場合は、慣例として受け入れます。

第5種は音価が混ざるため `opts.durations` が必要です（定旋律の音を単位とします）。`opts.counterpointAbove` は対位声部が上下どちらにあるかを指定するもので、既定では各声部の平均音高から推定します。

種目ごとに許される不協和は異なり、チェッカーはその種目の規則を適用します。第1種は不許可、第2種と第3種は弱拍での経過的不協和、第4種は強拍での準備された繋留、第5種は両方です。

第3種と第5種では、不協和を跳躍で去る2つの定型も書かれます。チェッカーはこれらを本来の位置で受け入れます。1つは**カンビアータ**（協和音、順次下行で到達した不協和、3度下行の跳躍で到達する協和音、順次上行の4音）、もう1つは**二重刺繍**（ある音の片側へ順次進行し、3度の跳躍で反対側へ渡り、順次で戻る形）です。第2種では認めません。2分音符の動きは、この様式が定型を書く場所ではないためです。

### 線の形

音程だけでなく、`checkSpecies` は対位声部を旋律として判定し、`melodicShape` の違反を返します。どの形が破られたかは `rationale` が述べます。

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'C5', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)).map((violation) => violation.kind); // ['melodicShape']
```

上の対位声部は C5 に2度到達しているため、線が目指す頂点がありません。規則は次の5つです。最高音への到達は1度だけ（同音の連続は1度の到達として数え、終止音は対象外）。同方向の跳躍は連続2回まで、かつ合計が1オクターブ以内。6度以上の跳躍は反対方向への順次進行で答える。転回点から転回点までの音の連なりが三全音を描かない。第2種と第3種では同音を反復しない（終止小節は例外で、そこでの反復は終止音を保続しているものと見なします）。

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

## 声部の独立性

`voiceIndependence` は、書かれた2つの線がどれだけ別々の声部として振る舞っているか（1本の線を重ねただけになっていないか）を測ります。

```ts
import { parseNote, voiceIndependence } from '@libraz/libcantus';

const lead = ['C5', 'D5', 'E5'].map((name) => parseNote(name));
const counter = ['E4', 'F4', 'G4'].map((name) => parseNote(name));

voiceIndependence(lead, counter).motion.parallel; // 1
```

`motion` は反行・斜行・並行・平行それぞれの割合で、合計が1になります。上のハモリはリードの6度下を保っているため全体が平行になりますが、これは規則違反ではなく、書かれた内容の記述です。どちらの声部も動かない位置は動きとして数えないため、ほとんど止まっている伴奏でも反行が大半という結果になり得ます。

レポートにはほかに `rhythmicComplementarity`（リードが伸ばしている箇所でカウンターがどれだけ発音するか）、`separation`（平均距離と最接近距離）、`crossings`、`longestPerfectRun` が含まれます。これらを合わせると、第2声部と厚みを増した第1声部の違いが判別できます。生成した対旋律の評価や、学習者に自分の線の実態を示す用途に使えます。

## これらのチェッカーの範囲外

判定するのは慣用的な声部進行の規則であり、音楽の質ではありません。結果が空であることは規則違反がないことを意味し、違反があること自体はその箇所が誤りであることを意味しません。実際のレパートリーはこれらの規則を意図的に、かつ頻繁に破ります。

課題の意図を決めることもしません。曖昧な答案に対して `checkPartWriting` が採点するのは、渡されたコード列に対してです。そのコードを選ぶ行為自体が解析であり、呼び出し側の担当になります。
