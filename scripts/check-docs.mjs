import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const allowedRepoRootMd = new Set(['README.md', 'AGENTS.md']);
const allowedDocsRootMd = new Set([
  'README.md',
  'status.md',
  'scenarios.md',
  'runbook.md',
  'glossary.md',
  'history.md',
]);
const requiredDocs = [
  'AGENTS.md',
  'README.md',
  'docs/README.md',
  'docs/status.md',
  'docs/scenarios.md',
  'docs/runbook.md',
  'docs/glossary.md',
  'docs/history.md',
  'docs/plans/roadmap.md',
  'docs/archive/README.md',
  'docs/learnings/README.md',
];
const lineBudgets = {
  'AGENTS.md': { min: 1, max: 30 },
  'README.md': { min: 25, max: 180 },
  'docs/status.md': { min: 1, max: 100 },
  'docs/scenarios.md': { min: 1, max: 100 },
  'docs/runbook.md': { min: 1, max: 120 },
  'docs/glossary.md': { min: 1, max: 60 },
};

const toPosix = (value) => value.split(sep).join('/');
const countLines = (text) => (text === '' ? 0 : text.replace(/\r?\n$/, '').split(/\r?\n/).length);

function safeStat(path) {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error(`拒绝符号链接（symlink）：${path}`);
    return info;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function walkFiles(dir, predicate, out = []) {
  if (!safeStat(dir)?.isDirectory()) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`拒绝符号链接（symlink）：${full}`);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function stripFences(text) {
  let fence;
  return text.split(/\r?\n/).map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : line;
  });
}

function stripInlineCode(line) {
  return line.replace(/(`+)[\s\S]*?\1/g, '');
}

function headingIds(lines) {
  const counts = new Map();
  const ids = new Set();
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/<a\b[^>]*\b(?:name|id)\s*=\s*["']([^"']+)["']/gi)) {
      ids.add(match[1]);
    }
    const heading =
      line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/)?.[1] ??
      (/^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '') ? line.trim() : '');
    if (!heading) return;
    const cleaned = heading
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '');
    const slug = cleaned
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    ids.add(count ? `${slug}-${count}` : slug);
  });
  return ids;
}

function extractLinks(lines, report) {
  const definitions = new Map();
  const visible = lines.map((line) => (/^(?: {4}|\t)/.test(line) ? '' : stripInlineCode(line)));
  const normalize = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const line of visible) {
    const match = line.match(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
    if (match) definitions.set(normalize(match[1]), match[2] ?? match[3]);
  }
  const links = [];
  visible.forEach((line, index) => {
    if (/^ {0,3}\[[^\]]+\]:/.test(line)) return;
    const inline =
      /!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|((?:\\.|[^\s()\\]|\([^()]*\))+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
    const remaining = line.replace(inline, (_match, angle, bare) => {
      links.push({ target: angle ?? bare, line: index + 1 });
      return '';
    });
    for (const match of remaining.matchAll(/!?\[([^\]]+)\](?:\[([^\]]*)\])?/g)) {
      const label = normalize(match[2] || match[1]);
      if (definitions.has(label)) links.push({ target: definitions.get(label), line: index + 1 });
      else if (match[2] !== undefined) report(index + 1, `未定义的引用链接: ${label}`);
    }
  });
  return links;
}

function checkLayout(root, errors) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
    if (!allowedRepoRootMd.has(entry.name)) {
      errors.push(
        `${entry.name}: 禁止在仓库根目录新增文档。请写入 docs/ 对应活文档、docs/archive/ 或 docs/learnings/YYYY-MM/。`,
      );
    }
  }
  for (const rel of requiredDocs) {
    if (!safeStat(join(root, rel))?.isFile()) errors.push(`缺少必要文档: ${rel}`);
  }
  const docsDir = join(root, 'docs');
  if (!safeStat(docsDir)?.isDirectory()) return;
  for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md') && !allowedDocsRootMd.has(entry.name)) {
      errors.push(
        `docs/${entry.name}: 禁止在 docs/ 根目录随手堆放文档。历史说明请迁入 docs/archive/，经验写入 docs/learnings/YYYY-MM/。`,
      );
    }
  }
  for (const file of walkFiles(docsDir, (f) => f.endsWith('.md'))) {
    const rel = toPosix(relative(root, file));
    const ok =
      /^docs\/(?:README|status|scenarios|runbook|glossary|history)\.md$/.test(rel) ||
      /^docs\/plans\/[^/]+\.md$/.test(rel) ||
      /^docs\/archive\/(?:README\.md|.+\.md)$/.test(rel) ||
      /^docs\/learnings\/(?:README\.md|\d{4}-\d{2}\/[^/]+\.md)$/.test(rel);
    if (!ok) {
      errors.push(
        `${rel}: 文档位于未登记目录结构。请放入 docs/plans/、docs/archive/、docs/learnings/YYYY-MM/ 或 .tmp/scratch/<任务名>/。`,
      );
    }
  }
}

function checkBudgets(root, errors) {
  for (const [rel, { min, max }] of Object.entries(lineBudgets)) {
    const full = join(root, rel);
    if (!safeStat(full)?.isFile()) continue;
    const lines = countLines(readFileSync(full, 'utf8'));
    if (lines < min || lines > max) {
      errors.push(
        `${rel}: 行数 ${lines} 超出约定区间 [${min}, ${max}]。活文档只保留结论与链接，长流水请拆入 docs/archive/。`,
      );
    }
  }
}

function validateFragment(root, destination, fragment, ids, lineCountCache) {
  const lineMatch = fragment.match(/^L(\d+)(?:-L?(\d+))?$/);
  if (lineMatch) {
    const full = join(root, destination);
    if (!safeStat(full)?.isFile()) return false;
    let total = lineCountCache.get(destination);
    if (total === undefined) {
      total = countLines(readFileSync(full, 'utf8'));
      lineCountCache.set(destination, total);
    }
    const start = Number(lineMatch[1]);
    const end = lineMatch[2] ? Number(lineMatch[2]) : start;
    return start >= 1 && start <= end && end <= total;
  }
  if (!ids.has(destination)) return true;
  return ids.get(destination).has(fragment) || ids.get(destination).has(fragment.toLowerCase());
}

function validateLinks(root, errors) {
  const allMd = [
    ...['README.md', 'AGENTS.md']
      .filter((f) => safeStat(join(root, f))?.isFile())
      .map((f) => join(root, f)),
    ...walkFiles(join(root, 'docs'), (f) => f.endsWith('.md')),
  ];
  const stripped = new Map();
  const ids = new Map();
  const lineCounts = new Map();

  for (const full of allMd) {
    const rel = toPosix(relative(root, full));
    const raw = readFileSync(full, 'utf8');
    const lines = stripFences(raw);
    stripped.set(rel, lines);
    ids.set(rel, headingIds(lines));
    lineCounts.set(rel, countLines(raw));
  }

  const edges = new Map();
  let localLinks = 0;

  for (const [source, lines] of stripped) {
    const targets = new Set();
    const report = (line, msg) => errors.push(`${source}:${line}: ${msg}`);
    for (const { target, line } of extractLinks(lines, report)) {
      if (/^(?:https?:|mailto:)/i.test(target)) continue;
      if (/^(?:[A-Za-z]:|file:)/i.test(target)) {
        report(line, `禁止在文档中使用本机绝对路径链接: ${target}。请改用仓库相对链接。`);
        continue;
      }
      localLinks += 1;
      const [rawFile, ...fragmentParts] = target.split('#');
      let filePart;
      let fragment;
      try {
        filePart = decodeURIComponent(rawFile.split('?')[0]).replace(/\\([\\ ()])/g, '$1');
        fragment = decodeURIComponent(fragmentParts.join('#'));
      } catch {
        report(line, `链接编码无效: ${target}`);
        continue;
      }
      const absTarget = filePart
        ? resolve(
            root,
            filePart.startsWith('/') ? '.' : dirname(join(root, source)),
            filePart.replace(/^\//, ''),
          )
        : join(root, source);
      const relTarget = relative(root, absTarget);
      if (relTarget === '..' || relTarget.startsWith(`..${sep}`) || isAbsolute(relTarget)) {
        report(line, `本地链接超出仓库范围: ${target}`);
        continue;
      }
      const destPosix = toPosix(relTarget);
      if (/^(?:\.tmp|data|dist)(?:\/|$)/.test(destPosix)) {
        report(line, `禁止链接被忽略的本地目录（.tmp/、data/、dist/）: ${target}`);
        continue;
      }
      const stat = safeStat(absTarget);
      if (!stat) {
        report(line, `链接目标不存在: ${target}`);
        continue;
      }
      let resolvedDest = destPosix;
      if (stat.isDirectory()) {
        const indexCandidate = ['README.md', 'index.md']
          .map((n) => join(absTarget, n))
          .find((p) => safeStat(p)?.isFile());
        if (indexCandidate) resolvedDest = toPosix(relative(root, indexCandidate));
        else if (fragment) {
          report(line, `目录链接不支持锚点片段: ${target}`);
          continue;
        }
      }
      targets.add(resolvedDest);
      if (fragment && !validateFragment(root, resolvedDest, fragment, ids, lineCounts)) {
        report(line, `链接锚点不存在: ${target}`);
      }
    }
    edges.set(source, targets);
  }
  return { markdownFiles: stripped.size, localLinks, edges };
}

function checkIndexCoverage(root, edges, errors) {
  const mustBeInDocsIndex = [
    'docs/status.md',
    'docs/scenarios.md',
    'docs/runbook.md',
    'docs/glossary.md',
    'docs/history.md',
    'docs/archive/README.md',
    'docs/learnings/README.md',
    ...walkFiles(join(root, 'docs/plans'), (f) => f.endsWith('.md')).map((f) =>
      toPosix(relative(root, f)),
    ),
  ];
  const docsEdges = edges.get('docs/README.md') ?? new Set();
  for (const item of mustBeInDocsIndex) {
    if (!docsEdges.has(item)) errors.push(`${item}: 未收录到 docs/README.md 总索引。`);
  }

  for (const [indexRel, dirRel] of [
    ['docs/learnings/README.md', 'docs/learnings'],
    ['docs/archive/README.md', 'docs/archive'],
  ]) {
    const idxEdges = edges.get(indexRel) ?? new Set();
    for (const full of walkFiles(join(root, dirRel), (f) => f.endsWith('.md'))) {
      const rel = toPosix(relative(root, full));
      if (rel === indexRel) continue;
      if (!idxEdges.has(rel)) errors.push(`${rel}: 未登记到 ${indexRel}。`);
    }
  }
}

export function checkDocs(root = defaultRoot) {
  const absRoot = resolve(root);
  const errors = [];
  checkLayout(absRoot, errors);
  checkBudgets(absRoot, errors);
  const { markdownFiles, localLinks, edges } = validateLinks(absRoot, errors);
  checkIndexCoverage(absRoot, edges, errors);
  if (errors.length > 0) {
    throw new Error(`文档门禁检查未通过（${errors.length} 项）：\n${errors.join('\n')}`);
  }
  return { markdownFiles, localLinks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDocs(defaultRoot);
  console.log(`Docs OK (${result.markdownFiles} markdown files, ${result.localLinks} local links)`);
}
