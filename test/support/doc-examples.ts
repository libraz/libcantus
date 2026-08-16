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

/** Render the generated vitest module for one documentation snippet. */
export function renderTestModule(label: string, code: string): string {
  const { imports, body } = toRunnable(code);
  const joined = body.join('\n');
  const indented = joined
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
  return [
    "import { expect, it } from 'vitest';",
    ...imports,
    '',
    `it(${JSON.stringify(label)}, ${/\bawait\b/.test(joined) ? 'async ' : ''}() => {`,
    indented,
    '});',
    '',
  ].join('\n');
}
