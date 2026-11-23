import { type TSchema, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { validator } from 'hono/validator';

export const RouteIdSchema = Type.String({ pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 80 });

export function checked<Target extends 'json' | 'param' | 'query', Schema extends TSchema>(
  target: Target,
  schema: Schema,
) {
  return validator(target, (input, c) => {
    if (Value.Check(schema, input)) return input;
    return c.json(
      { error: 'invalid_input', field: Value.Errors(schema, input).First()?.path || '/' },
      400,
    );
  });
}
