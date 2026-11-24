import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { callMath } from './calc-verify-math.js';
import {
  applyOperator,
  type BinaryOperator,
  CALC_ERROR_CODES,
  CalcError,
  type CalcValue,
  formatValue,
  negate,
  piMultiple,
  ratio,
  readDecimal,
} from './calc-verify-numbers.js';

const MAX_EXPRESSION_LENGTH = 512;
const MAX_PARSE_DEPTH = 32;
const strict = { additionalProperties: false };

export const CalcVerifyParamsSchema = Type.Object(
  {
    expression: Type.String({
      minLength: 1,
      maxLength: MAX_EXPRESSION_LENGTH,
      description:
        'Math expression using +, -, *, /, ^ (or **), parentheses and decimal or scientific literals. Use explicit multiplication. Constants: pi, e. Calls: sqrt, abs, pow, log, ln, exp, sin, cos, tan, floor, ceil, round, min, max, comb (C), perm (P), factorial. Trig uses radians; log(x, base) defaults to base 10.',
    }),
    format: Type.Optional(
      Type.Union([Type.Literal('decimal'), Type.Literal('fraction')], {
        description:
          'Defaults to decimal. Fraction uses a reduced fraction when exact. Approximate text uses up to 15 significant digits.',
      }),
    ),
  },
  strict,
);

export const CalcVerifyResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      value: Type.Number({
        description: 'Finite numeric convenience value; use text for exact digits.',
      }),
      text: Type.String(),
      approximate: Type.Boolean({ description: 'Whether text is a decimal approximation.' }),
    },
    strict,
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      error: Type.Object(
        {
          code: Type.Union([
            Type.Literal('invalid_input'),
            ...CALC_ERROR_CODES.map((code) => Type.Literal(code)),
          ]),
          message: Type.String(),
          position: Type.Optional(
            Type.Integer({ minimum: 0, description: 'Zero-based source offset.' }),
          ),
        },
        strict,
      ),
    },
    strict,
  ),
]);

export type CalcVerifyParams = Static<typeof CalcVerifyParamsSchema>;
export type CalcVerifyResult = Static<typeof CalcVerifyResultSchema>;

type Token = { kind: 'number' | 'name' | 'symbol' | 'end'; text: string; position: number };

function tokensOf(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\s+|(?<number>(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)|(?<name>[a-zA-Z][a-zA-Z0-9_]*)|(?<symbol>\*\*|[+*/^(),-])/gy;
  while (pattern.lastIndex < source.length) {
    const position = pattern.lastIndex;
    const match = pattern.exec(source);
    if (!match) throw new CalcError('syntax_error', 'Unsupported character.', position);
    const { number, name, symbol } = match.groups!;
    if (number) tokens.push({ kind: 'number', text: number, position });
    if (name) tokens.push({ kind: 'name', text: name, position });
    if (symbol) tokens.push({ kind: 'symbol', text: symbol, position });
  }
  tokens.push({ kind: 'end', text: '', position: source.length });
  return tokens;
}

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 } satisfies Record<
  BinaryOperator,
  number
>;
const UNARY_PRECEDENCE = 3;

function isOperator(token: string): token is BinaryOperator {
  return Object.hasOwn(PRECEDENCE, token);
}

function solve(source: string): CalcValue {
  const tokens = tokensOf(source);
  let index = 0;
  const peek = () => tokens[index];

  function accept(text: string): boolean {
    if (peek().text !== text) return false;
    index++;
    return true;
  }

  function closeParen() {
    if (!accept(')'))
      throw new CalcError('syntax_error', 'Expected a closing parenthesis.', peek().position);
  }

  function prefix(depth: number): CalcValue {
    const token = tokens[index++];
    if (token.kind === 'number') return readDecimal(token.text);
    if (token.text === '+' || token.text === '-') {
      const value = parse(UNARY_PRECEDENCE, depth + 1);
      return token.text === '-' ? negate(value) : value;
    }
    if (token.text === '(') {
      const value = parse(1, depth + 1);
      closeParen();
      return value;
    }
    if (token.kind === 'name') {
      if (accept('(')) {
        const args: CalcValue[] = [];
        if (!accept(')')) {
          do {
            args.push(parse(1, depth + 1));
          } while (accept(','));
          closeParen();
        }
        return callMath(token.text, args, token.position);
      }
      if (token.text === 'pi') return piMultiple(ratio(1n));
      if (token.text === 'e') return Math.E;
      throw new CalcError('syntax_error', 'Unknown mathematical constant.', token.position);
    }
    throw new CalcError(
      'syntax_error',
      'Expected a number, constant, function call or parenthesis.',
      token.position,
    );
  }

  function parse(minPrecedence: number, depth: number): CalcValue {
    if (depth > MAX_PARSE_DEPTH) {
      throw new CalcError(
        'limit_exceeded',
        `Expression nesting exceeds ${MAX_PARSE_DEPTH}.`,
        peek().position,
      );
    }
    let value = prefix(depth);
    for (;;) {
      const { text } = peek();
      const op = text === '**' ? '^' : text;
      if (!isOperator(op) || PRECEDENCE[op] < minPrecedence) return value;
      index++;
      // Only powers associate to the right; they also bind more tightly than a leading sign.
      value = applyOperator(op, value, parse(PRECEDENCE[op] + (op === '^' ? 0 : 1), depth + 1));
    }
  }

  const value = parse(1, 0);
  if (peek().kind !== 'end') {
    throw new CalcError(
      'syntax_error',
      'Unexpected token after the expression; use explicit operators.',
      peek().position,
    );
  }
  return value;
}

/** Verify a bounded real-valued expression from JSON tool parameters. */
export function calcVerify(input: unknown): CalcVerifyResult {
  if (!Value.Check(CalcVerifyParamsSchema, input)) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: `Provide an expression of 1–${MAX_EXPRESSION_LENGTH} characters and an optional decimal or fraction format.`,
      },
    };
  }

  try {
    return { ok: true, ...formatValue(solve(input.expression), input.format === 'fraction') };
  } catch (error) {
    if (!(error instanceof CalcError)) throw error;
    const { code, message, position } = error;
    return { ok: false, error: { code, message, ...(position === undefined ? {} : { position }) } };
  }
}
