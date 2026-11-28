import { type CalcVerifyResult, calcVerify } from './calc-verify.js';
import { decimal, equationChains, mathText } from './teacher-equations.js';
import type { TeacherTurnOutput } from './teacher-semantics.js';
import type { TeacherCalculation } from './teacher-tools.js';

type Field = readonly [path: string, text: string | undefined];
type NumberResult = Extract<CalcVerifyResult, { ok: true }>;
function expressionKey(expression: string) {
  let key = expression.replace(/\s+/g, '').replaceAll('**', '^');
  while (key.startsWith('(') && key.endsWith(')')) {
    let depth = 0;
    const end = [...key].findIndex((char) => {
      depth += char === '(' ? 1 : char === ')' ? -1 : 0;
      return depth === 0;
    });
    if (end !== key.length - 1) break;
    key = key.slice(1, -1);
  }
  return key;
}
const short = (text: string) => (text.length <= 48 ? text : `${text.slice(0, 47)}…`);
const literal = /^(?:[+-])?\d*(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

function disagree(a: NumberResult, b: NumberResult, left: string, right: string) {
  if (!a.approximate && !b.approximate) return a.text !== b.text;
  // Approximate evaluations are not exact proofs. Accept rounding at the shown literal's precision.
  const rounding = (term: string) => {
    const match = literal.exec(expressionKey(term));
    return match ? 0.5 * 10 ** (Number(match[2] ?? 0) - (match[1]?.length ?? 0)) : 0;
  };
  const slack = Math.max(Math.abs(a.value), Math.abs(b.value)) * 1e-14;
  return Math.abs(a.value - b.value) > rounding(left) + rounding(right) + slack;
}

const signed = `[+-]?${decimal.source}`;
const edgeList = new RegExp(
  `边权[^\\d+.,;:()=\\-]{0,10}[:=]?\\s*(${signed}(?:\\s*[,、和与及]\\s*${signed})*)(?![\\d./%eE])`,
  'g',
);

function routeWeights(source: string) {
  const paths = [...source.matchAll(/\b[a-z]\w*(?:\s*→\s*[a-z]\w*){2,}/gi)];
  if (paths.length !== 1) return;
  const [route] = paths;
  const clause = source.slice(route.index + route[0].length).split(/[。;!?\n|]/, 1)[0];
  const weights = [...clause.matchAll(edgeList)].flatMap((match) =>
    match[1].split(/\s*[,、和与及]\s*/),
  );
  if (weights.length >= 2) return { route: expressionKey(route[0]), weights };
}

/** A thin brake for literal claims. Prose judgments (e.g. “90%→99% is tenfold”) belong to the judge. */
export function auditTeacherNumbers(
  scene: TeacherTurnOutput,
  calculations: readonly TeacherCalculation[],
) {
  const reasons = new Set<string>();
  const cache = new Map<string, CalcVerifyResult>();
  const calc = (expression: string) => {
    const cached = cache.get(expression);
    if (cached) return cached;
    const result = calcVerify({ expression, format: 'fraction' });
    cache.set(expression, result);
    return result;
  };
  const tool = new Map(
    calculations.map(({ expression, exactText }) => [expressionKey(expression), calc(exactText)]),
  );

  function review(fields: Field[], formulaPath?: string) {
    const reports: { path: string; route: string; weights: string[] }[] = [];
    const claims: { path: string; label?: string; value: string; observed: boolean }[] = [];
    const sums: string[] = [];
    for (const [path, text] of fields) {
      if (!text) continue;
      const formula = path === formulaPath;
      const source = mathText(text, path.endsWith('.content'));
      const weights = !formula && formulaPath && routeWeights(source);
      if (weights) {
        const canonical = weights.weights.map((weight) => {
          const result = calc(weight);
          return result.ok ? result.text : weight;
        });
        reports.push({ path, route: weights.route, weights: canonical });
      }
      for (const { label, terms } of equationChains(source, formula)) {
        const values = terms.map(calc);
        const observed = terms.map((term) => tool.get(expressionKey(term)));
        for (let i = 1; i < terms.length; i++) {
          const a = values[i - 1];
          const b = values[i];
          const expected = observed[i - 1];
          const reversed = observed[i];
          if (expected?.ok && b.ok && disagree(expected, b, terms[i - 1], terms[i])) {
            reasons.add(
              `numeric arithmetic at ${path}: calc_verify gives ${short(expected.text)}, not ${short(b.text)}`,
            );
          } else if (reversed?.ok && a.ok && disagree(a, reversed, terms[i - 1], terms[i])) {
            reasons.add(
              `numeric arithmetic at ${path}: calc_verify gives ${short(reversed.text)}, not ${short(a.text)}`,
            );
          } else if (a.ok && b.ok && disagree(a, b, terms[i - 1], terms[i])) {
            reasons.add(`numeric arithmetic at ${path}: ${short(a.text)}, not ${short(b.text)}`);
          } else if (a.ok !== b.ok) {
            const failure = !a.ok ? a.error : !b.ok ? b.error : undefined;
            if (failure?.code === 'division_by_zero' || failure?.code === 'domain_error') {
              reasons.add(`numeric arithmetic at ${path}: ${failure.message}`);
            }
          }
        }
        const first = values[0];
        if (
          first.ok &&
          !first.approximate &&
          values.every((value) => value.ok && !value.approximate && value.text === first.text)
        ) {
          claims.push({
            path,
            label,
            value: first.text,
            observed: observed.some((value) => value?.ok && value.text === first.text),
          });
        }
        const sum = terms[0];
        if (
          formula &&
          first.ok &&
          /^[\d.eE()+\s-]+$/.test(sum) &&
          /[\d)]\s*[+-]/.test(sum) &&
          (!label || /路径|路线|绕路|边权|总长|length|weight/i.test(label))
        )
          sums.push(sum);
      }
    }

    const formulas = claims.filter(({ path }) => path === formulaPath);
    for (const claim of claims) {
      if (claim.path === formulaPath || !claim.label) continue;
      const candidates = claims.filter(
        (other) => other.path !== claim.path && other.label === claim.label,
      );
      const sameField = claims.filter(
        (other) => other.path === claim.path && other.label === claim.label,
      );
      if (sameField.length !== 1) continue;
      const [expected] = candidates.length
        ? candidates
        : /^(?:(?:计算|运算|算式)?结果|result)$/i.test(claim.label) &&
            !fields.find(([path, text]) => path === formulaPath && text && /≈|\\approx/.test(text))
          ? formulas
          : [];
      if ((candidates.length || formulas.length) > 1 || !expected || expected.value === claim.value)
        continue;
      reasons.add(
        `numeric consistency at ${claim.path}: ${short(claim.value)} conflicts with ${expected.observed ? 'calc_verify result' : 'result'} ${short(expected.value)} at ${expected.path}`,
      );
    }

    const [sum] = sums;
    for (const [index, report] of reports.entries()) {
      const { path, route, weights } = report;
      for (const other of reports.slice(0, index)) {
        if (route === other.route && weights.join(',') !== other.weights.join(',')) {
          reasons.add(
            `numeric consistency at ${path}: weights [${short(weights.join(', '))}] differ from [${short(other.weights.join(', '))}] at ${other.path}`,
          );
        }
      }
      if (sums.length !== 1 || new Set(reports.map(({ route }) => route)).size !== 1) continue;
      const total = calc(weights.map((weight) => `(${weight})`).join('+'));
      const expression = calc(sum);
      if (total.ok && expression.ok && total.text !== expression.text) {
        reasons.add(
          `numeric consistency at ${formulaPath}: edge sum ${short(sum)} conflicts with weights [${short(weights.join(', '))}] at ${path}`,
        );
      }
    }
  }

  for (const [index, panel] of scene.panels.entries()) {
    const path = `$.panels[${index}]`;
    const formula = `${path}.formula`;
    review(
      [
        [`${path}.content`, panel.content],
        [formula, panel.formula],
        [`${path}.voiceover`, panel.voiceover],
      ],
      formula,
    );
  }
  if (scene.resolution)
    review([
      ['$.resolution.text', scene.resolution.text],
      ['$.resolution.conclusion', scene.resolution.conclusion],
    ]);
  return [...reasons].slice(0, 8);
}
