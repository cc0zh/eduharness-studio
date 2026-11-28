import type { TSchema } from '@sinclair/typebox';
import { type ValueError, ValueErrorType } from '@sinclair/typebox/errors';
import { Value } from '@sinclair/typebox/value';
import { containsCredential } from './model-configuration.js';

const safeSchemaFields = new Set([
  'id',
  'count',
  'title',
  'topic',
  'foundation',
  'goal',
  'units',
  'lessons',
  'summary',
  'depth',
  'keypoints',
  'objective',
  'basis',
  'examples',
  'misconceptions',
  'sources',
  'url',
  'snippet',
  'opening',
  'diagnosis',
  'status',
  'strategy',
  'actions',
  'resolution',
  'conclusion',
  'panels',
  'bindings',
  'key',
  'expression',
  'format',
  'quoted_error',
  'diagram',
  'highlight',
  'voiceover',
  'next_ask',
  'transfer',
  'type',
  'step_id',
  'column',
  'card_id',
  'content',
  'formula',
  'diagram_kind',
  'description',
  'page_id',
  'target_text',
  'style',
  'checkpoint',
  'mode',
  'prompt',
  'hint',
  'options',
  'label',
  'keypoint_id',
  'insert_keypoint',
  'name',
  'value',
  'svg',
  'text',
  'field',
]);
const sensitiveField =
  /(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|credential|authorization|cookie)/i;

export const sensitiveOutputReason = 'structured output contains a [sensitive-field]';

function anyOutputEntry(value: unknown, test: (value: string, key: boolean) => boolean): boolean {
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const entry = pending.pop();
    if (typeof entry === 'string' && test(entry, false)) return true;
    if (entry === null || typeof entry !== 'object' || seen.has(entry)) continue;
    seen.add(entry);
    for (const [key, part] of Object.entries(entry)) {
      if (test(key, true)) return true;
      pending.push(part);
    }
  }
  return false;
}

export function hasSensitiveFields(value: unknown): boolean {
  return anyOutputEntry(value, (text, key) => key && sensitiveField.test(text));
}

export function outputEchoesCredential(value: unknown, ...keys: (string | undefined)[]): boolean {
  return anyOutputEntry(value, (text) => keys.some((key) => containsCredential(text, key)));
}

const issueLabel: Partial<Record<ValueErrorType, string>> = {
  [ValueErrorType.ArrayMaxItems]: 'too many items',
  [ValueErrorType.ArrayMinItems]: 'too few items',
  [ValueErrorType.Array]: 'expected an array',
  [ValueErrorType.Boolean]: 'expected a boolean',
  [ValueErrorType.Integer]: 'expected an integer',
  [ValueErrorType.IntersectUnevaluatedProperties]: 'unexpected field',
  [ValueErrorType.IntegerMaximum]: 'number exceeds allowed maximum',
  [ValueErrorType.IntegerMinimum]: 'number is below allowed minimum',
  [ValueErrorType.ObjectAdditionalProperties]: 'unexpected field',
  [ValueErrorType.ObjectRequiredProperty]: 'missing required field',
  [ValueErrorType.Number]: 'expected a number',
  [ValueErrorType.NumberMaximum]: 'number exceeds allowed maximum',
  [ValueErrorType.NumberMinimum]: 'number is below allowed minimum',
  [ValueErrorType.StringFormat]: 'string has an invalid format',
  [ValueErrorType.StringMaxLength]: 'string is too long',
  [ValueErrorType.StringMinLength]: 'string is too short',
  [ValueErrorType.StringPattern]: 'string does not match the required pattern',
  [ValueErrorType.String]: 'expected a string',
  [ValueErrorType.Union]: 'value does not match an allowed variant',
  [ValueErrorType.Literal]: 'value does not match an allowed literal',
};

function safeSchemaPath(path: string) {
  const segments = path
    .split('/')
    .filter(Boolean)
    .slice(0, 8)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (!segments.length) return '$';
  return segments.reduce((result, segment) => {
    if (/^\d{1,3}$/.test(segment)) return `${result}[${Number(segment)}]`;
    if (sensitiveField.test(segment)) return `${result}.[sensitive-field]`;
    return `${result}.${safeSchemaFields.has(segment) ? segment : '[unexpected-field]'}`;
  }, '$');
}

function leafErrors(error: ValueError): ValueError[] {
  if (error.type === ValueErrorType.Union && error.errors.length > 0) {
    const candidates = error.errors.map((iterator) => [...iterator].flatMap(leafErrors));
    return candidates.sort((left, right) => left.length - right.length)[0] ?? [error];
  }
  const nested = error.errors.flatMap((iterator) => [...iterator]);
  return nested.length ? nested.flatMap(leafErrors) : [error];
}

export function schemaReasons<S extends TSchema>(schema: S, value: unknown) {
  try {
    const errors = [...Value.Errors(schema, value)].flatMap(leafErrors);
    const reasons = [
      ...new Set(
        errors
          .sort((left, right) => {
            const priority = (error: ValueError) =>
              error.type === ValueErrorType.ObjectAdditionalProperties ? 0 : 1;
            return priority(left) - priority(right);
          })
          .map(({ path, type }) => {
            const label = issueLabel[type] ?? 'schema constraint violated';
            return `invalid structured output at ${safeSchemaPath(path)}: ${label}`;
          }),
      ),
    ].slice(0, 8);
    if (errors.length > reasons.length && reasons.length === 8)
      reasons.push('additional schema constraints failed');
    return reasons.length ? reasons : ['structured output did not match its schema'];
  } catch {
    return ['structured output did not match its schema'];
  }
}

const optionalBlankFields = new Set([
  'formula',
  'hint',
  'title',
  'summary',
  'depth',
  'url',
  'basis',
  'examples',
  'misconceptions',
  'sources',
]);

export function stripBlankOptionalFields(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripBlankOptionalFields(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      optionalBlankFields.has(key) &&
      (entry === null || (typeof entry === 'string' && !entry.trim()))
        ? []
        : [[key, stripBlankOptionalFields(entry, depth + 1)]],
    ),
  );
}
