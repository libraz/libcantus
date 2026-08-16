# 調関係と転調

調はルートのピッチクラスとモードマスクの組であり、それがどう書かれるかは含みません。関係を扱う関数群がその部分を補います。これらは5度圏の上を移動し、主音をそこから読み戻すため、綴りが正しく保たれます。

## 調を綴る

`SpelledKey` は、音名の基準となる綴られた主音と調を組にしたものです。主音はオクターブを持ちません。調はピッチクラスの上に立つためです。

```ts
import { formatNote, majorKey, scaleByName, spelledKeyOf } from '@libraz/libcantus';

formatNote(spelledKeyOf(majorKey(1)).tonic); // 'Db'
formatNote(spelledKeyOf(scaleByName('harmonicMinor', 8)).tonic); // 'G#'
```

[-7, 7] の調号のうち、指定したルートを持つ調で臨時記号がもっとも少ないものが主音を決めます。長調のピッチクラス1が、嬰7つの C# ではなく変5つの Db になるのはこのためです。全音階旋法でないスケールは自身のマスクを保ち、同主長調・短調の主音の綴りだけを借ります。嬰ト短調（和声的短音階）は G# と綴られ、和声的短音階のまま保たれます。

## 調号

```ts
import { formatNote, keyFromFifths, keySignatureFifths, majorKey, parseNote } from '@libraz/libcantus';

keySignatureFifths(parseNote('D'), majorKey(2)); // 2
keySignatureFifths(parseNote('Eb'), majorKey(3)); // -3

const twoSharps = keyFromFifths(2, 'major');
formatNote(twoSharps.tonic); // 'D'
```

値は符号付きで、正がシャープ、負がフラットの数です。`keyFromFifths` は逆変換で、1つの調号が2つの調を指すためモードを受け取ります。`Key` は同じ対応をゲッターとファクトリとして備えます。

```ts
import { Key } from '@libraz/libcantus';

Key.major('D').fifths; // 2
Key.major('Eb').fifths; // -3
Key.fromFifths(2).toString(); // 'D major'
Key.fromFifths(2, 'minor').toString(); // 'B minor'
```

## 近親調

```ts
import { formatNote, majorKey, parseNote, relatedKeysOf } from '@libraz/libcantus';

const related = relatedKeysOf(parseNote('C'), majorKey(0));

related.map((entry) => entry.relation);
// ['relative', 'parallel', 'dominant', 'subdominant', 'relativeOfDominant', 'relativeOfSubdominant']
related.map((entry) => formatNote(entry.tonic));
// ['A', 'C', 'G', 'F', 'E', 'D']
```

`Key.relatedKeys` は同じ内容を、綴られた主音ではなく調そのもので返します。

```ts
import { Key } from '@libraz/libcantus';

const related = Key.major('C').relatedKeys();

related.map((entry) => entry.relation);
// ['relative', 'parallel', 'dominant', 'subdominant', 'relativeOfDominant', 'relativeOfSubdominant']
related.map((entry) => entry.key.toString());
// ['A minor', 'C minor', 'G major', 'F major', 'E minor', 'D minor']
```

各関係は単体でも取得できます。関数では `relativeKeyOf`、`parallelKeyOf`、`dominantKeyOf`、`subdominantKeyOf`、クラスでは `relative`、`parallel`、`dominantKey`、`subdominantKey` です。`enharmonicKeyOf` と `Key.enharmonic` は同じ響きの調のもう一方の綴りを返し、慣用的な綴りがない場合は `null` を返します。

```ts
import { formatNote, Key, majorKey, parseNote, relativeKeyOf } from '@libraz/libcantus';

formatNote(relativeKeyOf(parseNote('Db'), majorKey(1)).tonic); // 'Bb'

Key.major('Db').relative().toString(); // 'Bb minor'
Key.major('C').parallel().toString(); // 'C minor'
Key.major('C').dominantKey().toString(); // 'G major'
Key.major('C').subdominantKey().toString(); // 'F major'
Key.major('Db').enharmonic()?.toString(); // 'C# major'
Key.major('C').enharmonic(); // null
```

変ニ長調の平行調は変ロ短調であり、嬰イ短調ではありません。同主調以外のすべての関係を5度空間で計算しているのはこのためです。同主調は5度を移動しないため、渡された主音の綴りをそのまま保ちます。

逆方向の問いには `keyRelationBetween`、あるいは `Key.relationTo` が答えます。

```ts
import { Key, keyRelationBetween, majorKey, minorKey, parseNote } from '@libraz/libcantus';

const cMajor = { tonic: parseNote('C'), key: majorKey(0) };

keyRelationBetween(cMajor, { tonic: parseNote('A'), key: minorKey(9) }); // 'relative'
keyRelationBetween(cMajor, { tonic: parseNote('Eb'), key: minorKey(3) }); // null

Key.major('C').relationTo(Key.minor('A')); // 'relative'
Key.major('C').relationTo(Key.minor('Eb')); // null
```

関係は決まった順に判定され、最初に一致したものを返します。主音の綴りを見るのは同一性の判定だけであるため、嬰ハ短調も変ニ短調もどちらもホ長調の平行調として読まれます。

## 度数の上に立つ調

調の関係は近親調の6つだけではありません。`Key.keyOnDegree` はスケール上のある度数を主音とする調を返し、`Key.keyHavingTonicAsDegree` はその逆を返します。この2つに対応する関数はありません。

```ts
import { Key } from '@libraz/libcantus';

Key.minor('A').keyOnDegree(4).toString(); // 'D minor'
Key.minor('A').keyOnDegree(4, 'major').toString(); // 'D major'
Key.minor('D').keyHavingTonicAsDegree(4).toString(); // 'A minor'
```

モードを省くとその度数上の全音階三和音が決めるため、イ短調の第4度はニ短調に、ハ長調の第4度はヘ長調になります。モードを明示するとその読みを上書きでき、短調の度数の上に長調を置く移行はこの形で書きます。

## 曲の中の転調を検出する

調の区間は宣言されるものではなく推定されるものです。`keyTimelineFromNotes` はノートイベントを直接探索し、`detectModulations` は推定済みのコードタイムラインから動作します。1拍あたりの手がかりは生のピッチよりコードのほうが多いため、実用上は後者のほうが良い入力になります。

```ts
import { chordTimelineFromChords, detectModulations } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 7, quality: 'dom7', startBeat: 4 },
    { rootPc: 0, quality: 'maj', startBeat: 8 },
    { rootPc: 2, quality: 'dom7', startBeat: 12 },
    { rootPc: 7, quality: 'maj', startBeat: 16 },
    { rootPc: 4, quality: 'min', startBeat: 20 },
    { rootPc: 9, quality: 'min7', startBeat: 24 },
    { rootPc: 2, quality: 'dom7', startBeat: 28 },
    { rootPc: 7, quality: 'maj', startBeat: 32 },
  ],
  36,
);

const regions = detectModulations(timeline.segments);
regions.length >= 1; // true
regions[0]?.startBeat; // 0
```

`KeyRegion` は区間、そこで効いている調、そして [0, 1] の `confidence` を持ちます。信頼度は、その区間のピッチクラス分布と調プロファイルの相関です。転調は根拠に基づく提案であって事実ではないため、信頼度を提示し、ユーザーが読みを上書きできるようにします。

どちらの関数も同じオプションを取ります。実務で影響が大きいのは次の3つです。

- `ts` / `meters`: 拍子。小節線と拍節アクセントを正しく読むために使います。4/4 以外では指定します。
- `expectedKeyBeats`: 1つの調が続くと想定する長さ。新しい区間をどれだけ積極的に提案するかが決まります。既定は4小節です。
- `minKeyBeats`: 出力する最短の区間。既定は1小節です。短い一時的転調が転調として報告されすぎる場合に上げます。`keyTimelineFromNotes` はこの長さでスロットを切ります。`detectModulations` はコード自体がスロットになるため、これより短い区間を、そのコードを最もよく説明する隣の調へ畳み込みます。どちらの場合も、これより短い区間が残るのは解析範囲の終端だけです。

2つの経路で扱いが異なるオプションが1つあります。`profile` はピッチクラスプロファイルを指定するもので、ノート経路では各スロットの採点そのものに使われます。`detectModulations` は各コードが調の中で担う役割で採点するため、どの調を報告するかにプロファイルは関与しません。それを決めるのはコードです。ただし各区間の `confidence`（前述の相関）の算出には、ノート経路とまったく同じように使われます。

`prevailingKeyOf` は区間の集合を、その範囲の大半を占める1つの調にまとめます。UI に全体のラベルを表示する場合はこれを使います。

## ピボットコード

ピボットコードは新旧どちらの調でも全音階に属するコードで、読み手に転調を説明する際にもっとも自然な手がかりになります。

```ts
import { majorKey, pivotChords } from '@libraz/libcantus';

pivotChords(majorKey(0), majorKey(7)).map((pivot) => `${pivot.romanFrom}=${pivot.romanTo}`);
// ['I=IV', 'iii=vi', 'V=I', 'vi=ii']
```

各項目はコードと、両方の調でのローマ数字を持ちます。`detectModulations` から得た調区間には境界をまたぐコードが紐づくため、レポートは調が変わった拍だけでなくピボット自体を示せます。

## 転調ではない一時的転調

半音階的なコードがすべて調の変化を意味するわけではありません。副属和音はある度数を一時的に主音として扱うだけで、調は変わりません。

```ts
import { Chord, chordToRoman, majorKey, secondaryDominant, secondaryDominantOf } from '@libraz/libcantus';

const key = majorKey(0);

chordToRoman(secondaryDominant(5, key), key); // 'II7'
chordToRoman(secondaryDominant(5, key), key, { applied: true }); // 'V7/V'
chordToRoman(secondaryDominantOf(Chord.of('A', 'min')), key, { applied: true }); // 'V7/vi'

Chord.of('A', 'min').secondaryDominant().symbol(); // 'E7'
```

`secondaryDominantOf` はコードを表す値であれば何でも受け取るため、`Chord` はそのまま渡せます。`Chord.secondaryDominant` は同じ処理をコード自身から行います。`applied` は既定でオフです。主調に対してルートを名指しする綴りは常に正しく、その半音階的な属和音が実際に適用されたものかどうかは呼び出し側にしか判断できないためです。オンにすると、`secondaryDominant` が作るコードについて `chordToRoman` が `romanToChord` の逆写像になります。

もう1つの一般的な例が借用和音で、同主調から借りるだけで主音は移動しません。

```ts
import { borrowedSource, Chord, isBorrowedChord, Key, majorKey, parallelKey } from '@libraz/libcantus';

const key = majorKey(0);

isBorrowedChord(Chord.of('F', 'min'), key); // true
borrowedSource(Chord.of('F', 'min'), key); // 'parallelMinor'
parallelKey(key).rootPc; // 0

Chord.of('F', 'min').isBorrowed(Key.major('C')); // true
Chord.of('F', 'min').borrowedSource(Key.major('C')); // 'parallelMinor'
Key.major('C').parallel().toString(); // 'C minor'
```

この区別は UI で意味を持ちます。一時的転調や借用和音は現在の調の内側でラベル付けし、新しい調区間を割り当てるのは調性の中心が持続的に移った場合だけにします。これらのコードの解析は[和声](harmony.md)を、意図的に使う側は[リハーモナイズ](reharmonization.md)を参照してください。
