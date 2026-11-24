const MAGNITUDE_DIGITS = 160;
const MAX_INTEGER = 10n ** BigInt(MAGNITUDE_DIGITS);
const MAX_INTEGER_BITS = MAX_INTEGER.toString(2).length;
const MAX_MAGNITUDE = Number(MAX_INTEGER);
const MIN_MAGNITUDE = 1 / MAX_MAGNITUDE;
const MAX_POWER = 100;

export const CALC_ERROR_CODES = [
  'syntax_error',
  'domain_error',
  'division_by_zero',
  'limit_exceeded',
] as const;

export class CalcError extends Error {
  constructor(
    readonly code: (typeof CALC_ERROR_CODES)[number],
    message: string,
    readonly position?: number,
  ) {
    super(message);
  }
}

export type Ratio = { n: bigint; d: bigint };
type PiMultiple = { pi: Ratio };
// Ratios are reduced with a positive denominator. Track rational multiples of pi for exact angles.
export type CalcValue = Ratio | PiMultiple | number;
export type BinaryOperator = '+' | '-' | '*' | '/' | '^';

const absInt = (n: bigint) => (n < 0n ? -n : n);
const gcd = (a: bigint, b: bigint) => {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};
export const isPiMultiple = (value: CalcValue): value is PiMultiple =>
  typeof value !== 'number' && 'pi' in value;
export const isRatio = (value: CalcValue): value is Ratio =>
  typeof value !== 'number' && !('pi' in value);

function domain(message: string): never {
  throw new CalcError('domain_error', message);
}

function limit(message: string): never {
  throw new CalcError('limit_exceeded', message);
}

function zeroDivisor(): never {
  throw new CalcError('division_by_zero', 'Cannot divide by zero.');
}

function boundedRatio(n: bigint, d: bigint): Ratio {
  if (absInt(n) > MAX_INTEGER || absInt(d) > MAX_INTEGER)
    limit('Exact result exceeds the supported range.');
  return d < 0n ? { n: -n, d: -d } : { n, d };
}

export function ratio(n: bigint, d = 1n): Ratio {
  if (d === 0n) zeroDivisor();
  const divisor = gcd(absInt(n), absInt(d));
  return boundedRatio(n / divisor, d / divisor);
}

export function piMultiple(value: Ratio): CalcValue {
  if (value.n === 0n) return value;
  const result = { pi: value };
  approximate(numeric(result));
  return result;
}

export function numeric(value: CalcValue): number {
  if (typeof value === 'number') return value;
  if (isPiMultiple(value)) return (Number(value.pi.n) / Number(value.pi.d)) * Math.PI;
  return Number(value.n) / Number(value.d);
}

export function readDecimal(literal: string): Ratio {
  const [mantissa, exponentText = '0'] = literal.toLowerCase().split('e');
  const exponent = Number(exponentText);
  if (Math.abs(exponent) > MAGNITUDE_DIGITS)
    limit(`Decimal exponent must be within ±${MAGNITUDE_DIGITS}.`);
  const places = (mantissa.split('.')[1] ?? '').length - exponent;
  const n = BigInt(mantissa.replace('.', ''));
  return places > 0 ? ratio(n, 10n ** BigInt(places)) : ratio(n * 10n ** BigInt(-places));
}

function ratioProduct(a: Ratio, b: Ratio): Ratio {
  return ratio(a.n * b.n, a.d * b.d);
}

function ratioQuotient(a: Ratio, b: Ratio): Ratio {
  return ratio(a.n * b.d, a.d * b.n);
}

function ratioSum(a: Ratio, b: Ratio, subtract: boolean): Ratio {
  const right = b.n * a.d;
  return ratio(a.n * b.d + (subtract ? -right : right), a.d * b.d);
}

// For nonnegative operands, cap each factor so temporary products stay within twice the digit budget.
function cappedPower(base: bigint, exponent: bigint, cap: bigint): bigint {
  let result = 1n;
  const overflow = cap + 1n;
  while (exponent > 0n) {
    if (exponent % 2n === 1n) {
      result *= base;
      if (result > cap) return overflow;
    }
    exponent /= 2n;
    if (exponent > 0n) {
      base *= base;
      if (base > cap) base = overflow;
    }
  }
  return result;
}

function ratioPower(base: Ratio, exponent: bigint): Ratio {
  const p = absInt(exponent);
  const unsigned = cappedPower(absInt(base.n), p, MAX_INTEGER);
  const n = base.n < 0n && p % 2n === 1n ? -unsigned : unsigned;
  const d = cappedPower(base.d, p, MAX_INTEGER);
  // Powers of a reduced ratio remain reduced, including when the fraction is inverted.
  return exponent < 0n ? boundedRatio(d, n) : boundedRatio(n, d);
}

function integerRoot(value: bigint, degree: bigint): bigint | undefined {
  if (value < 2n) return value;
  let low = 1n;
  let high = 1n << BigInt(Math.ceil(value.toString(2).length / Number(degree)));
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (cappedPower(middle, degree, value) <= value) low = middle;
    else high = middle;
  }
  return cappedPower(low, degree, value) === value ? low : undefined;
}

function exactRoot(value: Ratio, degree: bigint): Ratio | undefined {
  if (degree > BigInt(MAX_POWER)) return undefined;
  const nRoot = integerRoot(absInt(value.n), degree);
  const dRoot = integerRoot(value.d, degree);
  if (nRoot === undefined || dRoot === undefined) return undefined;
  return ratio(value.n < 0n ? -nRoot : nRoot, dRoot);
}

export function approximate(value: number, nonzero = false): number {
  const size = Math.abs(value);
  if (Number.isNaN(value)) domain('Result is not a real number.');
  if (size > MAX_MAGNITUDE || ((size !== 0 || nonzero) && size < MIN_MAGNITUDE)) {
    limit('Approximate result is outside the supported range.');
  }
  return value;
}

export function negate(value: CalcValue): CalcValue {
  if (typeof value === 'number') return -value;
  if (isPiMultiple(value)) return { pi: { n: -value.pi.n, d: value.pi.d } };
  return { n: -value.n, d: value.d };
}

function power(base: CalcValue, exponent: CalcValue): CalcValue {
  const e = numeric(exponent);
  const b = numeric(base);
  const tooLarge = isRatio(exponent)
    ? absInt(exponent.n) > BigInt(MAX_POWER) * exponent.d
    : Math.abs(e) > MAX_POWER;
  if (tooLarge) limit(`Power exponent must be within ±${MAX_POWER}.`);
  if (b === 0 && e === 0) domain('Zero to the zero power is undefined.');
  if (b === 0 && e < 0) zeroDivisor();

  if (isRatio(exponent)) {
    if (b < 0 && exponent.d % 2n === 0n) {
      domain('A negative base requires a rational exponent with an odd denominator.');
    }
    if (isRatio(base)) {
      const root = exponent.d === 1n ? base : exactRoot(base, exponent.d);
      if (root) return ratioPower(root, exponent.n);
    }
    if (isPiMultiple(base) && exponent.n === exponent.d) return base;
    const value = approximate(Math.abs(b) ** e, b !== 0);
    return b < 0 && absInt(exponent.n) % 2n === 1n ? -value : value;
  }
  return approximate(b ** e, b !== 0);
}

function plus(left: CalcValue, right: CalcValue, subtract: boolean): CalcValue {
  if (isRatio(left) && isRatio(right)) return ratioSum(left, right, subtract);
  if (isPiMultiple(left) && isPiMultiple(right)) {
    return piMultiple(ratioSum(left.pi, right.pi, subtract));
  }
  if (isPiMultiple(left) && isRatio(right) && right.n === 0n) return left;
  if (isRatio(left) && left.n === 0n && isPiMultiple(right)) {
    return subtract ? negate(right) : right;
  }
  const a = numeric(left);
  const b = numeric(right);
  return approximate(subtract ? a - b : a + b);
}

function multiply(left: CalcValue, right: CalcValue): CalcValue {
  if (isRatio(left) && isRatio(right)) return ratioProduct(left, right);
  if (isPiMultiple(left) && isRatio(right)) return piMultiple(ratioProduct(left.pi, right));
  if (isRatio(left) && isPiMultiple(right)) return piMultiple(ratioProduct(left, right.pi));
  return approximate(numeric(left) * numeric(right));
}

function divide(left: CalcValue, right: CalcValue): CalcValue {
  const b = numeric(right);
  if (b === 0) zeroDivisor();
  if (isRatio(left) && isRatio(right)) return ratioQuotient(left, right);
  if (isPiMultiple(left) && isRatio(right)) return piMultiple(ratioQuotient(left.pi, right));
  if (isPiMultiple(left) && isPiMultiple(right)) return ratioQuotient(left.pi, right.pi);
  return approximate(numeric(left) / b);
}

export function applyOperator(op: BinaryOperator, left: CalcValue, right: CalcValue): CalcValue {
  if (op === '^') return power(left, right);
  if (op === '+') return plus(left, right, false);
  if (op === '-') return plus(left, right, true);
  if (op === '*') return multiply(left, right);
  return divide(left, right);
}

export function squareRoot(value: CalcValue): CalcValue {
  const x = numeric(value);
  if (x < 0) domain('Square root requires a nonnegative argument.');
  const exact = isRatio(value) ? exactRoot(value, 2n) : undefined;
  return exact ?? Math.sqrt(x);
}

// Undefined means distinct values may have rounded to the same double; 0 proves equality.
export function compareValues(left: CalcValue, right: CalcValue): -1 | 0 | 1 | undefined {
  if (isRatio(left) && isRatio(right)) {
    const difference = left.n * right.d - right.n * left.d;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  if (isPiMultiple(left) && isPiMultiple(right)) {
    const difference = left.pi.n * right.pi.d - right.pi.n * left.pi.d;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  const a = numeric(left);
  const b = numeric(right);
  return a < b ? -1 : a > b ? 1 : undefined;
}

export function exactIntegerLog(value: Ratio, base: Ratio, estimate: number): Ratio | undefined {
  const integer = Math.round(estimate);
  // The larger component of a reduced base other than 1 is at least 2.
  if (Math.abs(integer) > MAX_INTEGER_BITS) return undefined;
  const p = BigInt(Math.abs(integer));
  const [n, d] = integer < 0 ? [base.d, base.n] : [base.n, base.d];
  if (cappedPower(n, p, value.n) === value.n && cappedPower(d, p, value.d) === value.d) {
    return ratio(BigInt(integer));
  }
  return undefined;
}

function exactDecimal({ n, d }: Ratio): string | undefined {
  if (d === 1n) return String(n);
  let places = 0;
  for (let rest = d; rest !== 1n; places++) {
    const factor = gcd(rest, 10n);
    if (factor === 1n) return undefined;
    rest /= factor;
  }
  const digits = String((absInt(n) * 10n ** BigInt(places)) / d).padStart(places + 1, '0');
  return `${n < 0n ? '-' : ''}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

export function formatValue(value: CalcValue, asFraction: boolean) {
  const decimal = isRatio(value) ? exactDecimal(value) : undefined;
  const exact = asFraction && isRatio(value) && value.d !== 1n ? `${value.n}/${value.d}` : decimal;
  const decimalText = decimal ?? String(Number(numeric(value).toPrecision(15)));
  return {
    value: Number(decimalText),
    text: exact ?? decimalText,
    approximate: exact === undefined,
  };
}
