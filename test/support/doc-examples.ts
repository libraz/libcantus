import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface CodeBlock {
  /** Info string of the opening fence, trimmed. */
  lang: string;
  /** Block body without the fences. */
  code: string;
  /** 1-based line number of the opening fence. */
  line: number;
}

/** Collect every markdown file under `dir`, as paths relative to `dir`, sorted. */
export function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) found.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return found.sort();
}

/** Extract fenced code blocks from markdown source. */
export function codeBlocks(source: string): CodeBlock[] {
  const lines = source.split('\n');
  const blocks: CodeBlock[] = [];
  let open: { lang: string; line: number; body: string[] } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      if (open) {
        blocks.push({ lang: open.lang, code: open.body.join('\n'), line: open.line });
        open = null;
      } else {
        open = { lang: line.slice(3).trim(), line: i + 1, body: [] };
      }
      continue;
    }
    open?.body.push(line);
  }
  return blocks;
}

/**
 * Extract the fenced blocks of every `@example` tag in a TypeScript source
 * file's TSDoc, with the line number of each opening fence.
 *
 * The examples are what the API reference prints and what an editor shows on
 * hover, so they are collected the same way the guides are and run the same
 * way. Comments tagged `@internal` are skipped: TypeDoc drops them, so they are
 * not part of what ships.
 */
export function tsdocExamples(source: string): CodeBlock[] {
  const lines = source.split('\n');
  const found: CodeBlock[] = [];
  let comment: CodeBlock[] | null = null;
  let internal = false;
  let inExample = false;
  let open: { lang: string; line: number; body: string[] } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? '').trim();
    if (comment === null) {
      if (trimmed.startsWith('/**')) {
        comment = [];
        internal = false;
        inExample = false;
        open = null;
      }
      continue;
    }
    if (trimmed.startsWith('*/')) {
      if (!internal) found.push(...comment);
      comment = null;
      continue;
    }
    // A doc line carries a leading asterisk; everything after it is the text,
    // indentation of the code included.
    const text = trimmed.replace(/^\*\s?/, '');
    if (open === null && text.startsWith('@')) {
      inExample = text.startsWith('@example');
      if (text.startsWith('@internal')) internal = true;
      continue;
    }
    if (!inExample) continue;
    if (text.startsWith('```')) {
      if (open) {
        comment.push({ lang: open.lang, code: open.body.join('\n'), line: open.line });
        open = null;
      } else {
        open = { lang: text.slice(3).trim(), line: i + 1, body: [] };
      }
      continue;
    }
    open?.body.push(text);
  }
  return found;
}

/** Split a line into its code part and its trailing line comment, ignoring quoted text. */
function splitComment(line: string): { code: string; comment: string | null } {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      return { code: line.slice(0, i), comment: line.slice(i + 2).trim() };
    }
  }
  return { code: line, comment: null };
}

/**
 * A snippet with its line comments removed and its blank lines closed up.
 *
 * This is how a translated page is compared with the English one it mirrors:
 * the prose in a comment is translated and the code around it is not, so a
 * signature that changes on one side cannot be left stale on the other.
 */
export function withoutComments(code: string): string {
  return code
    .split('\n')
    .map((line) => splitComment(line).code.trimEnd())
    .filter((line) => line !== '')
    .join('\n');
}

/** Net bracket depth contributed by a code fragment, ignoring quoted text. */
function bracketDelta(code: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i] as string;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
  }
  return depth;
}

const KEYWORD_LITERAL = /^(true|false|null|undefined|NaN|Infinity)\b/;
const NUMBER_LITERAL = /^-?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?/i;
const IDENTIFIER = /^[A-Za-z_$][\w$]*/;

/**
 * Recognize the literal subset used for expected values in the guides, returning
 * the index just past the literal or `-1`.
 *
 * Only strings, numbers, booleans, `null`, `undefined`, arrays, and object
 * literals are accepted. Anything else — prose, a class name, a call — is
 * rejected so the comment stays a comment.
 */
function readLiteral(text: string, start: number): number {
  let i = skipSpace(text, start);
  const ch = text[i];
  if (ch === undefined) return -1;

  if (ch === "'" || ch === '"') {
    i += 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') i += 2;
      else if (c === ch) return i + 1;
      else i += 1;
    }
    return -1;
  }

  if (ch === '[' || ch === '{') {
    const close = ch === '[' ? ']' : '}';
    i = skipSpace(text, i + 1);
    if (text[i] === close) return i + 1;
    for (;;) {
      if (ch === '{') {
        const key = readKey(text, i);
        if (key < 0) return -1;
        i = skipSpace(text, key);
        if (text[i] !== ':') return -1;
        i += 1;
      }
      const value = readLiteral(text, i);
      if (value < 0) return -1;
      i = skipSpace(text, value);
      if (text[i] === ',') {
        i = skipSpace(text, i + 1);
        if (text[i] === close) return i + 1;
        continue;
      }
      if (text[i] === close) return i + 1;
      return -1;
    }
  }

  const rest = text.slice(i);
  const keyword = rest.match(KEYWORD_LITERAL);
  if (keyword) return i + keyword[0].length;
  const number = rest.match(NUMBER_LITERAL);
  if (number) return i + number[0].length;
  return -1;
}

function readKey(text: string, start: number): number {
  const i = skipSpace(text, start);
  const ch = text[i];
  if (ch === "'" || ch === '"') return readLiteral(text, i);
  const identifier = text.slice(i).match(IDENTIFIER);
  return identifier ? i + identifier[0].length : -1;
}

function skipSpace(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/.test(text[i] as string)) i += 1;
  return i;
}

/** True when the whole comment text is a literal expected value. */
export function isLiteral(text: string): boolean {
  if (text === '') return false;
  const end = readLiteral(text, 0);
  return end > 0 && skipSpace(text, end) === text.length;
}

const STATEMENT_KEYWORD =
  /^(const|let|var|import|export|function|async|class|type|interface|enum|return|if|for|while|switch|try|catch|throw|do|else)\b/;

/** True when the fragment can be wrapped in `expect(...)`. */
function isExpression(statement: string): boolean {
  const first = statement.split('\n').find((line) => line.trim() !== '') ?? '';
  return !STATEMENT_KEYWORD.test(first.trim());
}

export interface Runnable {
  /** Import declarations, hoisted to the top of the generated module. */
  imports: string[];
  /** Remaining statements, with expected-value comments turned into assertions. */
  body: string[];
  /** Number of expected values that became assertions. */
  assertions: number;
}

/**
 * Rewrite a documentation snippet into executable form.
 *
 * A trailing `// value` comment — inline or on the lines that follow — becomes an
 * `expect(...).toEqual(value)` call whenever the comment text is a literal. Prose
 * comments are left alone, so the expression is still evaluated but not checked.
 */
export function toRunnable(code: string): Runnable {
  const lines = code.split('\n');
  const imports: string[] = [];
  const body: string[] = [];
  let buffer: string[] = [];
  let depth = 0;
  let assertions = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const { code: fragment, comment } = splitComment(raw);
    if (buffer.length === 0 && fragment.trim() === '') {
      body.push(raw);
      continue;
    }

    buffer.push(fragment);
    depth += bracketDelta(fragment);
    // A statement ends at a semicolon, or at the closing brace of a declaration
    // that has no semicolon of its own — otherwise the next statement would be
    // swallowed into the same fragment.
    const tail = fragment.trimEnd();
    if (depth > 0 || !(tail.endsWith(';') || tail.endsWith('}'))) continue;

    let expected = comment;
    let consumed = 0;
    if (expected === null) {
      const parts: string[] = [];
      let j = i + 1;
      while (j < lines.length && (lines[j] ?? '').trim().startsWith('//')) {
        parts.push((lines[j] ?? '').trim().slice(2).trim());
        j += 1;
      }
      if (parts.length > 0) {
        expected = parts.join(' ');
        consumed = j - i - 1;
      }
    }

    const statement = buffer.join('\n');
    buffer = [];
    depth = 0;

    if (statement.trimStart().startsWith('import ')) {
      imports.push(statement);
      continue;
    }
    if (expected !== null && isLiteral(expected) && isExpression(statement)) {
      body.push(`expect(${statement.trimEnd().replace(/;$/, '')}).toEqual(${expected});`);
      assertions += 1;
      i += consumed;
      continue;
    }
    body.push(statement);
  }

  if (buffer.length > 0) body.push(buffer.join('\n'));
  return { imports, body, assertions };
}

/** One snippet ready to render: what to call it, and the code it publishes. */
export interface Example {
  label: string;
  code: string;
}

/** Render one snippet as an `it`, its body indented into the callback. */
function renderTest(label: string, body: string[]): string {
  const joined = body.join('\n');
  const indented = joined
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
  return [
    `it(${JSON.stringify(label)}, ${/\bawait\b/.test(joined) ? 'async ' : ''}() => {`,
    indented,
    '});',
  ].join('\n');
}

/** Render the generated vitest module for one documentation snippet. */
export function renderTestModule(label: string, code: string): string {
  const { imports, body } = toRunnable(code);
  return ["import { expect, it } from 'vitest';", ...imports, '', renderTest(label, body), ''].join(
    '\n',
  );
}

/** A named import, split into where it comes from and what it binds. */
const NAMED_IMPORT = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?\s*$/;

/** The name an import statement binds locally, which an alias renames. */
function localName(name: string): string {
  const parts = name.split(/\s+as\s+/);
  return (parts[parts.length - 1] ?? name).trim();
}

/**
 * Merge the import statements of several snippets into one set, or null when
 * they cannot be merged — an import this does not recognize, or one name
 * arriving from two different modules, which would collide in a shared scope.
 */
function mergeImports(statements: string[]): string[] | null {
  const byModule = new Map<string, { values: Set<string>; types: Set<string> }>();
  const origin = new Map<string, string>();
  for (const statement of statements) {
    const match = statement.trim().match(NAMED_IMPORT);
    if (!match) return null;
    const [, typeOnly, names = '', specifier = ''] = match;
    const bucket = byModule.get(specifier) ?? { values: new Set(), types: new Set() };
    for (const name of names.split(',').map((part) => part.trim().replace(/\s+/g, ' '))) {
      if (name === '') continue;
      const local = localName(name);
      if ((origin.get(local) ?? specifier) !== specifier) return null;
      origin.set(local, specifier);
      // A name wanted as a value anywhere is imported as one everywhere; the
      // type-only form of the same binding would be a duplicate declaration.
      if (typeOnly === undefined) {
        bucket.values.add(name);
        bucket.types.delete(name);
      } else if (!bucket.values.has(name)) {
        bucket.types.add(name);
      }
    }
    byModule.set(specifier, bucket);
  }
  const merged: string[] = [];
  for (const [specifier, { values, types }] of byModule) {
    const sorted = (names: Set<string>) => [...names].sort().join(', ');
    if (types.size > 0) merged.push(`import type { ${sorted(types)} } from '${specifier}';`);
    if (values.size > 0) merged.push(`import { ${sorted(values)} } from '${specifier}';`);
  }
  return merged;
}

/**
 * Render several snippets from one source as a single vitest module, or null
 * when their imports cannot be shared.
 *
 * Each snippet is a test of its own, so a failure still names the file and line
 * it was written on; only the import of the library is shared. That import is
 * the expensive part — every module pays it again — and a source publishes a
 * dozen examples of the same few entry points.
 */
export function renderTestSuite(examples: Example[]): string | null {
  const runnable = examples.map((example) => ({
    label: example.label,
    ...toRunnable(example.code),
  }));
  const imports = mergeImports(runnable.flatMap((example) => example.imports));
  if (imports === null) return null;
  return [
    "import { expect, it } from 'vitest';",
    ...imports,
    '',
    ...runnable.map((example) => `${renderTest(example.label, example.body)}\n`),
  ].join('\n');
}
