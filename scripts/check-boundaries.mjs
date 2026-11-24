import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs']);
const toPosix = (value) => value.split(sep).join('/');

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

function collectSpecifiers(filePath, sourceText) {
  const kind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : filePath.endsWith('.ts') || filePath.endsWith('.mts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind);
  const items = [];
  const add = (node) => items.push(node && ts.isStringLiteralLike(node) ? node.text : null);

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)) {
      add(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return items;
}

function isInside(parentDir, targetPath) {
  const rel = relative(parentDir, targetPath);
  return !isAbsolute(rel) && rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`);
}

export function checkBoundaries(root = defaultRoot) {
  const absRoot = resolve(root);
  const layers = [
    { name: 'engine', dir: join(absRoot, 'packages', 'engine', 'src') },
    { name: 'server', dir: join(absRoot, 'apps', 'server', 'src') },
    { name: 'web', dir: join(absRoot, 'apps', 'web', 'src') },
  ];

  const errors = [];
  let checkedFiles = 0;

  for (const layer of layers) {
    for (const file of walkCodeFiles(layer.dir)) {
      checkedFiles += 1;
      const relFile = toPosix(relative(absRoot, file));
      const specifiers = collectSpecifiers(file, readFileSync(file, 'utf8'));

      for (const spec of specifiers) {
        if (!spec) {
          errors.push(`${relFile}: 禁止动态计算导入路径（computed import）。`);
          continue;
        }
        const webAlias = layer.name === 'web' && spec.startsWith('@/');
        if (webAlias || spec.startsWith('.') || isAbsolute(spec) || spec.startsWith('file:')) {
          const pathname = spec.split(/[?#]/, 1)[0];
          const target = pathname.startsWith('file:')
            ? fileURLToPath(pathname)
            : pathname.startsWith('/')
              ? resolve(absRoot, pathname.slice(1))
              : webAlias
                ? resolve(layer.dir, pathname.slice(2))
                : resolve(dirname(file), pathname);
          if (!isInside(layer.dir, target)) {
            errors.push(
              `${relFile}: 相对导入 "${spec}" 越出 ${layer.name} 源码边界；跨层请通过工作区包名导入。`,
            );
          } else if (
            layer.name === 'engine' &&
            target.replace(/\.(?:ts|js)$/, '') === join(layer.dir, 'models')
          ) {
            errors.push(
              `${relFile}: 模型网关只能经服务端专用子路径导入，禁止在引擎内部引用或重导出 "${spec}"。`,
            );
          }
          continue;
        }

        if (layer.name === 'engine') {
          if (spec.startsWith('@earendil-works/pi-ai')) {
            if (relFile !== 'packages/engine/src/models.ts') {
              errors.push(`${relFile}: 仅 packages/engine/src/models.ts 允许导入 "${spec}"。`);
            }
            continue;
          }
          if (
            isBuiltin(spec) ||
            spec === 'react' ||
            spec.startsWith('react/') ||
            spec === 'react-dom' ||
            spec.startsWith('react-dom/') ||
            spec === 'hono' ||
            spec.startsWith('hono/') ||
            spec.startsWith('@hono/') ||
            spec === 'vite' ||
            spec.startsWith('@eduharness-studio/')
          ) {
            errors.push(
              `${relFile}: 纯引擎层 packages/engine 禁止依赖 "${spec}"（保持零 React/HTTP/SQLite/Node 耦合）。`,
            );
          }
        } else if (layer.name === 'server') {
          if (
            spec === 'react' ||
            spec.startsWith('react/') ||
            spec === 'react-dom' ||
            spec.startsWith('react-dom/') ||
            spec === 'vite' ||
            spec.startsWith('@vitejs/') ||
            spec.startsWith('@earendil-works/pi-ai') ||
            spec === '@eduharness-studio/web' ||
            spec.startsWith('@eduharness-studio/web/')
          ) {
            errors.push(
              `${relFile}: 服务端 apps/server 禁止导入 "${spec}"（前端与模型 SDK 必须隔离）。`,
            );
          }
        } else if (layer.name === 'web') {
          if (
            isBuiltin(spec) ||
            spec === 'hono' ||
            spec.startsWith('hono/') ||
            spec.startsWith('@hono/') ||
            spec.startsWith('@earendil-works/pi-ai') ||
            spec === '@eduharness-studio/server' ||
            spec.startsWith('@eduharness-studio/server/') ||
            spec.startsWith('@eduharness-studio/engine/')
          ) {
            errors.push(
              `${relFile}: 前端 apps/web 禁止导入 "${spec}"（禁止直接依赖服务端/Node/模型网关）。`,
            );
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`三层导入边界检查未通过（${errors.length} 项）：\n${errors.join('\n')}`);
  }
  return { checkedFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkBoundaries(defaultRoot);
  console.log(`Import boundaries OK (${result.checkedFiles} files)`);
}
