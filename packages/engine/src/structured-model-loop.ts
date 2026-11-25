import type { Static, TSchema } from '@sinclair/typebox';
import { type ValueError, ValueErrorType } from '@sinclair/typebox/errors';
import { Value } from '@sinclair/typebox/value';
import type { StructuredModelTool } from './structured-model.js';

export interface StructuredToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StructuredToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;
}

export interface StructuredToolResponse<TMessage> {
  message: TMessage;
  stopReason: string;
  calls: readonly StructuredToolCall[];
}

interface ContentPart {
  type: string;
  id?: string;
  arguments?: Record<string, unknown>;
}

interface ToolCallMessage {
  role: string;
  content: string | readonly ContentPart[];
}

export function redactToolCallArguments<TMessage extends ToolCallMessage>(
  message: TMessage,
  calls: readonly StructuredToolCall[],
): TMessage {
  if (message.role !== 'assistant' || typeof message.content === 'string') return message;
  const callIds = new Set(calls.map(({ id }) => id));
  const secretArgument = /(?:key|token|secret|password|credential|authorization|cookie)/i;
  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== 'toolCall' || !part.id || !callIds.has(part.id) || !part.arguments)
        return part;
      return {
        ...part,
        arguments: Object.fromEntries(
          Object.entries(part.arguments).map(([key, value]) => [
            key,
            secretArgument.test(key) ? '[已隐藏]' : value,
          ]),
        ),
      };
    }),
  } as TMessage;
}

interface LoopOptions<S extends TSchema, TMessage> {
  schema: S;
  messages: readonly TMessage[];
  tools: readonly StructuredModelTool[];
  toolLimit: number;
  attempts: 1 | 2;
  output: StructuredToolDefinition;
  complete: (request: {
    messages: readonly TMessage[];
    tools: readonly StructuredToolDefinition[];
    correction: boolean;
  }) => Promise<StructuredToolResponse<TMessage>>;
  appendToolResult: (call: StructuredToolCall, content: string, isError: boolean) => TMessage;
  redactToolArguments: (message: TMessage, calls: readonly StructuredToolCall[]) => TMessage;
}

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
  /(?:api[_-]?key|access[_-]?key|token|secret|password|credential|authorization|cookie)/i;
const issueLabel: Partial<Record<ValueErrorType, string>> = {
  [ValueErrorType.ArrayMaxItems]: 'too many items',
  [ValueErrorType.ArrayMinItems]: 'too few items',
  [ValueErrorType.Array]: 'expected an array',
  [ValueErrorType.Boolean]: 'expected a boolean',
  [ValueErrorType.Integer]: 'expected an integer',
  [ValueErrorType.IntersectUnevaluatedProperties]: 'unexpected field',
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

function schemaReasons<S extends TSchema>(schema: S, value: unknown) {
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

function schemaCorrection(reasons: readonly string[]) {
  return `model_invalid_output: the structured result violated these constraints: ${reasons.join('; ')}. Correct only the reported fields; do not repeat rejected values or include secrets.`;
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

function stripBlankOptionalFields(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripBlankOptionalFields(item, depth + 1));
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      optionalBlankFields.has(key) &&
      (entry === null || (typeof entry === 'string' && !entry.trim()))
    ) {
      continue;
    }
    cleaned[key] = stripBlankOptionalFields(entry, depth + 1);
  }
  return cleaned;
}

function boundedResult(result: unknown) {
  try {
    const content = typeof result === 'string' ? result : JSON.stringify(result);
    return content && content.length <= 2048
      ? { content, isError: false }
      : { content: 'Tool result was empty or exceeded the safe output limit.', isError: true };
  } catch {
    return { content: 'Tool result could not be serialized safely.', isError: true };
  }
}

export async function runStructuredModelLoop<S extends TSchema, TMessage>(
  options: LoopOptions<S, TMessage>,
): Promise<
  { value: Static<S>; toolCallsUsed: number } | { invalidReasons: string[]; toolCallsUsed: number }
> {
  const messages = [...options.messages];
  let toolCallsUsed = 0;
  let invalidOutputs = 0;
  let invalidReasons = ['expected one final structured result'];

  for (let request = 0; request < options.attempts + options.toolLimit; request++) {
    const tools = [
      options.output,
      ...(toolCallsUsed < options.toolLimit
        ? options.tools.map(({ name, description, parameters }) => ({
            name,
            description,
            parameters,
          }))
        : []),
    ];
    const response = await options.complete({
      messages,
      tools,
      correction: invalidOutputs > 0,
    });
    const [call, extra] = response.calls;
    if (response.stopReason === 'toolUse' && call?.name === options.output.name && !extra) {
      const wrapped =
        Object.hasOwn(call.arguments, 'value') && Object.keys(call.arguments).length === 1;
      const candidate = stripBlankOptionalFields(wrapped ? call.arguments.value : call.arguments);
      if (Value.Check(options.schema, candidate)) {
        return { value: candidate, toolCallsUsed };
      }
      invalidReasons = wrapped
        ? schemaReasons(options.schema, candidate)
        : ['emit_result must contain only the required value field'];
      messages.push(response.message);
      messages.push(options.appendToolResult(call, schemaCorrection(invalidReasons), true));
      invalidOutputs++;
      if (invalidOutputs >= options.attempts) return { invalidReasons, toolCallsUsed };
      continue;
    }

    if (response.stopReason === 'toolUse' && response.calls.length > 0) {
      messages.push(options.redactToolArguments(response.message, response.calls));
      for (const invocation of response.calls) {
        const tool = options.tools.find(({ name }) => name === invocation.name);
        if (invocation.name === options.output.name) {
          messages.push(
            options.appendToolResult(
              invocation,
              'Return the structured result separately, after any other tool calls.',
              true,
            ),
          );
        } else if (tool && toolCallsUsed < options.toolLimit) {
          toolCallsUsed++;
          try {
            const result = boundedResult(await tool.run(invocation.arguments));
            messages.push(options.appendToolResult(invocation, result.content, result.isError));
          } catch {
            messages.push(
              options.appendToolResult(
                invocation,
                'Tool execution failed; details were withheld.',
                true,
              ),
            );
          }
        } else {
          messages.push(
            options.appendToolResult(
              invocation,
              tool ? 'The tool-call limit is exhausted.' : 'This tool is not available.',
              true,
            ),
          );
        }
      }
      continue;
    }

    messages.push(response.message);
    invalidReasons = ['expected one final structured emit_result call'];
    invalidOutputs++;
    if (invalidOutputs >= options.attempts) return { invalidReasons, toolCallsUsed };
  }
  return { invalidReasons, toolCallsUsed };
}
