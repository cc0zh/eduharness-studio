import {
  applyOperator,
  approximate,
  CalcError,
  type CalcValue,
  compareValues,
  exactIntegerLog,
  isPiMultiple,
  isRatio,
  negate,
  numeric,
  ratio,
  squareRoot,
} from './calc-verify-numbers.js';

const MAX_COUNT = 100;
const TEN = ratio(10n);

function naturalLog(value: CalcValue): number {
  const x = numeric(value);
  if (x <= 0) throw new CalcError('domain_error', 'Logarithm requires a positive argument.');
  if (isRatio(value) && value.n * 2n >= value.d && value.n <= value.d * 2n) {
    // Subtract one before converting, since a tiny exact offset can round away in x.
    const offset = value.n - value.d;
    return Math.log1p(Number(offset) / Number(value.d));
  }
  return Math.log(x);
}

function logarithm(value: CalcValue, base: CalcValue = TEN): CalcValue {
  const divisor = naturalLog(base);
  if (divisor === 0) {
    throw new CalcError('domain_error', 'Logarithm base must be different from 1.');
  }
  const estimate = naturalLog(value) / divisor;
  if (isRatio(value) && isRatio(base)) {
    const exact = exactIntegerLog(value, base, estimate);
    if (exact) return exact;
  }
  return approximate(estimate);
}

function sineAt(index: number): CalcValue {
  switch (index) {
    case 0:
    case 6:
      return ratio(0n);
    case 1:
    case 5:
      return ratio(1n, 2n);
    case 2:
    case 4:
      return Math.sqrt(3) / 2;
    case 3:
      return ratio(1n);
    case 7:
    case 11:
      return ratio(-1n, 2n);
    case 8:
    case 10:
      return -Math.sqrt(3) / 2;
    default:
      return ratio(-1n);
  }
}

function modulo(value: bigint, modulus: bigint): number {
  return Number(((value % modulus) + modulus) % modulus);
}

function trig(name: 'sin' | 'cos' | 'tan', value: CalcValue): CalcValue {
  if (isRatio(value) && value.n === 0n) return ratio(name === 'cos' ? 1n : 0n);
  let radians = numeric(value);
  if (isPiMultiple(value)) {
    const { n, d } = value.pi;
    if (name === 'tan' && (n * 4n) % d === 0n) {
      const index = modulo((n * 4n) / d, 4n);
      if (index === 2) throw new CalcError('domain_error', 'Tangent is undefined at a pole.');
      return ratio(BigInt(index === 3 ? -1 : index));
    }
    if (name !== 'tan' && (n * 6n) % d === 0n) {
      const offset = name === 'cos' ? 3n : 0n;
      return sineAt(modulo((n * 6n) / d + offset, 12n));
    }
    radians = (Number(n % (2n * d)) / Number(d)) * Math.PI;
  }
  if (name === 'sin') return approximate(Math.sin(radians));
  if (name === 'cos') return approximate(Math.cos(radians));
  if (Math.abs(Math.cos(radians)) <= 1e-12) {
    throw new CalcError('domain_error', 'Tangent is undefined at or too close to a pole.');
  }
  return approximate(Math.tan(radians));
}

function extreme(args: CalcValue[], min: boolean): CalcValue {
  return args.reduce((best, candidate) => {
    const ordering = compareValues(candidate, best);
    // Neither operand's exact representation can be selected on a floating-point tie.
    if (ordering === undefined) return numeric(best);
    return (min ? ordering < 0 : ordering > 0) ? candidate : best;
  });
}

function count(value: CalcValue): bigint {
  const x = numeric(value);
  if (x < 0 || isPiMultiple(value) || (isRatio(value) ? value.d !== 1n : !Number.isInteger(x))) {
    throw new CalcError('domain_error', 'Counting functions require nonnegative integers.');
  }
  if (x > MAX_COUNT) {
    throw new CalcError('limit_exceeded', `Counting arguments must be at most ${MAX_COUNT}.`);
  }
  return BigInt(x);
}

function countProduct(total: CalcValue, selected: CalcValue, choose = false): CalcValue {
  const n = count(total);
  const k = count(selected);
  if (k > n) throw new CalcError('domain_error', 'The selected count must not exceed the total.');
  let result = 1n;
  for (let i = 0n; i < k; i++) {
    result *= n - i;
    if (choose) result /= i + 1n;
  }
  return isRatio(total) && isRatio(selected) ? ratio(result) : Number(result);
}

const floorRatio = (n: bigint, d: bigint) => n / d - (n % d < 0n ? 1n : 0n);

function roundValue(value: CalcValue, kind: 'floor' | 'ceil' | 'round'): CalcValue {
  if (!isRatio(value)) return Math[kind](numeric(value));
  const { n, d } = value;
  if (kind === 'floor') return ratio(floorRatio(n, d));
  if (kind === 'ceil') return ratio(-floorRatio(-n, d));
  return ratio(floorRatio(2n * n + d, 2n * d)); // Ties toward positive infinity.
}

type Call = readonly [min: number, max: number, run: (args: CalcValue[]) => CalcValue];
const unary = (run: (value: CalcValue) => CalcValue): Call => [1, 1, ([x]) => run(x)];
const comb: Call = [2, 2, ([n, k]) => countProduct(n, k, true)];
const perm: Call = [2, 2, ([n, k]) => countProduct(n, k)];
const calls = new Map<string, Call>([
  ['sqrt', unary(squareRoot)],
  ['abs', unary((x) => (numeric(x) < 0 ? negate(x) : x))],
  ['pow', [2, 2, ([x, e]) => applyOperator('^', x, e)]],
  ['log', [1, 2, ([x, base]) => logarithm(x, base)]],
  ['ln', unary((x) => approximate(naturalLog(x)))],
  ['exp', unary((x) => approximate(Math.exp(numeric(x)), true))],
  ['sin', unary((x) => trig('sin', x))],
  ['cos', unary((x) => trig('cos', x))],
  ['tan', unary((x) => trig('tan', x))],
  ['floor', unary((x) => roundValue(x, 'floor'))],
  ['ceil', unary((x) => roundValue(x, 'ceil'))],
  ['round', unary((x) => roundValue(x, 'round'))],
  ['min', [1, Infinity, (args) => extreme(args, true)]],
  ['max', [1, Infinity, (args) => extreme(args, false)]],
  ['comb', comb],
  ['C', comb],
  ['perm', perm],
  ['P', perm],
  ['factorial', unary((x) => countProduct(x, x))],
]);

export function callMath(name: string, args: CalcValue[], position: number): CalcValue {
  const call = calls.get(name);
  if (!call) throw new CalcError('syntax_error', 'Unknown mathematical function.', position);
  const [min, max, run] = call;
  if (args.length < min || args.length > max) {
    const expected =
      min === max ? String(min) : max === Infinity ? `at least ${min}` : `${min}–${max}`;
    throw new CalcError('syntax_error', `Expected ${expected} function argument(s).`, position);
  }
  return run(args);
}
