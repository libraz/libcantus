import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { filesUnder, PACKAGE_ROOT, SRC } from './support/source-files.js';

/** The function a call sits in, named the way the coverage registry names it. */
function enclosingFunction(node: ts.Node): string {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isPropertyAssignment(current)) &&
      current.name !== undefined &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }
    if (
      (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) &&
      current.parent !== undefined &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
  }
  return 'top level';
}

/**
 * Every place in `src` that validates note events, as `file:function`.
 *
 * The tree is walked rather than listed, and the calling function is read from
 * the syntax tree rather than matched by shape, so a validating helper inside a
 * class or an object literal is found as surely as an exported function. This
 * is what makes the registry below trustworthy: a new consumer is discovered
 * because it exists, not because someone remembered to add a line for it.
 */
function noteEventCallSites(): string[] {
  const found: string[] = [];
  for (const file of filesUnder(SRC, '.ts')) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('assertNoteEvents(')) {
      continue;
    }
    const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'assertNoteEvents'
      ) {
        found.push(
          `${relative(PACKAGE_ROOT, file).split(sep).join('/')}:${enclosingFunction(node)}`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  return [...new Set(found)].sort();
}

/**
 * The public entrances that carry each validating call into the matrix below.
 *
 * This registry is the one place a new consumer touches: the discovery walk
 * fails the suite until the call site it found appears here, and the entrances
 * named here are then exercised with malformed events and with zero-length
 * ones, so a bad imported MIDI event cannot bypass the shared contract
 * unnoticed.
 *
 * A row may name functions other than the one that validates. The public pair
 * delegates to an evidence-carrying implementation — `chordTimelineFromNotes`
 * to `analyzeTimeline` — a private helper is reached through the entrances that
 * call it, and a shared validator names every entrance that reaches it, since
 * each of them is a way in that the contract has to hold at.
 */
const NOTE_EVENT_VALIDATION_COVERAGE: Readonly<Record<string, readonly string[]>> = {
  'src/analyze/arrange/internal.ts:assertTrackNotes': ['analyzeArrangement', 'tensionCurve'],
  'src/analyze/arrange/session.ts:update': ['arrangementSessionUpdate'],
  'src/analyze/arrange/tracks.ts:analyzePolyphony': ['analyzePolyphony'],
  'src/analyze/detect/index.ts:detectKeyFromNotes': ['detectKeyFromNotes'],
  'src/analyze/form/hypermeter.ts:hypermeter': ['hypermeter'],
  'src/analyze/form/phrase.ts:phrasesFromTimeline': ['phrasesFromTimeline'],
  'src/analyze/form/section.ts:sectionsFromNotes': ['sectionsFromNotes'],
  'src/analyze/keys/index.ts:keyTimelineFromNotes': ['keyTimelineFromNotes'],
  'src/analyze/melody/internal.ts:orderedNotes': ['motifFromNotes'],
  'src/analyze/reference/profile.ts:readingsFor': ['analyzeReference'],
  'src/analyze/reference/profile.ts:referenceFromReadings': ['analyzeReference'],
  'src/analyze/rhythm/index.ts:rhythmOver': ['analyzeRhythm'],
  'src/analyze/spelling/index.ts:spellLine': ['spellLine'],
  'src/analyze/timeline/index.ts:analyzeTimeline': ['chordTimelineFromNotes'],
  'src/analyze/voice/index.ts:analyzeVoice': ['analyzeVoice'],
  'src/analyze/voice/index.ts:toVoiceNotes': ['toVoiceNotes'],
  'src/core/event-index/index.ts:createNoteEventIndex': ['createNoteEventIndex'],
  'src/core/instrument/playability.ts:playability': ['playability'],
  'src/generate/countermelody/imitation.ts:imitate': ['imitate'],
  'src/generate/countermelody/index.ts:generateCounterMelody': ['generateCounterMelody'],
  'src/generate/groove/index.ts:applyGrooveTemplate': ['applyGrooveTemplate'],
  'src/generate/groove/index.ts:extractGrooveTemplate': ['extractGrooveTemplate'],
  'src/generate/groove/index.ts:humanize': ['humanize'],
  'src/generate/harmonize/index.ts:harmonizeMelody': ['harmonizeMelody'],
  'src/generate/harmonize/nct.ts:classifyMelodyTones': ['classifyMelodyTones'],
  // One reader for the three entrances that take a motif cell, so all three are
  // measured through it.
  'src/generate/motif/index.ts:assertCellNotes': [
    'developMotif',
    'motifToNoteEvents',
    'transformMotif',
  ],
  'src/generate/ornament/index.ts:ornament': ['ornament'],
  'src/generate/plan/evaluate.ts:evaluateComposition': ['evaluateComposition'],
  // One reader for the three class paths that keep a caller's array as what a
  // class is made of, so all three are measured by the entrances below.
  'src/model/shared.ts:assertNoteEventArray': ['arrangementOf', 'motifOf', 'scoreOf'],
};

describe('public NoteEvent validation entry points', () => {
  it('discovers every assertNoteEvents call site by walking src', () => {
    expect(noteEventCallSites()).toEqual(Object.keys(NOTE_EVENT_VALIDATION_COVERAGE).sort());
  });
});
