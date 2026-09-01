/**
 * Which module owns which musical concept.
 *
 * The audits keep finding the same shape of defect: a concept is derived in one
 * module correctly and in a sibling module differently, and the two disagree
 * about a note. The disagreement is never reported, because nothing says which
 * of the two is the definition. Successive audits recorded the pairs in prose,
 * and successive remediations closed the pair that was named while the next
 * sibling grew a third copy.
 *
 * This table is that prose moved into code. An entry names the module allowed
 * to derive a concept and the names reserved to it; the check built on it walks
 * the tree, so a copy written tomorrow fails the run without anybody adding it
 * here. Closing a concept means emptying its `allowed` list — not editing the
 * table's prose.
 */
export type ConceptOwner = {
  /** What the concept is, in the terms the theory uses. */
  concept: string;
  /**
   * The single module allowed to declare the reserved names.
   *
   * Where a concept's home is expected to move, this records where it lives
   * now: the check measures duplication, and moving a file is a separate
   * change from removing a copy.
   */
  owner: string;
  /** Names no other module may declare. */
  reserved: readonly string[];
  /**
   * Raw tables the owner keeps to itself.
   *
   * A concept is not owned while a sibling can read the table the derivation
   * is built on: reading it *is* deriving the concept, under another name.
   */
  private?: readonly string[];
  /**
   * Declarations outside the owner that still exist, as `file:name`.
   *
   * This is the concept's remaining debt. A concept is closed when the list is
   * empty, which is a condition a test reports rather than a reader judges.
   */
  allowed?: readonly string[];
};

export const CONCEPT_OWNERS: readonly ConceptOwner[] = [
  {
    // The seam the last four audits all reported: the voicer decides a tendency
    // by pitch class while the checker decides it by function and voice
    // position, so the voicer writes what the checker then rejects.
    concept: 'the leading tone and its obligation',
    owner: 'src/theory/tendency/index.ts',
    reserved: [
      'leadingTonePc',
      'leadingTonePcOf',
      'isLeadingToneOf',
      'isLeadingToneResolution',
      'isLeadingToneDiminished',
      'isFrustratedLeadingTone',
      'isFunctioningLeadingTone',
      'LEADING_TONE_QUALITIES',
    ],
    allowed: [
      // A different concept wearing a matching name: this asks how a line
      // moves, not what the leading tone is. It reads the shared pitch class
      // rather than restating it, and lives with the counterpoint rules that
      // are its subject.
      'src/theory/counterpoint/index.ts:isLeadingToneResolution',
    ],
  },
  {
    // One module asks whether a chord tonicizes a degree that can hold a
    // fifth; another asks only whether the root is in the scale. A Picardy
    // tonic reads as a dominant under the second and not under the first.
    concept: 'what an applied dominant may target',
    owner: 'src/analyze/functional/tonicization.ts',
    // `isAppliedDominantSonority` is deliberately outside this: it asks what a
    // chord sounds like, not what it is doing, and the two are separable — a
    // dominant sonority on a degree nothing follows is not an applied dominant.
    reserved: ['appliedTarget', 'isAppliedDominant', 'tonicizableDegrees'],
  },
  {
    // A chord's sixth is five letters above its root; a table of semitone
    // distances calls the same interval a seventh. A correctly written German
    // sixth is then marked as an unresolved seventh.
    concept: 'the letter a chord tone is spelled on',
    owner: 'src/theory/chord/index.ts',
    // The degree table in the spelling module is the fallback for a chord that
    // names no spelling of its own, and is reached only after this owner has
    // been asked; it is not a second answer to the same question.
    reserved: ['chordToneSpellings'],
  },
  {
    // Two readings of this is how neighbouring generators came to disagree
    // about which beat is strong. The vocabulary's grid weight is a rank
    // derived from this one rather than a second answer, so it is not listed:
    // it asks the owner and then shifts the scale it reports on.
    concept: 'which beat of the bar is strong',
    owner: 'src/core/meter/index.ts',
    reserved: ['metricWeight', 'isStrongBeat'],
  },
  {
    // A compound signature is felt in dotted pulses. A reader that divides by
    // the quarter note instead finds no boundary inside the bar at all.
    concept: 'the pulse a signature is felt in',
    owner: 'src/core/meter/index.ts',
    reserved: ['pulseBeats', 'pulsesPerBar', 'metricGridUnit', 'isCompound'],
  },
  {
    // Bar numbering has one base and a pickup has one treatment; a second
    // reading of either puts the first bar at 0 in one report and 1 in another.
    concept: 'where a bar begins and how a pickup is counted',
    owner: 'src/core/meter/index.ts',
    reserved: [
      'barIndexAt',
      'barStartBeat',
      'beatToBarPosition',
      'barPositionToBeat',
      'barPositionToPulse',
      'formatBarPosition',
    ],
  },
  {
    // Related keys are the traditional six, reached by fifths from the tonic.
    // A second derivation gives a modal key duplicates and a relation that
    // does not hold in both directions.
    concept: 'which keys are closely related',
    owner: 'src/theory/scale/relations.ts',
    reserved: [
      'tonicFifths',
      'relativeKeyOf',
      'parallelKeyOf',
      'relatedKeysOf',
      'keyRelationBetween',
    ],
  },
  {
    // Chord-scale theory applies to the named scales it was built for. Asking
    // for the avoid notes of a raga is a category error the module itself
    // names, and two of its three siblings commit it.
    concept: 'the scales chord-scale theory applies to',
    owner: 'src/theory/chordscale/index.ts',
    reserved: ['chordScales', 'avoidNotes', 'availableTensions'],
  },
  {
    // Three facts make a key, and every extra shape that carries them is a
    // place one of them is dropped. The largest group the audits found was this
    // one: a spelled tonic and a scale form falling off at each boundary they
    // crossed, because only the topmost layer had a shape that held all three.
    concept: 'the whole identity of a key',
    owner: 'src/theory/scale/kinds.ts',
    reserved: ['ResolvedKey', 'SpelledKey', 'KeyIdentity', 'SpelledKeyScale'],
  },
  {
    // A key name carries a spelled tonic and a scale form. A second reader that
    // keeps neither turns `'Ab minor'` into the G# minor the pitch classes read
    // best as, and no caller can see where the flat went.
    concept: 'the key a name denotes',
    owner: 'src/theory/scale/name.ts',
    reserved: ['tryResolveKeyName', 'resolveKeyName', 'tryNamedScaleKey', 'tryParseScaleKey'],
    // The word-to-scale table is the reading, under another name: a sibling
    // that reads it has written a second parser without declaring one.
    private: ['SCALE_BY_WORD', 'scaleWordKey'],
  },
  {
    // An interval's direction is one fact. Read from the sign of its span in
    // one place and from a flag in another, the two disagree on the intervals
    // whose letters and pitches move opposite ways.
    concept: "an interval's direction",
    owner: 'src/core/pitch/index.ts',
    reserved: ['intervalDescends', 'intervalSemitones', 'spelledInterval'],
  },
];
