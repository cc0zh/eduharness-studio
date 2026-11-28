import { isCalcFunction } from './calc-verify-math.js';

export const decimal = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
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
          // Unknown multi-argument operators (e.g. binomial notation) are opaque, not arithmetic.
          const second = argument();
          text += second === undefined ? body : `\\${name}{${body}}{${second}}`;
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

function* clauses(source: string) {
  let start = 0;
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (/[;。!?\n|≈≠✔✓]/.test(char) || (!depth && char === ',')) {
      yield source.slice(start, i);
      start = i + 1;
      depth = 0;
    }
  }
  yield source.slice(start);
}

const name = /^(?:\p{Script=Han}{1,24}|[a-z][\w ]{0,23})$/iu;
const proseAssignment = /^([\p{Script=Han}]{1,24}?|result)\s*(?:等于|为|是|:)\s*(?=[+\-.(\d])/iu;
const equality = /(?<![!<>=~])=(?![=>])/;

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

export function* equationChains(source: string, standalone: boolean) {
  // A named term such as “+ 健康 9000” supplies a literal, unlike an unknown variable.
  const annotated = source.replace(/([+*/-])\s*\p{Script=Han}{1,16}\s+(?=\d)/gu, '$1 ');
  for (const clause of clauses(annotated)) {
    const parts = clause.trim().replace(proseAssignment, '$1=').split(equality);
    if (parts.length === 1 && !standalone) continue;
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
