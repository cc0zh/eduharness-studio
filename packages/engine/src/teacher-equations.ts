import { isCalcFunction } from './calc-verify-math.js';

export const decimal = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
// Number of style arguments before the content. Other multi-argument commands stay opaque:
// the last argument of a fraction or binomial is not the value of the expression.
const texStyleArguments = new Map([
  ['textcolor', 1],
  ['colorbox', 1],
  ['fcolorbox', 2],
]);
const texSymbols = new Map([
  ['times', '*'],
  ['cdot', '*'],
  ['div', '/'],
  ['%', '%'],
  ['pi', 'pi'],
  ['to', '→'],
  ['rightarrow', '→'],
  ['approx', '≈'],
  ['simeq', '≈'],
  ['neq', '≠'],
  ['left', ''],
  ['right', ''],
  ['quad', ' '],
  ['qquad', ' '],
  [',', ' '],
  [';', ' '],
  ['displaystyle', ''],
  ['textstyle', ''],
  ['scriptstyle', ''],
  ['scriptscriptstyle', ''],
  ['!', ' '],
  [' ', ' '],
  ['\\', '\n'],
  ['(', ''],
  [')', ''],
  ['[', ''],
  [']', ''],
]);

// Walk balanced groups, rather than naming formatting commands. Only actual operators need semantics.
function peelTex(source: string) {
  let index = 0;
  let unbalanced = false;
  function argument() {
    let start = index;
    while (/[ \t]/.test(source[start] ?? '')) start++;
    if (source[start] !== '{') return undefined;
    index = start + 1;
    return read(true);
  }
  function read(group: boolean): string {
    let text = '';
    while (index < source.length) {
      const char = source[index++];
      if (char === '}' && group) return text;
      if (char === '{') text += read(true);
      else if (char === '^') {
        const exponent = argument();
        text += exponent === undefined ? '^' : `^(${exponent})`;
      } else if (char !== '\\') text += char;
      else {
        const name = /^(?:[a-z]+|.)/is.exec(source.slice(index))?.[0] ?? '';
        index += name.length;
        const symbol = texSymbols.get(name);
        if (symbol !== undefined) {
          text += symbol;
          continue;
        }
        const body = argument();
        if (isCalcFunction(name)) text += body === undefined ? name : `${name}(${body})`;
        else if (body === undefined) text += `\\${name}`;
        else if (name === 'begin' || name === 'end') text += '\n';
        else if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          const denominator = argument();
          text += denominator === undefined ? '\\frac' : `((${body})/(${denominator}))`;
        } else {
          const styles = texStyleArguments.get(name) ?? 0;
          const args = [body];
          for (let next = argument(); next !== undefined; next = argument()) args.push(next);
          text += args.length === styles + 1 ? args[styles] : `\\${name}{${args.join('}{')}}`;
        }
      }
    }
    unbalanced ||= group;
    return text;
  }
  const text = read(false);
  return unbalanced ? source : text;
}

export function mathText(source: string, markdown = false) {
  const text = markdown ? source.replace(/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/gm, '') : source;
  const powers = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (digits) => `^(${digits.normalize('NFKC')})`);
  return peelTex(powers.normalize('NFKC'))
    .replace(/−/g, '-')
    .replace(/[×·⋅]/g, '*')
    .replace(/[÷⁄]/g, '/')
    .replace(/(?<![\w)])\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/[`$&]/g, '')
    .replace(/\s*\n\s*(?==)|(?<==)\s*\n\s*/g, ' ')
    .replace(/->/g, '→');
}

const groupedInteger = /(?<![.\w])\d{1,3}(?:,\d{3})+(?!\d|,\d)/y;

function* clauses(source: string) {
  let clause = '';
  const call = /([a-z][\w]*)\s*$/i;
  const parentheses: boolean[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    // Inside a calculator function, a comma is an argument separator (e.g. max(12,300)).
    if (/\d/.test(char) && !parentheses.at(-1)) {
      groupedInteger.lastIndex = i;
      const match = groupedInteger.exec(source)?.[0];
      if (match) {
        clause += match.replaceAll(',', '');
        i += match.length - 1;
        continue;
      }
    }
    if (char === '(') {
      const name = call.exec(clause)?.[1];
      parentheses.push(Boolean(parentheses.at(-1) || (name && isCalcFunction(name))));
    }
    if (char === ')') parentheses.pop();
    const separator = /[;。?,\n|≈≠✔✓]/.test(char) || (char === '!' && source[i + 1] !== '=');
    if (!parentheses.length && separator) {
      yield clause;
      clause = '';
    } else clause += char;
  }
  yield clause;
}

const name = /^(?:\p{Script=Han}{1,24}|[a-z][\w ]{0,23})$/iu;
const proseAssignment = /^([\p{Script=Han}]{1,24}?|result)\s*(?:等于|为|是|:)\s*(?=[+\-.(\d])/iu;
const equality = /(?<![!<>=~])=(?![=>])/;
const relationBoundary = /[<>]=?|[≤≥]|!=/;

function edge(part: string, last: boolean) {
  const text = part.trim();
  const run = last ? /^[\w+*/^().,% \t-]+/.exec(text) : /[\w+*/^().,% \t-]+$/.exec(text);
  if (!run) return '';
  const outside = last ? text[run[0].length] : text[run.index - 1];
  if (outside && /[\\[\]{}=<>~±]/.test(outside)) return '';
  const value = run[0].trim();
  if (!last && outside && /\p{L}/u.test(outside) && /^[+*/(-]/.test(run[0])) return '';
  return last && outside ? value.replace(/\($/, '').trim() : value;
}

const percent = new RegExp(`(${decimal.source})\\s*%`, 'g');

// Separate balanced prose asides from the outer text only if they contain an equality.
// Parentheses inside operands and function calls keep their arithmetic meaning.
function* withAsides(clause: string): Generator<string> {
  let start = -1;
  let depth = 0;
  let text = '';
  let offset = 0;
  for (let i = 0; i < clause.length; i++) {
    if (clause[i] === '(') {
      if (depth++ === 0) start = i;
      continue;
    }
    if (clause[i] !== ')' || depth === 0 || --depth !== 0) continue;
    const inner = clause.slice(start + 1, i);
    if (!equality.test(inner)) continue;
    const preceding = clause[start - 1];
    if (preceding && /[\w).]/.test(preceding)) continue;
    text += `${clause.slice(offset, start)} `;
    offset = i + 1;
    for (const part of clauses(inner)) yield* withAsides(part);
  }
  yield text + clause.slice(offset);
}

export function* equationChains(source: string, standalone: boolean) {
  // A named term such as “+ 健康 9000” supplies a literal, unlike an unknown variable.
  const annotated = source.replace(/([+*/-])\s*\p{Script=Han}{1,16}\s+(?=\d)/gu, '$1 ');
  for (const block of clauses(annotated)) {
    for (const aside of withAsides(block)) {
      const relations = aside.split(relationBoundary);
      for (const clause of relations) {
        const parts = clause.trim().replace(proseAssignment, '$1=').split(equality);
        if (parts.length === 1 && (!standalone || relations.length > 1)) continue;
        const label =
          parts.length > 1 && name.test(parts[0].trim()) ? parts.shift()?.trim() : undefined;
        const terms = parts.map((part, i) => {
          const text = part.trim();
          const term =
            parts.length === 1 && !label
              ? text
              : i === parts.length - 1
                ? edge(text, true)
                : i === 0
                  ? edge(text, false)
                  : text;
          return term.replace(percent, '($1/100)');
        });
        if (terms.some(Boolean)) yield { label, terms };
      }
    }
  }
}
