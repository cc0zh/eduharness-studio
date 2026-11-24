import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  type CalcVerifyParams,
  CalcVerifyParamsSchema,
  CalcVerifyResultSchema,
  calcVerify,
} from '../src/index.js';

function success(expression: string, format?: CalcVerifyParams['format']) {
  const result = calcVerify({ expression, format });
  assert.ok(result.ok, `${expression}: ${JSON.stringify(result)}`);
  assert.ok(Value.Check(CalcVerifyResultSchema, result));
  return result;
}

function failure(input: unknown, code: string) {
  const result = calcVerify(input);
  assert.ok(!result.ok, JSON.stringify(input));
  assert.ok(Value.Check(CalcVerifyResultSchema, result));
  assert.equal(result.error.code, code, JSON.stringify(input));
  return result.error;
}

test('calc_verify respects precedence, power associativity, grouping and leading signs', () => {
  for (const [expression, value] of [
    [' 2 +\t3 * 4\n', 14],
    ['(2 + 3) * 4', 20],
    ['8 - 3 - 2', 3],
    ['24 / 4 / 2', 3],
    ['2^3**2', 512],
    ['-2^2', -4],
    ['(-2)^2', 4],
    ['2^-2', 0.25],
    ['(-2)^-3', -0.125],
    ['+(--.5 + 5.)', 5.5],
  ] as const) {
    assert.equal(success(expression).value, value, expression);
  }
});

test('calc_verify retains decimal and rational exactness until formatting', () => {
  assert.deepEqual(success('0.1 + 0.2'), { ok: true, value: 0.3, text: '0.3', approximate: false });
  assert.equal(success('0.1 + 0.2 - 0.3').text, '0');
  assert.equal(success('1/7 * 7').text, '1');
  assert.equal(success('2E-3 + .1e+1').text, '1.002');
  assert.equal(success('9007199254740993 - 9007199254740992').text, '1');
  assert.equal(success('1.234567890123456789 + 1e-18').text, '1.23456789012345679');
  assert.equal(success('round(1.4999999999999999999)').text, '1');
  assert.equal(success('max(9007199254740993, 9007199254740992)').text, '9007199254740993');
});

test('calc_verify distinguishes an exact reduced fraction from an approximate decimal', () => {
  assert.deepEqual(success('1/3'), {
    ok: true,
    value: 0.333333333333333,
    text: '0.333333333333333',
    approximate: true,
  });
  assert.deepEqual(success('1/3 + 1/6', 'fraction'), {
    ok: true,
    value: 0.5,
    text: '1/2',
    approximate: false,
  });
  assert.equal(success('4/-6', 'fraction').text, '-2/3');
  assert.equal(success('-4/-6', 'fraction').text, '2/3');
  assert.equal(success('12/3', 'fraction').text, '4');
  assert.equal(success('sqrt(49/100)', 'fraction').text, '7/10');
  const root = success('sqrt(2)', 'fraction');
  assert.equal(root.text, '1.4142135623731');
  assert.equal(root.approximate, true);
  assert.equal(success('pi', 'fraction').approximate, true);
  assert.equal(success('min(sqrt(2), 1)', 'fraction').approximate, false);
  assert.equal(success('min(pi, 3.141592653589793)', 'fraction').approximate, true);
});

test('calc_verify handles common math functions with the documented conventions', () => {
  for (const [expression, value] of [
    ['sqrt(0)', 0],
    ['sqrt(49/100)', 0.7],
    ['abs(-3/2)', 1.5],
    ['pow(9, .5)', 3],
    ['log(1000)', 3],
    ['log(81, 3)', 4],
    ['ln(e)', 1],
    ['exp(ln(2))', 2],
    ['sin(pi/6)', 0.5],
    ['cos(pi/3)', 0.5],
    ['tan(pi/4)', 1],
    ['floor(-2.9)', -3],
    ['ceil(-2.9)', -2],
    ['round(-2.5)', -2],
    ['round(2.5)', 3],
    ['min(1, 4/3, pi)', 1],
    ['max(-3, -2, -5)', -2],
  ] as const) {
    assert.equal(success(expression).value, value, expression);
  }
});

test('calc_verify preserves exact operands and special values in composed expressions', () => {
  for (const [expression, text] of [
    ['floor(log(1000, 10))', '3'],
    ['factorial(log(1000, 10))', '6'],
    ['log(1/27, 3)', '-3'],
    ['log(1/32, 1/2)', '5'],
    ['floor(log(1e160))', '160'],
    ['log(1+1e-16, 1+1e-16)', '1'],
    ['round(sin(pi/6))', '1'],
    ['sin(pi*1e100 + pi/6)', '1/2'],
    ['cos(-pi/3)', '1/2'],
    ['tan(5*pi/4)', '1'],
    ['C(64^(1/3), 2)', '6'],
    ['(-8)^(1/3)', '-2'],
    ['(-8/27)^(-2/3)', '9/4'],
    ['floor(min(pi, 1-1e-17))', '0'],
    ['ceil(max(-pi, -1+1e-17))', '0'],
  ] as const) {
    const result = success(expression, 'fraction');
    assert.equal(result.text, text, expression);
    assert.equal(result.approximate, false, expression);
  }
  const logNearOne = success('ln(1+1e-16)/1e-16');
  assert.equal(logNearOne.value, 1);
  assert.equal(logNearOne.approximate, true);
});

test('calc_verify computes probability, combinations and permutations exactly', () => {
  const probability = success('C(5, 2)*C(7, 1)/comb(12, 3)', 'fraction');
  assert.equal(probability.text, '7/22');
  assert.equal(probability.approximate, false);
  assert.equal(success('P(5, 3)').value, 60);
  assert.equal(success('perm(6, 0)').value, 1);
  assert.equal(success('C(0, 0)').value, 1);
  assert.equal(success('factorial(0)').value, 1);
  assert.equal(success('factorial(5)').value, 120);
  assert.equal(success('factorial(100)/factorial(99)').value, 100);
  assert.equal(success('comb(100, 50)').text, '100891344545564193334812497256');
  const fromApproximation = success('factorial(floor(pi))', 'fraction');
  assert.equal(fromApproximation.value, 6);
  assert.equal(fromApproximation.approximate, true);
});

test('calc_verify reports mathematical domain errors without throwing', () => {
  for (const expression of ['1/0', 'e/(1/3 - 1/3)', '0^-1']) {
    failure({ expression }, 'division_by_zero');
  }
  for (const expression of [
    'sqrt(-4)',
    'ln(0)',
    'log(-1)',
    'log(2, 1)',
    'log(2, -2)',
    'tan(3*pi/2)',
    '(-2)^.5',
    '(-2)^(1.0000000000000000001)',
    '0^0',
    'factorial(-1)',
    'factorial(2.7)',
    'C(5.5, 2)',
    'P(3, 4)',
  ]) {
    failure({ expression }, 'domain_error');
  }
});

test('calc_verify enforces length, nesting, exponent, count and numeric bounds', () => {
  assert.equal(success('1'.padEnd(512)).value, 1);
  assert.equal(success(`${'('.repeat(32)}1${')'.repeat(32)}`).value, 1);
  assert.equal(success('10^100').text, `1${'0'.repeat(100)}`);
  failure({ expression: '1'.padEnd(513) }, 'invalid_input');
  for (const expression of [
    `${'('.repeat(33)}1${')'.repeat(33)}`,
    `${'+'.repeat(33)}1`,
    `${'1^'.repeat(33)}1`,
    `${'sqrt('.repeat(33)}1${')'.repeat(33)}`,
    '2^101',
    'pow(2, -101)',
    '2^100.00000000000000001',
    'factorial(101)',
    'C(101, 1)',
    '1e99999999999999999999',
    '1e-161',
    '1e160 * 10 / 10',
    '1e-160 / 10',
    'exp(1000)',
    'exp(-1000)',
    'pow(1e160, 100)',
    'pi*1e160',
  ]) {
    failure({ expression }, 'limit_exceeded');
  }
});

test('calc_verify rejects malformed syntax, unknown names and non-math constructs', () => {
  for (const expression of [
    ' ',
    '1+',
    '()',
    '(1+2',
    '2(3)',
    '2pi',
    '1.2.3',
    '1e+',
    '1,2',
    '0x10',
    'sqrt()',
    'sqrt(1, 2)',
    'min()',
    'C(1,)',
    'log(1, 2, 3)',
    'Infinity',
    'NaN',
    '1;2',
    '2//3',
    'pi[0]',
    'sqrt.constructor(1)',
    'constructor(1)',
    'toString(1)',
    '__proto__(1)',
    'fetch(1)',
    'process.exit(0)',
    'x = 1',
    '"1"',
  ]) {
    const error = failure({ expression }, 'syntax_error');
    assert.ok(error.position !== undefined && error.position <= expression.length, expression);
  }
  assert.equal(failure({ expression: ' 2 + @' }, 'syntax_error').position, 5);
});

test('calc_verify exposes strict TypeBox schemas for the tool boundary', () => {
  assert.ok(Value.Check(CalcVerifyParamsSchema, { expression: '1/3' }));
  assert.ok(Value.Check(CalcVerifyParamsSchema, { expression: '1/3', format: 'fraction' }));
  for (const input of [
    null,
    [],
    {},
    { expression: 1 },
    { expression: '' },
    { expression: '1', format: 'anything' },
    { expression: '1', extra: true },
  ]) {
    assert.equal(Value.Check(CalcVerifyParamsSchema, input), false);
    failure(input, 'invalid_input');
  }
  assert.equal(
    Value.Check(CalcVerifyResultSchema, {
      ok: true,
      value: Infinity,
      text: 'Infinity',
      approximate: true,
    }),
    false,
  );
  assert.equal(
    Value.Check(CalcVerifyResultSchema, { ok: false, error: { code: 'unknown', message: 'Bad' } }),
    false,
  );
});
