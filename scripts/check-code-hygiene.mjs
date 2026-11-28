import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs']);
const MAX_SOURCE_LINES = 360;

const ALLOWED_ROOT_FILES = new Set([
  '.env',
  '.env.example',
  '.env.local',
  '.git', // A linked Git worktree has a gitdir pointer file instead of a directory.
  '.gitattributes',
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'biome.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
]);

const ALLOWED_ROOT_DIRS = new Set([
  '.git',
  '.github',
  '.githooks',
  '.tmp',
  'apps',
  'data',
  'docs',
  'node_modules',
  'packages',
  'scripts',
  'test',
]);

const toPosix = (value) => value.split(sep).join('/');
const countLines = (text) => (text === '' ? 0 : text.replace(/\r?\n$/, '').split(/\r?\n/).length);

function walkCodeFiles(dir, out = []) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`拒绝符号链接（symlink）：${dir}`);
  if (!stat.isDirectory()) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`拒绝符号链接（symlink）：${full}`);
    if (entry.isDirectory()) walkCodeFiles(full, out);
    else if (CODE_EXTS.has(extname(full))) out.push(full);
  }
  return out;
}

function checkRootEntries(absRoot, errors) {
  for (const entry of readdirSync(absRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      errors.push(`${entry.name}: 仓库根目录禁止符号链接。`);
      continue;
    }
    if (entry.isDirectory()) {
      if (!ALLOWED_ROOT_DIRS.has(entry.name)) {
        errors.push(
          `${entry.name}/: 禁止在仓库根目录新增未登记目录。临时文件请放入 .tmp/scratch/<任务名>/。`,
        );
      }
      continue;
    }
    if (!ALLOWED_ROOT_FILES.has(entry.name)) {
      errors.push(
        `${entry.name}: 禁止在仓库根目录堆放野文件。草稿放 .tmp/scratch/<任务名>/，代码放入对应工作区。`,
      );
    }
  }
}

function checkTsSuppressionComments(relFile, text, errors) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/\/\/\s*@ts-(ignore|nocheck)\b|\/\*\s*@ts-(ignore|nocheck)\b/);
    if (match) {
      errors.push(
        `${relFile}:${index + 1}: 禁止使用 @ts-${match[1] ?? match[2]} 绕过类型检查，请从根因补齐类型。`,
      );
    }
  });
}

function checkExplicitAny(filePath, relFile, text, errors) {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx') && !filePath.endsWith('.mts')) {
    return;
  }
  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, kind);

  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      errors.push(
        `${relFile}:${line + 1}: 禁止使用显式 any（含 as any / : any），请改用具体类型或 unknown + 校验。`,
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
}

export function checkCodeHygiene(root = defaultRoot) {
  const absRoot = resolve(root);
  const errors = [];

  checkRootEntries(absRoot, errors);

  const scanDirs = [
    join(absRoot, 'packages', 'engine', 'src'),
    join(absRoot, 'apps', 'server', 'src'),
    join(absRoot, 'apps', 'web', 'src'),
    join(absRoot, 'scripts'),
  ];

  let checkedFiles = 0;
  for (const dir of scanDirs) {
    for (const file of walkCodeFiles(dir)) {
      checkedFiles += 1;
      const relFile = toPosix(relative(absRoot, file));
      const text = readFileSync(file, 'utf8');
      const lines = countLines(text);
      if (lines > MAX_SOURCE_LINES) {
        errors.push(
          `${relFile}: 行数 ${lines} 超过单文件上限 ${MAX_SOURCE_LINES} 行，请拆分为内聚子模块或组件。`,
        );
      }
      checkTsSuppressionComments(relFile, text, errors);
      checkExplicitAny(file, relFile, text, errors);
    }
  }

  if (errors.length > 0) {
    throw new Error(`代码卫生与防膨胀检查未通过（${errors.length} 项）：\n${errors.join('\n')}`);
  }
  return { checkedFiles, maxSourceLines: MAX_SOURCE_LINES };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkCodeHygiene(defaultRoot);
  console.log(
    `Code hygiene OK (${result.checkedFiles} files, max ${result.maxSourceLines} lines/file)`,
  );
}
