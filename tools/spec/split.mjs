#!/usr/bin/env node
/**
 * Split the pure-TS test suite into the shared spec suite and the TS-only rest.
 *
 * A unit is one `it` / `test`; a `.each`, a `describe.each`, or any statement
 * that generates tests in a loop is one unit for the whole statement. A unit is
 * TS-only when anything transitively reachable from it (helpers, describe-scope
 * bindings, enclosing hooks, `.each` tables, shared support) does one of:
 *
 *   1. references a symbol that no public entry point (`ts/src/index.ts` and the
 *      five layer barrels) exports;
 *   2. reads source or doc text through `node:fs` or
 *      `support/{source-files,signatures,doc-examples,generate-doc-examples}`;
 *   3. replaces library internals with `vi.mock` / `vi.spyOn`;
 *   4. asserts identity (`toBe` / `not.toBe`) on an object-typed value, unless
 *      `api/annotations.json` lists the assertion as an identity exception.
 *
 * Input is read from a git ref (`--from`, default: the `base` recorded in
 * `tests/spec/manifest.json`, else HEAD) so the split is reproducible after the
 * tree has been rewritten. Output: `tests/spec/**`, the remaining `ts/test/**`
 * and `tests/spec/manifest.json`.
 *
 * Usage: node tools/spec/split.mjs [--from <ref>] [--dry [--manifest-out <file>]]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(REPO, 'ts');
const SRC = path.join(PKG, 'src');
const TEST = path.join(PKG, 'test');
const SPEC = path.join(REPO, 'tests/spec');
const MANIFEST = path.join(SPEC, 'manifest.json');
const ANNOTATIONS = path.join(REPO, 'api/annotations.json');
const LAYERS = ['core', 'theory', 'analyze', 'generate', 'model'];
const ROOT_MODULE = '@libraz/libcantus';

/** Support modules whose whole purpose is reading source or doc text (criterion 2). */
const SOURCE_TEXT_SUPPORT = new Set([
  'support/source-files.ts',
  'support/signatures.ts',
  'support/doc-examples.ts',
  'support/generate-doc-examples.ts',
]);

/**
 * Files whose `node:fs` and `source-files` use is golden-file I/O rather than
 * source text, with the spec-side replacement for the path declaration.
 */
const GOLDEN_IO = {
  'derived-determinism.test.ts': {
    replace: {
      GOLDEN:
        "const GOLDEN = fileURLToPath(new URL('./golden/determinism.json', import.meta.url));",
    },
    imports: [{ module: 'node:url', name: 'fileURLToPath' }],
    patches: [
      [
        'UPDATE_GOLDEN=1 yarn vitest run test/derived-determinism.test.ts',
        'UPDATE_GOLDEN=1 yarn spec tests/spec/derived-determinism.test.ts',
      ],
    ],
  },
};

/**
 * Spec-side copies of support modules: path roots move from `ts/test/support`
 * to `tests/spec/support`. Each patch must match, so a drifted source fails here.
 */
const SUPPORT_PATCHES = {
  'support/source-files.ts': [
    [
      "/** The npm package root (`ts/`), as an absolute path. */\nexport const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');\n\n/** The repository root, which holds the guides under `docs/`. */\nexport const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');",
      "/** The repository root, which holds the guides under `docs/`. */\nexport const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');\n\n/** The npm package root (`ts/`), as an absolute path. */\nexport const PACKAGE_ROOT = path.join(REPO_ROOT, 'ts');",
    ],
    [
      "/** The test suite. */\nexport const TESTS = path.join(PACKAGE_ROOT, 'test');",
      "/** The shared spec suite. */\nexport const TESTS = path.join(REPO_ROOT, 'tests', 'spec');",
    ],
  ],
};

/**
 * TS-side edits for the checks that read the suite's own text: after the split
 * the suite is `ts/test` and `tests/spec` together, so each reads both.
 */
const TS_PATCHES = {
  'support/source-files.ts': [
    [
      "/** The test suite. */\nexport const TESTS = path.join(PACKAGE_ROOT, 'test');",
      "/** The TS-only half of the test suite. */\nexport const TESTS = path.join(PACKAGE_ROOT, 'test');\n\n/** The shared half of the test suite, which every implementation runs. */\nexport const SPEC_TESTS = path.join(REPO_ROOT, 'tests', 'spec');",
    ],
  ],
  'budget-coverage.test.ts': [
    [
      "import { filesUnder, SRC, TESTS } from './support/source-files.js';",
      "import { filesUnder, SPEC_TESTS, SRC, TESTS } from './support/source-files.js';",
    ],
    [
      "  const suite = filesUnder(TESTS, '.ts')\n",
      "  const suite = [TESTS, SPEC_TESTS]\n    .flatMap((dir) => filesUnder(dir, '.ts'))\n",
    ],
  ],
  'suite-hygiene.test.ts': [
    [
      "import { readFileSync } from 'node:fs';",
      "import { existsSync, readFileSync } from 'node:fs';",
    ],
    [
      "import { filesUnder, PACKAGE_ROOT, REPO_ROOT, SRC, TESTS } from './support/source-files.js';",
      "import { filesUnder, PACKAGE_ROOT, REPO_ROOT, SPEC_TESTS, SRC, TESTS } from './support/source-files.js';",
    ],
    [
      "const GENERATED = path.join(TESTS, 'generated');",
      "const GENERATED = path.join(SPEC_TESTS, 'generated');",
    ],
    [
      "    return execFileSync('git', ['ls-files', '-z', '--', 'test'], {",
      "    return execFileSync('git', ['ls-files', '-z', '--', 'test', path.relative(PACKAGE_ROOT, SPEC_TESTS)], {",
    ],
    [
      "      .map((file) => path.join(PACKAGE_ROOT, file));\n  } catch {\n    return filesUnder(TESTS, '.test.ts');\n  }",
      "      .map((file) => path.join(PACKAGE_ROOT, file))\n      // A file deleted from the checkout is no longer carried, committed or not.\n      .filter((file) => existsSync(file));\n  } catch {\n    return [TESTS, SPEC_TESTS].flatMap((dir) => filesUnder(dir, '.test.ts'));\n  }",
    ],
    [
      "    ...filesUnder(TESTS, '.test.ts').filter(",
      "    ...[TESTS, SPEC_TESTS].flatMap((dir) => filesUnder(dir, '.test.ts')).filter(",
    ],
  ],
  'model-contracts.test.ts': [
    [
      "  const EQUIVALENCE = readFileSync(resolve(ROOT, 'test/class-equivalence.test.ts'), 'utf8');",
      "  const EQUIVALENCE = ['test/class-equivalence.test.ts', '../tests/spec/class-equivalence.test.ts']\n    .map((file) => readFileSync(resolve(ROOT, file), 'utf8'))\n    .join('\\n');",
    ],
  ],
};

/** Support modules the spec side needs regardless of the unit split (the docs generator). */
const SPEC_SUPPORT_ALWAYS = [
  'support/generate-doc-examples.ts',
  'support/doc-examples.ts',
  'support/source-files.ts',
];

// ---------------------------------------------------------------------------
// Input

function parseArgs(argv) {
  const args = { from: null, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--dry') args.dry = true;
    else if (argv[i] === '--manifest-out') args.manifestOut = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.from) {
    args.from = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).base : 'HEAD';
  }
  return args;
}

/** Every file under `ts/src`, `ts/test` (minus generated output) and the ts configs at `ref`. */
function loadTree(ref) {
  const sha = execFileSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' }).trim();
  const names = execFileSync(
    'git',
    [
      'ls-tree',
      '-r',
      '--name-only',
      sha,
      'ts/src',
      'ts/test',
      'ts/tsconfig.json',
      'ts/tsconfig.test.json',
    ],
    { cwd: REPO, encoding: 'utf8' },
  )
    .split('\n')
    .filter((name) => name && !name.startsWith('ts/test/generated/'));
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd: REPO,
    input: names.map((name) => `${sha}:${name}\n`).join(''),
    maxBuffer: 1 << 30,
  });
  const files = new Map();
  let offset = 0;
  for (const name of names) {
    const headerEnd = out.indexOf(10, offset);
    const header = out.subarray(offset, headerEnd).toString('utf8');
    const size = Number(header.split(' ')[2]);
    const body = out.subarray(headerEnd + 1, headerEnd + 1 + size);
    files.set(path.join(REPO, name), body);
    offset = headerEnd + 1 + size + 1;
  }
  return { sha, files };
}

function createProgram(tree) {
  const inTree = (file) =>
    file.startsWith(`${SRC}${path.sep}`) || file.startsWith(`${TEST}${path.sep}`);
  const read = (file) => {
    const resolved = path.resolve(file);
    if (tree.files.has(resolved)) return tree.files.get(resolved).toString('utf8');
    if (inTree(resolved)) return undefined;
    return ts.sys.readFile(resolved);
  };
  const exists = (file) => {
    const resolved = path.resolve(file);
    if (tree.files.has(resolved)) return true;
    if (inTree(resolved)) return false;
    return ts.sys.fileExists(resolved);
  };
  const configPath = path.join(PKG, 'tsconfig.test.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      readFile: read,
      fileExists: exists,
      readDirectory: () => [],
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  );
  const host = ts.createCompilerHost(parsed.options, true);
  host.readFile = read;
  host.fileExists = exists;
  host.getSourceFile = (fileName, languageVersion) => {
    const text = read(fileName);
    return text === undefined
      ? undefined
      : ts.createSourceFile(fileName, text, languageVersion, true);
  };
  const testFiles = [...tree.files.keys()]
    .filter((file) => file.startsWith(`${TEST}${path.sep}`) && file.endsWith('.ts'))
    .sort();
  const entries = [path.join(SRC, 'index.ts'), ...LAYERS.map((l) => path.join(SRC, l, 'index.ts'))];
  const program = ts.createProgram([...entries, ...testFiles], parsed.options, host);
  return { program, testFiles };
}

// ---------------------------------------------------------------------------
// Public surface

/** Map from resolved export symbol to the public `{ module, name }` it is reachable under. */
function publicSurface(program, checker) {
  const surface = new Map();
  const modules = [
    [ROOT_MODULE, path.join(SRC, 'index.ts')],
    ...LAYERS.map((l) => [`${ROOT_MODULE}/${l}`, path.join(SRC, l, 'index.ts')]),
  ];
  for (const [module, file] of modules) {
    const sf = program.getSourceFile(file);
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const target = resolveAlias(checker, exported);
      if (!surface.has(target)) surface.set(target, new Map());
      surface.get(target).set(module, exported.name);
    }
  }
  return surface;
}

function resolveAlias(checker, symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

// ---------------------------------------------------------------------------
// Items: the statements of each scope

const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const TEST_ROOTS = new Set(['it', 'test']);

/** The identifier a call chain such as `it.each(table)` or `describe.skip` starts from. */
function calleeRoot(expr) {
  let current = expr;
  for (;;) {
    if (ts.isCallExpression(current)) current = current.expression;
    else if (ts.isPropertyAccessExpression(current)) current = current.expression;
    else if (ts.isTaggedTemplateExpression(current)) current = current.tag;
    else break;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

/** Property names along a call chain, root first: `it.each(x)('…')` → ['each']. */
function calleeMembers(expr) {
  const names = [];
  let current = expr;
  for (;;) {
    if (ts.isCallExpression(current)) current = current.expression;
    else if (ts.isTaggedTemplateExpression(current)) current = current.tag;
    else if (ts.isPropertyAccessExpression(current)) {
      names.unshift(current.name.text);
      current = current.expression;
    } else break;
  }
  return names;
}

function containsTestCall(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && TEST_ROOTS.has(calleeRoot(n.expression) ?? '')) {
      found = true;
      return;
    }
    if (ts.isCallExpression(n) && calleeRoot(n.expression) === 'describe') {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** The callback block of a plain `describe(...)` statement, or null. */
function describeBody(statement) {
  if (!ts.isExpressionStatement(statement)) return null;
  const call = statement.expression;
  if (!ts.isCallExpression(call) || calleeRoot(call.expression) !== 'describe') return null;
  const members = calleeMembers(call.expression);
  if (members.includes('each') || members.includes('for')) return null;
  const fn = call.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  if (!fn || !ts.isBlock(fn.body)) return null;
  return fn.body;
}

function isHook(statement) {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    HOOKS.has(statement.expression.expression.text)
  );
}

function isDeclaration(statement) {
  return (
    ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  );
}

/** Names a declaration statement binds. */
function declaredNames(statement) {
  if (ts.isVariableStatement(statement)) {
    const names = [];
    const collect = (name) => {
      if (ts.isIdentifier(name)) names.push(name.text);
      else
        for (const element of name.elements)
          if (!ts.isOmittedExpression(element)) collect(element.name);
    };
    for (const d of statement.declarationList.declarations) collect(d.name);
    return names;
  }
  return statement.name ? [statement.name.text] : [];
}

function testTitle(node, sf) {
  let title = null;
  const visit = (n) => {
    if (title !== null) return;
    if (
      ts.isCallExpression(n) &&
      (TEST_ROOTS.has(calleeRoot(n.expression) ?? '') || calleeRoot(n.expression) === 'describe')
    ) {
      const first = n.arguments[0];
      title =
        first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
          ? first.text
          : first
            ? first.getText(sf)
            : '';
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return title ?? '';
}

/**
 * Build the item tree of one file. Kinds: import, unit, container, hook,
 * decl, effect. Support files hold only import / decl / effect items.
 */
function buildItems(sf, isSupport) {
  const items = [];
  const byNode = new Map();
  const add = (item) => {
    items.push(item);
    byNode.set(item.node, item);
    return item;
  };
  const scope = (statements, parent) => {
    const children = [];
    for (const statement of statements) {
      let item;
      if (ts.isImportDeclaration(statement)) {
        item = add({ kind: 'import', node: statement, parent });
      } else if (!isSupport && describeBody(statement)) {
        item = add({ kind: 'container', node: statement, parent, children: [] });
        item.children = scope(describeBody(statement).statements, item);
      } else if (!isSupport && isHook(statement)) {
        item = add({ kind: 'hook', node: statement, parent });
      } else if (isDeclaration(statement)) {
        item = add({ kind: 'decl', node: statement, parent, names: declaredNames(statement) });
      } else if (!isSupport && containsTestCall(statement)) {
        item = add({ kind: 'unit', node: statement, parent });
      } else {
        item = add({ kind: 'effect', node: statement, parent });
      }
      children.push(item);
    }
    return children;
  };
  const top = scope(sf.statements, null);
  return { items, byNode, top };
}

// ---------------------------------------------------------------------------
// Facts: what one item references directly

function isTypePosition(id) {
  let node = id.parent;
  while (node && !ts.isStatement(node) && !ts.isSourceFile(node)) {
    if (
      ts.isTypeNode(node) ||
      (ts.isExpressionWithTypeArguments(node) &&
        ts.isHeritageClause(node.parent) &&
        node.parent.parent &&
        ts.isInterfaceDeclaration(node.parent.parent))
    ) {
      return true;
    }
    if (ts.isTypeQueryNode(node)) return true;
    node = node.parent;
  }
  return false;
}

function isObjectType(type) {
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((part) => {
    if (part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
    if (part.isIntersection()) return part.types.some((t) => t.flags & ts.TypeFlags.Object);
    if (!(part.flags & ts.TypeFlags.Object)) return false;
    const callable =
      part.getCallSignatures().length > 0 || part.getConstructSignatures().length > 0;
    return !(callable && part.getProperties().length === 0) && !callable;
  });
}

function createAnalyzer(ctx) {
  const { checker, surface, files, relTest } = ctx;
  const factsCache = new Map();

  /** The item whose subtree holds `node`, searching the file's item map. */
  function ownerItem(node) {
    const file = files.get(node.getSourceFile().fileName);
    if (!file) return null;
    for (let n = node; n; n = n.parent) {
      const item = file.byNode.get(n);
      if (item) return item;
    }
    return null;
  }

  function isModuleExport(decl) {
    if (ts.isVariableDeclaration(decl)) return ts.isSourceFile(decl.parent?.parent?.parent);
    if (ts.isExportSpecifier(decl) || ts.isExportAssignment(decl)) return true;
    return ts.isSourceFile(decl.parent);
  }

  /** Where a module specifier written in `fromFile` lands on the public surface, or null. */
  function publicModuleOf(spec, fromFile) {
    if (spec.startsWith(ROOT_MODULE)) return spec;
    if (!spec.startsWith('.')) return null;
    const rel = path.relative(
      SRC,
      path.resolve(path.dirname(fromFile), spec).replace(/\.js$/, '.ts'),
    );
    if (rel === 'index.ts') return ROOT_MODULE;
    const parts = rel.split(path.sep);
    if (parts.length === 2 && LAYERS.includes(parts[0]) && parts[1] === 'index.ts')
      return `${ROOT_MODULE}/${parts[0]}`;
    return null;
  }

  /** The nodes a container contributes on its own: the describe callee and title, not its body. */
  function ownNodes(item) {
    if (item.kind !== 'container') return [item.node];
    const call = item.node.expression;
    return [
      call.expression,
      ...call.arguments.filter((a) => !ts.isArrowFunction(a) && !ts.isFunctionExpression(a)),
    ];
  }

  function factsOf(item) {
    if (factsCache.has(item)) return factsCache.get(item);
    const facts = {
      deps: new Set(),
      bindings: new Map(),
      privates: [],
      sourceText: [],
      mocks: [],
      identity: [],
      expects: 0,
      moduleRewrites: [],
      pathLiterals: [],
      generatesTests: false,
    };
    factsCache.set(item, facts);
    const sf = item.node.getSourceFile();
    const rel = relTest(sf.fileName);
    const golden = GOLDEN_IO[path.basename(sf.fileName)] ?? null;

    const useBinding = (decl, id, typeOnly) => {
      const importDecl = ts.findAncestor(decl, ts.isImportDeclaration);
      const spec = importDecl.moduleSpecifier.text;
      const key = decl;
      const entry = facts.bindings.get(key) ?? { decl, importDecl, local: id.text, value: false };
      if (!typeOnly) entry.value = true;
      facts.bindings.set(key, entry);
      if (spec === 'node:fs' || spec === 'node:fs/promises' || spec === 'fs') {
        if (!golden) facts.sourceText.push(`${spec}:${id.text}`);
        return;
      }
      if (ts.isNamespaceImport(decl) || ts.isImportClause(decl)) {
        if (
          spec.startsWith('.') &&
          !publicModuleOf(spec, sf.fileName) &&
          path.resolve(path.dirname(sf.fileName), spec).startsWith(SRC)
        ) {
          facts.privates.push({ name: `* from ${spec}`, file: rel, typeOnly });
        }
        if (
          spec.startsWith('.') &&
          !path.resolve(path.dirname(sf.fileName), spec).startsWith(SRC)
        ) {
          // Default or namespace import of a support module: its declarations are the dependency.
          const target = path.relative(
            TEST,
            path.resolve(path.dirname(sf.fileName), spec).replace(/\.js$/, '.ts'),
          );
          if (SOURCE_TEXT_SUPPORT.has(target)) facts.sourceText.push(`${target}:${id.text}`);
          else if (!target.startsWith('support/'))
            facts.privates.push({ name: `${id.text} from ${spec}`, file: rel, typeOnly });
        }
        return;
      }
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(sf.fileName), spec).replace(/\.js$/, '.ts');
        const relTarget = path.relative(TEST, target);
        if (SOURCE_TEXT_SUPPORT.has(relTarget)) {
          if (!(golden && relTarget === 'support/source-files.ts'))
            facts.sourceText.push(`${relTarget}:${id.text}`);
          return;
        }
      }
      const symbol = checker.getSymbolAtLocation(id) ?? null;
      if (!symbol) return;
      const resolved = resolveAlias(checker, symbol);
      checkTarget(resolved, typeOnly);
    };

    const checkTarget = (resolved, typeOnly) => {
      for (const d of resolved.declarations ?? []) {
        const file = d.getSourceFile().fileName;
        if (file.startsWith(`${SRC}${path.sep}`)) {
          if (!surface.has(resolved)) {
            facts.privates.push({ name: resolved.name, file: path.relative(PKG, file), typeOnly });
          }
          return;
        }
        if (files.has(file) && file !== sf.fileName) {
          const owner = ownerItem(d);
          if (owner && owner.kind === 'decl') facts.deps.add(owner);
        }
      }
    };

    const visit = (node) => {
      if (ts.isImportDeclaration(node)) return;
      const dynamicSpec =
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
          ? node.arguments[0]
          : ts.isImportTypeNode(node) &&
              ts.isLiteralTypeNode(node.argument) &&
              ts.isStringLiteral(node.argument.literal)
            ? node.argument.literal
            : null;
      if (dynamicSpec?.text.startsWith('.')) {
        const module = publicModuleOf(dynamicSpec.text, sf.fileName);
        if (module) facts.moduleRewrites.push({ node: dynamicSpec, module });
        else
          facts.privates.push({
            name: `import(${dynamicSpec.text})`,
            file: rel,
            typeOnly: ts.isImportTypeNode(node),
          });
      }
      const pathLiteral = relativePathLiteral(node);
      if (pathLiteral) facts.pathLiterals.push(pathLiteral);
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === 'expect') facts.expects += 1;
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'vi'
        ) {
          const method = callee.name.text;
          if (
            (method === 'mock' || method === 'doMock') &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
          ) {
            const target = node.arguments[0].text;
            const abs = target.startsWith('.')
              ? path.resolve(path.dirname(sf.fileName), target)
              : '';
            if (abs.startsWith(`${SRC}${path.sep}`) || target.startsWith(ROOT_MODULE)) {
              facts.mocks.push(`vi.${method}(${target})`);
            }
          }
          if (method === 'spyOn' && node.arguments[0]) {
            const object = node.arguments[0];
            const type = checker.getTypeAtLocation(object);
            const declared = [type.getSymbol(), checker.getSymbolAtLocation(object)]
              .filter(Boolean)
              .map((s) => resolveAlias(checker, s))
              .flatMap((s) => s.declarations ?? []);
            if (
              declared.some(
                (d) =>
                  d.getSourceFile().fileName.startsWith(`${SRC}${path.sep}`) || ts.isSourceFile(d),
              )
            ) {
              facts.mocks.push(`vi.spyOn(${object.getText(sf)})`);
            }
          }
        }
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'toBe') {
          let receiver = callee.expression;
          if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'not')
            receiver = receiver.expression;
          if (
            ts.isCallExpression(receiver) &&
            ts.isIdentifier(receiver.expression) &&
            receiver.expression.text === 'expect' &&
            receiver.arguments[0]
          ) {
            const actual = receiver.arguments[0];
            const expected = node.arguments[0];
            if (
              expected &&
              isObjectType(checker.getTypeAtLocation(actual)) &&
              isObjectType(checker.getTypeAtLocation(expected))
            ) {
              const line = sf.getLineAndCharacterOfPosition(receiver.getStart(sf)).line + 1;
              facts.identity.push({ at: `${rel}:${line}`, text: node.getText(sf).split('\n')[0] });
            }
          }
        }
      }
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const symbol =
          ts.isShorthandPropertyAssignment(parent) && parent.name === node
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node);
        if (symbol) {
          const typeOnly = isTypePosition(node);
          for (const d of symbol.declarations ?? []) {
            const file = d.getSourceFile().fileName;
            if (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)) {
              if (files.has(file)) useBinding(d, node, typeOnly);
            } else if (file === sf.fileName) {
              const owner = ownerItem(d);
              if (
                owner &&
                owner !== item &&
                owner.kind === 'decl' &&
                !isWithin(item.node, owner.node)
              )
                facts.deps.add(owner);
            } else if (file.startsWith(`${SRC}${path.sep}`)) {
              if (isModuleExport(d)) checkTarget(resolveAlias(checker, symbol), typeOnly);
            } else if (files.has(file)) {
              const owner = ownerItem(d);
              if (owner && owner.kind === 'decl') facts.deps.add(owner);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const node of ownNodes(item)) visit(node);
    facts.generatesTests = item.kind === 'decl' && containsTestCall(item.node);
    return facts;
  }

  return { factsOf, ownerItem };
}

/** Whether an expression names the directory of the file it is written in. */
function isOwnDirectory(expr) {
  if (ts.isIdentifier(expr)) return expr.text === '__dirname';
  // dirname(fileURLToPath(import.meta.url)) / path.dirname(...)
  if (!ts.isCallExpression(expr) || expr.arguments.length !== 1) return false;
  const name = ts.isPropertyAccessExpression(expr.expression)
    ? expr.expression.name.text
    : expr.expression.getText();
  if (name !== 'dirname') return false;
  const inner = expr.arguments[0];
  return ts.isCallExpression(inner) && inner.getText() === 'fileURLToPath(import.meta.url)';
}

/**
 * A relative path literal resolved against the file's own directory:
 * `new URL('..', import.meta.url)` or `resolve(__dirname, '..')`.
 */
function relativePathLiteral(node) {
  if (
    ts.isNewExpression(node) &&
    node.expression.getText() === 'URL' &&
    node.arguments?.length === 2
  ) {
    const [first, base] = node.arguments;
    if (
      ts.isStringLiteral(first) &&
      first.text.startsWith('.') &&
      base.getText() === 'import.meta.url'
    )
      return first;
  }
  if (ts.isCallExpression(node) && node.arguments.length >= 2) {
    const name = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : node.expression.getText();
    const [base, first] = node.arguments;
    if (
      (name === 'resolve' || name === 'join') &&
      isOwnDirectory(base) &&
      ts.isStringLiteral(first) &&
      first.text.startsWith('.')
    ) {
      return first;
    }
  }
  return null;
}

function isWithin(node, ancestor) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Classification

function ancestorsScopeItems(item) {
  // Hooks and side-effect statements of every enclosing scope run with the unit.
  const extra = [];
  const file = item.file;
  let scopeItems = item.parent ? item.parent.children : file.top;
  let parent = item.parent;
  for (;;) {
    for (const sibling of scopeItems) {
      if (sibling.kind === 'hook' || sibling.kind === 'effect') extra.push(sibling);
    }
    if (!parent) break;
    extra.push(parent);
    scopeItems = parent.parent ? parent.parent.children : file.top;
    parent = parent.parent;
  }
  return extra;
}

function closure(analyzer, roots) {
  const seen = new Set();
  const queue = [...roots];
  const merged = { privates: [], sourceText: [], mocks: [], identity: [], items: seen };
  while (queue.length > 0) {
    const item = queue.shift();
    if (seen.has(item)) continue;
    seen.add(item);
    const facts = analyzer.factsOf(item);
    merged.privates.push(...facts.privates);
    merged.sourceText.push(...facts.sourceText);
    merged.mocks.push(...facts.mocks);
    merged.identity.push(...facts.identity);
    for (const dep of facts.deps) queue.push(dep);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Emission

function importForms(importDecl) {
  const clause = importDecl.importClause;
  const forms = [];
  if (!clause) return forms;
  if (clause.name)
    forms.push({
      kind: 'default',
      decl: clause,
      local: clause.name.text,
      typeOnly: clause.isTypeOnly,
    });
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    forms.push({
      kind: 'namespace',
      decl: bindings,
      local: bindings.name.text,
      typeOnly: clause.isTypeOnly,
    });
  } else if (bindings) {
    for (const element of bindings.elements) {
      forms.push({
        kind: 'named',
        decl: element,
        local: element.name.text,
        imported: (element.propertyName ?? element.name).text,
        typeOnly: clause.isTypeOnly || element.isTypeOnly,
      });
    }
  }
  return forms;
}

function renderImports(groups) {
  const lines = [];
  for (const module of [...groups.keys()].sort()) {
    const group = groups.get(module);
    for (const d of group.defaults)
      lines.push(`import ${d.typeOnly ? 'type ' : ''}${d.local} from '${module}';`);
    for (const n of group.namespaces)
      lines.push(`import ${n.typeOnly ? 'type ' : ''}* as ${n.local} from '${module}';`);
    const named = [...group.named.values()].sort((a, b) => a.local.localeCompare(b.local));
    if (named.length > 0) {
      const allType = named.every((n) => n.typeOnly);
      const parts = named.map((n) => {
        const name = n.imported === n.local ? n.local : `${n.imported} as ${n.local}`;
        return allType || !n.typeOnly ? name : `type ${name}`;
      });
      lines.push(`import ${allType ? 'type ' : ''}{ ${parts.join(', ')} } from '${module}';`);
    }
  }
  return lines.join('\n');
}

function groupFor(groups, module) {
  if (!groups.has(module)) groups.set(module, { defaults: [], namespaces: [], named: new Map() });
  return groups.get(module);
}

/** The public module and name a src binding is reachable under. */
function publicTarget(ctx, form, spec, fromFile) {
  const { checker, surface } = ctx;
  if (spec.startsWith(ROOT_MODULE)) return { module: spec, name: form.imported };
  const abs = path.resolve(path.dirname(fromFile), spec).replace(/\.js$/, '.ts');
  const relSrc = path.relative(SRC, abs).split(path.sep);
  const layer = LAYERS.includes(relSrc[0]) ? relSrc[0] : null;
  if (form.kind === 'namespace') {
    if (relSrc.join('/') === 'index.ts') return { module: ROOT_MODULE };
    if (layer && relSrc.length === 2 && relSrc[1] === 'index.ts')
      return { module: `${ROOT_MODULE}/${layer}` };
    return { module: layer ? `${ROOT_MODULE}/${layer}` : ROOT_MODULE };
  }
  const symbol = checker.getSymbolAtLocation(form.decl.name);
  const resolved = resolveAlias(checker, symbol);
  const homes = surface.get(resolved);
  if (!homes) return null;
  const preferred =
    relSrc.join('/') === 'index.ts' ? ROOT_MODULE : layer ? `${ROOT_MODULE}/${layer}` : ROOT_MODULE;
  if (homes.has(preferred)) return { module: preferred, name: homes.get(preferred) };
  if (homes.has(ROOT_MODULE)) return { module: ROOT_MODULE, name: homes.get(ROOT_MODULE) };
  const [module, name] = [...homes.entries()][0];
  return { module, name };
}

/** Text of `sf` with the given ranges replaced, ranges sorted and disjoint. */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) throw new Error('overlapping edits');
    out += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}

/** Leading comment text of a statement (between its full start and its start), trimmed of blank edges. */
function leadingComments(node, sf) {
  const text = sf.text.slice(node.getFullStart(), node.getStart(sf));
  return text.trim().length > 0 ? text.replace(/^\s*\n/, '') : '';
}

function emitFile(ctx, file, side, keep, usedForms, options) {
  const sf = file.sf;
  const edits = [];
  const imports = file.top.filter((i) => i.kind === 'import');
  const dropItem = (item) =>
    edits.push({ start: item.node.getFullStart(), end: item.node.getEnd(), text: '' });

  const walk = (items) => {
    for (const item of items) {
      if (item.kind === 'import') continue;
      if (!keep.has(item)) {
        dropItem(item);
        continue;
      }
      if (item.kind === 'container') walk(item.children);
      if (side === 'spec') {
        const facts = ctx.analyzer.factsOf(item);
        for (const rewrite of facts.moduleRewrites) {
          edits.push({
            start: rewrite.node.getStart(sf),
            end: rewrite.node.getEnd(),
            text: `'${rewrite.module}'`,
          });
        }
        if (
          !file.isSupport &&
          !(options.replace && item.kind === 'decl' && item.names.some((n) => options.replace[n]))
        ) {
          for (const literal of facts.pathLiterals) {
            const target = path.resolve(path.dirname(sf.fileName), literal.text);
            const moved = path
              .relative(path.dirname(path.join(SPEC, file.rel)), target)
              .split(path.sep)
              .join('/');
            edits.push({
              start: literal.getStart(sf),
              end: literal.getEnd(),
              text: `'${moved.startsWith('.') ? moved : `./${moved}`}'`,
            });
          }
        }
      }
      if (item.kind === 'decl' && options.replace && item.names.some((n) => options.replace[n])) {
        const name = item.names.find((n) => options.replace[n]);
        edits.push({
          start: item.node.getStart(sf),
          end: item.node.getEnd(),
          text: options.replace[name],
        });
      }
    }
  };
  walk(file.top);

  if (side === 'ts') {
    for (const item of imports) {
      const forms = importForms(item.node);
      const used = forms.filter((f) => usedForms.has(f.decl));
      if (!item.node.importClause || used.length === forms.length) continue;
      if (used.length === 0) {
        const comments = item === imports[0] ? leadingComments(item.node, sf) : '';
        edits.push({
          start: item.node.getFullStart(),
          end: item.node.getEnd(),
          text: comments ? `${comments}` : '',
        });
        continue;
      }
      const groups = new Map();
      const group = groupFor(groups, item.node.moduleSpecifier.text);
      for (const form of used)
        addForm(group, { ...form, typeOnly: form.typeOnly || !usedForms.get(form.decl).value });
      edits.push({
        start: item.node.getStart(sf),
        end: item.node.getEnd(),
        text: renderImports(groups),
      });
    }
  } else {
    const groups = new Map();
    for (const item of imports) {
      const spec = item.node.moduleSpecifier.text;
      if (!item.node.importClause) {
        groupFor(groups, spec);
        continue;
      }
      for (const form of importForms(item.node)) {
        const use = usedForms.get(form.decl);
        if (!use) continue;
        const typeOnly = form.typeOnly || !use.value;
        if (
          spec.startsWith(ROOT_MODULE) ||
          (spec.startsWith('.') &&
            path.resolve(path.dirname(sf.fileName), spec).startsWith(`${SRC}${path.sep}`))
        ) {
          const target = publicTarget(ctx, form, spec, sf.fileName);
          if (!target)
            throw new Error(`${file.rel}: no public home for ${form.local} from ${spec}`);
          const group = groupFor(groups, target.module);
          addForm(group, { ...form, imported: target.name ?? form.imported, typeOnly });
        } else {
          addForm(groupFor(groups, spec), { ...form, typeOnly });
        }
      }
    }
    for (const extra of options.imports ?? []) {
      addForm(groupFor(groups, extra.module), {
        kind: 'named',
        decl: extra,
        local: extra.name,
        imported: extra.name,
        typeOnly: false,
      });
    }
    if (imports.length > 0) {
      const first = imports[0].node;
      edits.push({ start: first.getStart(sf), end: first.getEnd(), text: renderImports(groups) });
      for (const item of imports.slice(1))
        edits.push({ start: item.node.getFullStart(), end: item.node.getEnd(), text: '' });
    }
  }
  let text = applyEdits(sf.text, edits);
  for (const [from, to] of options.patches ?? []) {
    if (!text.includes(from)) throw new Error(`${file.rel}: patch target not found: ${from}`);
    text = text.replace(from, to);
  }
  return text;
}

function addForm(group, form) {
  if (form.kind === 'default') group.defaults.push(form);
  else if (form.kind === 'namespace') group.namespaces.push(form);
  else {
    const key = `${form.imported} as ${form.local}`;
    const existing = group.named.get(key);
    group.named.set(
      key,
      existing ? { ...existing, typeOnly: existing.typeOnly && form.typeOnly } : form,
    );
  }
}

// ---------------------------------------------------------------------------
// Main

function readIdentityExceptions() {
  if (!existsSync(ANNOTATIONS)) return { present: false, list: new Set() };
  const data = JSON.parse(readFileSync(ANNOTATIONS, 'utf8'));
  const raw = data.identity_exceptions ?? data.identityExceptions ?? [];
  return { present: true, list: new Set(raw.map((e) => (typeof e === 'string' ? e : e.at))) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tree = loadTree(args.from);
  const { program, testFiles } = createProgram(tree);
  const checker = program.getTypeChecker();
  const surface = publicSurface(program, checker);
  const exceptions = readIdentityExceptions();
  const relTest = (file) => path.relative(PKG, file).split(path.sep).join('/');

  const files = new Map();
  for (const fileName of testFiles) {
    const sf = program.getSourceFile(fileName);
    const rel = path.relative(TEST, fileName).split(path.sep).join('/');
    const isSupport = !rel.endsWith('.test.ts');
    const built = buildItems(sf, isSupport);
    const file = { sf, rel, isSupport, ...built };
    for (const item of built.items) item.file = file;
    files.set(fileName, file);
  }
  const ctx = { checker, surface, files, relTest };
  const analyzer = createAnalyzer(ctx);
  ctx.analyzer = analyzer;

  const report = { files: {}, identityCandidates: [], warnings: [] };
  const sideOf = new Map();
  const unitClosures = new Map();
  let totalExpects = 0;
  let tsExpects = 0;

  const testFileList = [...files.values()]
    .filter((f) => !f.isSupport && f.rel.endsWith('.test.ts'))
    .sort((a, b) => a.rel.localeCompare(b.rel));
  for (const file of testFileList) {
    const units = file.items.filter((i) => i.kind === 'unit');
    if (units.length === 0) report.warnings.push(`${file.rel}: no units`);
    for (const unit of units) {
      const result = closure(analyzer, [unit, ...ancestorsScopeItems(unit)]);
      unitClosures.set(unit, result);
      const reasons = [];
      const privateValues = result.privates.filter((p) => !p.typeOnly);
      const privateTypes = result.privates.filter((p) => p.typeOnly);
      if (privateValues.length > 0)
        reasons.push(`private:${uniq(privateValues.map((p) => p.name)).join(',')}`);
      if (privateTypes.length > 0)
        reasons.push(`private-type:${uniq(privateTypes.map((p) => p.name)).join(',')}`);
      if (result.sourceText.length > 0)
        reasons.push(`source-text:${uniq(result.sourceText).join(',')}`);
      if (result.mocks.length > 0) reasons.push(`mock:${uniq(result.mocks).join(',')}`);
      const identity = result.identity.filter((i) => !exceptions.list.has(i.at));
      if (identity.length > 0)
        reasons.push(`identity:${uniq(identity.map((i) => i.at)).join(',')}`);
      unit.reasons = reasons;
      unit.expects = analyzer.factsOf(unit).expects;
      sideOf.set(unit, reasons.length > 0 ? 'ts' : 'spec');
      totalExpects += unit.expects;
      if (reasons.length > 0) tsExpects += unit.expects;
      for (const i of result.identity)
        report.identityCandidates.push({
          ...i,
          onlyReason: reasons.length === 1 && reasons[0].startsWith('identity:'),
        });
    }
  }

  // Keep sets per side.
  const referenced = new Set();
  for (const result of unitClosures.values()) for (const item of result.items) referenced.add(item);
  for (const file of files.values()) {
    for (const item of file.items) {
      if (item.kind === 'decl' && analyzer.factsOf(item).generatesTests) {
        report.warnings.push(`${file.rel}: declaration ${item.names.join(',')} defines tests`);
      }
    }
  }
  const outputs = [];
  const usedSupport = { spec: new Set(SPEC_SUPPORT_ALWAYS), ts: new Set() };
  for (const file of testFileList) {
    const units = file.items.filter((i) => i.kind === 'unit');
    const entry = {
      units: units.length,
      expects: units.reduce((s, u) => s + u.expects, 0),
      specUnits: 0,
      specExpects: 0,
      tsUnits: 0,
      tsExpects: 0,
      tsReasons: {},
      tsOnly: [],
    };
    for (const unit of units) {
      if (sideOf.get(unit) === 'spec') {
        entry.specUnits += 1;
        entry.specExpects += unit.expects;
      } else {
        entry.tsUnits += 1;
        entry.tsExpects += unit.expects;
        for (const reason of unit.reasons) {
          const criterion = reason.split(':')[0];
          entry.tsReasons[criterion] = (entry.tsReasons[criterion] ?? 0) + 1;
        }
        const line = file.sf.getLineAndCharacterOfPosition(unit.node.getStart(file.sf)).line + 1;
        entry.tsOnly.push({ line, title: testTitle(unit.node, file.sf), reasons: unit.reasons });
      }
    }
    report.files[file.rel] = entry;

    for (const side of ['spec', 'ts']) {
      const sideUnits = units.filter((u) => sideOf.get(u) === side);
      if (sideUnits.length === 0) continue;
      const keep = new Set();
      const supportItems = new Set();
      for (const unit of sideUnits) {
        for (const item of unitClosures.get(unit).items) {
          if (item.file === file) keep.add(item);
          else supportItems.add(item);
        }
        for (let p = unit.parent; p; p = p.parent) keep.add(p);
      }
      for (const item of supportItems) usedSupport[side].add(item.file.rel);
      // Declarations nothing references stay with the TS side, or with the spec side when it is alone.
      const owner = units.some((u) => sideOf.get(u) === 'ts') ? 'ts' : 'spec';
      if (side === owner) {
        for (const item of file.items) {
          if (item.kind !== 'decl' || referenced.has(item)) continue;
          if (item.parent && !keep.has(item.parent)) continue;
          keep.add(item);
          report.warnings.push(
            `${file.rel}: unreferenced declaration ${item.names.join(',')} kept on ${side}`,
          );
        }
      }
      // Bindings referenced by kept items.
      const usedForms = new Map();
      for (const item of keep) {
        const facts = analyzer.factsOf(item);
        for (const binding of facts.bindings.values()) {
          const prior = usedForms.get(binding.decl);
          usedForms.set(binding.decl, { value: (prior?.value ?? false) || binding.value });
        }
      }
      const golden = side === 'spec' ? GOLDEN_IO[file.rel] : { patches: TS_PATCHES[file.rel] };
      if (side === 'spec' && golden) {
        // The replaced path declaration no longer reads the support module.
        for (const [decl] of usedForms) {
          if (ts.isImportSpecifier(decl) && decl.name.text === 'PACKAGE_ROOT')
            usedForms.delete(decl);
        }
      }
      const text = emitFile(ctx, file, side, keep, usedForms, golden ?? {});
      outputs.push({
        side,
        rel: file.rel,
        text,
        whole: sideUnits.length === units.length && !(side === 'ts' && TS_PATCHES[file.rel]),
      });
    }
  }

  // Support: spec copies and TS remainders, closed over support-to-support imports.
  const supportFiles = [...files.values()].filter((f) => f.isSupport);
  for (const side of ['spec', 'ts']) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const rel of [...usedSupport[side]]) {
        const file = supportFiles.find((f) => f.rel === rel);
        for (const item of file.top.filter((i) => i.kind === 'import')) {
          const spec = item.node.moduleSpecifier.text;
          if (!spec.startsWith('.')) continue;
          const target = path.relative(
            TEST,
            path.resolve(path.dirname(file.sf.fileName), spec).replace(/\.js$/, '.ts'),
          );
          if (target.startsWith('support/') && !usedSupport[side].has(target)) {
            usedSupport[side].add(target);
            grew = true;
          }
        }
      }
    }
  }
  // TS-side support is whatever the remaining TS files import.
  for (const output of outputs.filter((o) => o.side === 'ts')) {
    for (const match of output.text.matchAll(/from '\.\/(support\/[^']+)\.js'/g))
      usedSupport.ts.add(`${match[1]}.ts`);
  }
  for (const rel of [...usedSupport.ts]) {
    const file = supportFiles.find((f) => f.rel === rel);
    for (const match of file.sf.text.matchAll(/from '\.\/([^']+)\.js'/g))
      usedSupport.ts.add(`support/${match[1]}.ts`);
  }

  for (const file of supportFiles) {
    if (usedSupport.spec.has(file.rel)) {
      const keep = new Set(file.items.filter((i) => i.kind !== 'import'));
      const usedForms = new Map();
      for (const item of keep) {
        const facts = analyzer.factsOf(item);
        for (const p of facts.privates)
          throw new Error(`${file.rel}: spec copy references private ${p.name}`);
        for (const binding of facts.bindings.values()) {
          const prior = usedForms.get(binding.decl);
          usedForms.set(binding.decl, { value: (prior?.value ?? false) || binding.value });
        }
      }
      const text = emitFile(ctx, file, 'spec', keep, usedForms, {
        patches: SUPPORT_PATCHES[file.rel],
      });
      outputs.push({ side: 'spec', rel: file.rel, text, whole: !usedSupport.ts.has(file.rel) });
    }
    if (usedSupport.ts.has(file.rel)) {
      let text = file.sf.text;
      for (const [from, to] of TS_PATCHES[file.rel] ?? []) {
        if (!text.includes(from)) throw new Error(`${file.rel}: patch target not found: ${from}`);
        text = text.replace(from, to);
      }
      outputs.push({ side: 'ts', rel: file.rel, text, whole: !TS_PATCHES[file.rel] });
    }
  }

  // Golden data.
  const goldenFiles = [...tree.files.keys()].filter((f) =>
    f.startsWith(path.join(TEST, 'golden') + path.sep),
  );
  const tsUsesGolden = outputs.some(
    (o) => o.side === 'ts' && /golden/.test(o.text) && o.rel.endsWith('.test.ts'),
  );

  const unitCount = { spec: 0, ts: 0 };
  for (const entry of Object.values(report.files)) {
    unitCount.spec += entry.specUnits;
    unitCount.ts += entry.tsUnits;
  }
  const ratio = totalExpects === 0 ? 0 : tsExpects / totalExpects;
  const candidatesAt = () => report.identityCandidates.filter((c) => c.onlyReason).map((c) => c.at);
  const manifest = {
    base: tree.sha,
    identityExceptions: {
      source: exceptions.present ? 'api/annotations.json' : 'none',
      entries: [...exceptions.list].sort(),
      // Assertions whose identity check is the only thing keeping their unit TS-only.
      candidates: uniq(candidatesAt()),
    },
    expectCounting:
      'expect() calls written inside each unit; helper and hook bodies are not attributed',
    totals: {
      files: testFileList.length,
      units: unitCount.spec + unitCount.ts,
      specUnits: unitCount.spec,
      tsUnits: unitCount.ts,
      expects: totalExpects,
      tsExpects,
      tsExpectRatio: Number(ratio.toFixed(4)),
      specFiles: new Set(
        outputs.filter((o) => o.side === 'spec' && o.rel.endsWith('.test.ts')).map((o) => o.rel),
      ).size,
      tsFiles: new Set(
        outputs.filter((o) => o.side === 'ts' && o.rel.endsWith('.test.ts')).map((o) => o.rel),
      ).size,
    },
    files: report.files,
  };
  if (ratio > 0.1) {
    const top = Object.entries(report.files)
      .filter(([, e]) => e.tsExpects > 0)
      .sort((a, b) => b[1].tsExpects - a[1].tsExpects || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([file, e]) => ({ file, tsExpects: e.tsExpects, criteria: e.tsReasons }));
    manifest.overThreshold = { threshold: 0.1, top };
  }

  const candidates = report.identityCandidates.filter((c) => c.onlyReason);
  log(`spec: ${manifest.totals.specFiles} files, ${unitCount.spec} units`);
  log(`ts:   ${manifest.totals.tsFiles} files, ${unitCount.ts} units`);
  log(`ts-only expect ratio: ${tsExpects}/${totalExpects} = ${(ratio * 100).toFixed(2)}%`);
  log(
    `identity exceptions read: ${exceptions.present ? exceptions.list.size : 'none (api/annotations.json absent)'}`,
  );
  log(
    `units ts-only by identity alone (exception candidates): ${uniq(candidates.map((c) => c.at)).length}`,
  );
  for (const c of uniq(candidates.map((c) => `${c.at}  ${c.text}`))) log(`  ${c}`);
  for (const w of report.warnings) log(`warning: ${w}`);
  if (args.dry) {
    if (args.manifestOut) writeFileSync(args.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  // Write.
  for (const output of outputs.filter((o) => o.side === 'ts')) {
    writeFileSync(path.join(TEST, output.rel), output.text);
  }
  for (const output of outputs.filter((o) => o.side === 'spec')) {
    const target = path.join(SPEC, output.rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, output.text);
  }
  const tsKept = new Set(outputs.filter((o) => o.side === 'ts').map((o) => o.rel));
  for (const fileName of testFiles) {
    const rel = path.relative(TEST, fileName).split(path.sep).join('/');
    if (!tsKept.has(rel)) rmSync(fileName, { force: true });
  }
  for (const golden of goldenFiles) {
    const rel = path.relative(TEST, golden);
    const target = path.join(SPEC, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, tree.files.get(golden));
    if (!tsUsesGolden) rmSync(golden, { force: true });
  }
  rmSync(path.join(TEST, 'generated'), { recursive: true, force: true });
  if (!tsUsesGolden) rmSync(path.join(TEST, 'golden'), { recursive: true, force: true });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  // Format what was written: imports were regenerated and must be sorted and wrapped.
  const written = [
    ...outputs.filter((o) => o.side === 'spec').map((o) => path.join(SPEC, o.rel)),
    ...outputs.filter((o) => o.side === 'ts' && !o.whole).map((o) => path.join(TEST, o.rel)),
    MANIFEST,
  ];
  execFileSync(
    path.join(REPO, 'node_modules/.bin/biome'),
    ['check', '--write', '--no-errors-on-unmatched', ...written],
    {
      cwd: REPO,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
}

/** One line of the summary on stdout. */
function log(line) {
  process.stdout.write(`${line}\n`);
}

function uniq(values) {
  return [...new Set(values)].sort();
}

main();
