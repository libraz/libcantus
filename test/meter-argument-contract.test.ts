import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  beatsPerBar,
  Composer,
  formatTimeSignature,
  generateMotif,
  generateRhythm,
  humanize,
  InvalidInputError,
  isCompound,
  type MeterMap,
  majorKey,
  metricWeight,
  parseTimeSignature,
  pulseBeats,
  pulsesPerBar,
  Rhythm,
  resolveMeters,
  rhythmDensity,
  tryParseTimeSignature,
} from '../src/index.js';
import { filesUnder, SRC } from './support/source-files.js';

/** The parameter and option-field names by which the library names a meter. */
const METER_NAMES = new Set(['ts', 'meter', 'meters']);

/**
 * Type names by which the library names a record of caller input.
 *
 * A meter field on one of these is an entry point's argument and so takes every
 * form a meter is written in; a meter field anywhere else — a meter map entry, a
 * groove template, a vocabulary entry — is data the library hands out or reads
 * back, and stays the plain shape it is documented as.
 */
const INPUT_RECORD = /(?:Options|Query|Settings|Input)$/;

/** Whether a declaration carries the `export` modifier. */
function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

/** Whether a class member is part of the class's public surface. */
function isPublicMember(node: ts.ClassElement): boolean {
  const flags = ts.getCombinedModifierFlags(node);
  const hidden = ts.ModifierFlags.Private | ts.ModifierFlags.Protected;
  return (
    (flags & hidden) === 0 && !ts.isPrivateIdentifier(node.name ?? ts.factory.createIdentifier(''))
  );
}

/**
 * Whether a function is one of the guards or copiers that work in the resolved
 * plain shape by definition — a validator of a time signature cannot take the
 * text form it exists to reject.
 */
function definesPlainShape(name: string | undefined): boolean {
  return name !== undefined && (name.startsWith('assert') || name.startsWith('copy'));
}

/** A source location a failure message can be read as a file to open. */
function where(node: ts.Node, file: ts.SourceFile, detail: string): string {
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${path.relative(SRC, file.fileName)}:${line + 1} ${detail}`;
}

/** Every meter-shaped declaration the public surface asks a caller to fill. */
function meterDeclarations(): { site: string; declared: string }[] {
  const found: { site: string; declared: string }[] = [];
  // Internal modules are excluded by path rather than by name: they are the
  // library's own reads, taken after the boundary has already resolved the
  // caller's value, and are not a surface anyone passes a signature name to.
  const files = filesUnder(SRC, '.ts').filter((file) => !file.endsWith('internal.ts'));

  const collectParameters = (
    parameters: readonly ts.ParameterDeclaration[],
    name: string | undefined,
    file: ts.SourceFile,
  ): void => {
    if (definesPlainShape(name)) {
      return;
    }
    for (const parameter of parameters) {
      const parameterName = parameter.name.getText(file);
      if (!METER_NAMES.has(parameterName) || parameter.type === undefined) {
        continue;
      }
      found.push({
        site: where(parameter, file, `${name ?? '(anonymous)'}(${parameterName})`),
        declared: parameter.type.getText(file),
      });
    }
  };

  for (const fileName of files) {
    const file = ts.createSourceFile(
      fileName,
      // biome-ignore lint/style/noNonNullAssertion: the file list comes from the tree walk
      ts.sys.readFile(fileName)!,
      ts.ScriptTarget.ESNext,
      true,
    );
    for (const statement of file.statements) {
      if (!isExported(statement)) {
        continue;
      }
      if (ts.isFunctionDeclaration(statement)) {
        collectParameters(statement.parameters, statement.name?.getText(file), file);
        continue;
      }
      if (ts.isClassDeclaration(statement)) {
        const className = statement.name?.getText(file) ?? '(anonymous class)';
        for (const member of statement.members) {
          if (
            (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) ||
            !isPublicMember(member)
          ) {
            continue;
          }
          const memberName = ts.isConstructorDeclaration(member)
            ? 'constructor'
            : member.name.getText(file);
          collectParameters(member.parameters, `${className}.${memberName}`, file);
        }
        continue;
      }
      const members = ts.isInterfaceDeclaration(statement)
        ? { name: statement.name.getText(file), list: statement.members }
        : ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)
          ? { name: statement.name.getText(file), list: statement.type.members }
          : undefined;
      if (members === undefined || !INPUT_RECORD.test(members.name)) {
        continue;
      }
      for (const member of members.list) {
        if (!ts.isPropertySignature(member) || member.type === undefined) {
          continue;
        }
        const memberName = member.name.getText(file);
        if (!METER_NAMES.has(memberName)) {
          continue;
        }
        found.push({
          site: where(member, file, `${members.name}.${memberName}`),
          declared: member.type.getText(file),
        });
      }
    }
  }
  return found;
}

describe('meter argument contract', () => {
  it('declares every meter a caller names as MeterLike', () => {
    // Derived from the sources rather than listed: an entry point added with a
    // narrower meter parameter is exactly the split acceptance domain this
    // guards against, and a list would only ever describe the entry points
    // somebody remembered.
    const declarations = meterDeclarations();
    expect(declarations.length).toBeGreaterThan(10);
    const narrower = declarations
      .filter((declaration) => !/\bMeterLike\b/.test(declaration.declared))
      .map((declaration) => `${declaration.site}: ${declaration.declared}`)
      .sort();
    expect(narrower).toEqual([]);
  });
});

/** The same 6/8 bar, written every way the library accepts it. */
const SIX_EIGHT = {
  name: '6/8',
  plain: { numerator: 6, denominator: 8 },
  boxed: { toJSON: () => ({ numerator: 6, denominator: 8 }) },
};

describe('meters named as text', () => {
  it('answers a signature name as the plain signature does', () => {
    expect(beatsPerBar(SIX_EIGHT.name)).toBe(beatsPerBar(SIX_EIGHT.plain));
    expect(beatsPerBar(SIX_EIGHT.name)).toBe(3);
    expect(pulsesPerBar(SIX_EIGHT.name)).toBe(pulsesPerBar(SIX_EIGHT.plain));
    expect(pulseBeats(SIX_EIGHT.name)).toBe(pulseBeats(SIX_EIGHT.plain));
    expect(isCompound(SIX_EIGHT.name)).toBe(isCompound(SIX_EIGHT.plain));
    expect(formatTimeSignature(SIX_EIGHT.name)).toBe(formatTimeSignature(SIX_EIGHT.plain));
  });

  it('answers a boxed signature as the plain signature does', () => {
    expect(beatsPerBar(SIX_EIGHT.boxed)).toBe(beatsPerBar(SIX_EIGHT.plain));
    expect(pulsesPerBar(SIX_EIGHT.boxed)).toBe(pulsesPerBar(SIX_EIGHT.plain));
    expect(pulseBeats(SIX_EIGHT.boxed)).toBe(pulseBeats(SIX_EIGHT.plain));
    expect(isCompound(SIX_EIGHT.boxed)).toBe(isCompound(SIX_EIGHT.plain));
  });

  it('keeps the additive reading a signature name carries', () => {
    expect(pulsesPerBar('2+2+3/8')).toBe(7);
    expect(metricWeight(2, '2+2+3/8')).toBe(2);
  });

  it('generates over a named meter', () => {
    expect(generateRhythm('4/4', { bars: 2 })).toEqual(
      generateRhythm(parseTimeSignature('4/4'), { bars: 2 }),
    );
    expect(generateRhythm('6/8', { bars: 2 }).at(-1)?.position).toBeLessThan(6);
    expect(rhythmDensity(generateRhythm('4/4', { bars: 2 }), '4/4')).toBeGreaterThan(0);
  });

  it('generates a motif over a named meter', () => {
    const key = majorKey(0);
    expect(generateMotif({ key, bars: 1, ts: '6/8' })).toEqual(
      generateMotif({ key, bars: 1, ts: parseTimeSignature('6/8') }),
    );
  });

  it('humanizes against a named meter', () => {
    const events = [{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 80 }];
    expect(humanize(events, { ctx: 1, ts: '6/8' })).toEqual(
      humanize(events, { ctx: 1, ts: parseTimeSignature('6/8') }),
    );
  });

  it('resolves either option field from any meter form', () => {
    const expected: MeterMap = [{ startBeat: 0, ts: { numerator: 3, denominator: 4 } }];
    expect(resolveMeters({ ts: '3/4' })).toEqual(expected);
    expect(resolveMeters({ meters: '3/4' })).toEqual(expected);
    expect(resolveMeters({ meters: expected })).toEqual(expected);
  });
});

describe('meters named as a map', () => {
  const changes: MeterMap = [
    { startBeat: 0, ts: { numerator: 3, denominator: 4 } },
    { startBeat: 6, ts: { numerator: 4, denominator: 4 } },
  ];

  it('reads the signature the map opens in where a bar is asked for without a beat', () => {
    expect(beatsPerBar(changes)).toBe(3);
    expect(pulsesPerBar(changes)).toBe(3);
    expect(pulseBeats(changes)).toBe(1);
    expect(isCompound(changes)).toBe(false);
    expect(formatTimeSignature(changes)).toBe('3/4');
  });
});

describe('values that name no meter', () => {
  it.each([
    ['a number', 4],
    ['null', null],
    ['a plain object', { bars: 2 }],
  ])('rejects %s under the parameter name it was given', (_label, value) => {
    // biome-ignore lint/suspicious/noExplicitAny: the point is what an untyped host passes
    const rejected = () => beatsPerBar(value as any);
    expect(rejected).toThrow(InvalidInputError);
    try {
      rejected();
    } catch (error) {
      expect((error as Error).message).toMatch(/^ts /);
      expect((error as Error).message).not.toContain('numerator must be');
    }
  });

  it('names the option field a generator read the meter from', () => {
    // biome-ignore lint/suspicious/noExplicitAny: the point is what an untyped host passes
    expect(() => generateRhythm(7 as any)).toThrow(/^ts must be a time signature/);
  });
});

describe('parsed signatures as plain data', () => {
  it('leaves out the grouping it has none of', () => {
    expect(Object.keys(parseTimeSignature('4/4'))).toEqual(['numerator', 'denominator']);
    expect('grouping' in parseTimeSignature('4/4')).toBe(false);
    const parsed = tryParseTimeSignature('4/4');
    expect(parsed.ok && Object.keys(parsed.value)).toEqual(['numerator', 'denominator']);
  });

  it('keeps the grouping an additive signature names', () => {
    expect(parseTimeSignature('2+2+3/8')).toEqual({
      numerator: 7,
      denominator: 8,
      grouping: [2, 2, 3],
    });
  });

  it('survives a JSON round trip with the same own keys', () => {
    for (const text of ['4/4', '6/8', '2+2+3/8']) {
      const parsed = parseTimeSignature(text);
      const roundTripped = JSON.parse(JSON.stringify(parsed));
      expect(Object.keys(roundTripped)).toEqual(Object.keys(parsed));
      expect(roundTripped).toEqual(parsed);
    }
  });

  it('keeps a composer equal to itself across a JSON round trip', () => {
    for (const meters of ['4/4', '6/8', '2+2+3/8']) {
      const composer = Composer.of({ meters });
      const restored = Composer.fromJSON(JSON.parse(JSON.stringify(composer)));
      expect(composer.equals(restored)).toBe(true);
    }
  });

  it('resolves a meter map whose entries came from the parser', () => {
    const meters = resolveMeters({ meters: [{ startBeat: 0, ts: parseTimeSignature('4/4') }] });
    expect(Object.keys(meters[0]?.ts ?? {})).toEqual(['numerator', 'denominator']);
  });
});

describe('the class layer', () => {
  it('takes a named meter wherever the functional layer does', () => {
    expect(Rhythm.generate('4/4', { bars: 2, ctx: { seed: 7 } }).data).toEqual(
      Rhythm.generate(parseTimeSignature('4/4'), { bars: 2, ctx: { seed: 7 } }).data,
    );
    expect(Rhythm.of([{ position: 0, duration: 3 }], '6/8').data.ts).toEqual(
      parseTimeSignature('6/8'),
    );
  });
});
