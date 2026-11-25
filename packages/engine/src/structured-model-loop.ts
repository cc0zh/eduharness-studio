import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { StructuredModelTool } from './structured-model.js';
import {
  hasSensitiveFields,
  schemaReasons,
  sensitiveOutputReason,
  stripBlankOptionalFields,
} from './structured-model-output.js';

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
  rejectedSubmission = false,
): TMessage {
  if (message.role !== 'assistant' || typeof message.content === 'string') return message;
  const callIds = new Set(calls.map(({ id }) => id));
  const secretArgument = /(?:key|token|secret|password|credential|authorization|cookie)/i;
  return {
    ...message,
    content: message.content.flatMap((part) => {
      if (part.type !== 'toolCall' || !part.id || !callIds.has(part.id) || !part.arguments)
        return rejectedSubmission ? [] : [part];
      return {
        ...part,
        arguments: rejectedSubmission
          ? {}
          : Object.fromEntries(
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
  normalizeOutput?: (value: unknown) => unknown;
  reflectsCredential: (value: unknown) => boolean;
  output: StructuredToolDefinition;
  complete: (request: {
    messages: readonly TMessage[];
    tools: readonly StructuredToolDefinition[];
    correction: boolean;
  }) => Promise<StructuredToolResponse<TMessage>>;
  appendToolResult: (call: StructuredToolCall, content: string, isError: boolean) => TMessage;
  redactToolArguments: (
    message: TMessage,
    calls: readonly StructuredToolCall[],
    rejectedSubmission?: boolean,
  ) => TMessage;
}

function schemaCorrection(reasons: readonly string[]) {
  return `model_invalid_output: the structured result violated these constraints: ${reasons.join('; ')}. Correct only the reported fields; do not repeat rejected values or include secrets.`;
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
  let toolRoundsLeft = options.toolLimit;
  let invalidOutputs = 0;
  let invalidReasons = ['expected one final structured result'];

  // Tool exchanges never consume a submission. Once exhausted, only emit_result is offered.
  while (invalidOutputs < options.attempts) {
    const useTools = toolRoundsLeft > 0 && toolCallsUsed < options.toolLimit;
    const tools = [
      options.output,
      ...(useTools
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
    if (options.reflectsCredential(response.message)) {
      invalidReasons = [sensitiveOutputReason];
      invalidOutputs++;
      continue;
    }
    if (response.stopReason === 'toolUse' && call?.name === options.output.name && !extra) {
      const wrapped =
        Object.hasOwn(call.arguments, 'value') && Object.keys(call.arguments).length === 1;
      const sensitive = hasSensitiveFields(call.arguments);
      const candidate = (options.normalizeOutput ?? stripBlankOptionalFields)(
        wrapped ? call.arguments.value : call.arguments,
      );
      const valid = Value.Check(options.schema, candidate);
      if (!sensitive && valid) {
        return { value: candidate, toolCallsUsed };
      }
      invalidReasons = wrapped
        ? schemaReasons(options.schema, candidate)
        : ['emit_result must contain only the required value field'];
      if (sensitive && !invalidReasons.some((reason) => reason.includes('[sensitive-field]'))) {
        invalidReasons = [sensitiveOutputReason, ...invalidReasons];
      }
      invalidOutputs++;
      if (invalidOutputs < options.attempts) {
        messages.push(options.redactToolArguments(response.message, [call], true));
        messages.push(options.appendToolResult(call, schemaCorrection(invalidReasons), true));
      }
      continue;
    }

    if (useTools && response.stopReason === 'toolUse' && response.calls.length > 0) {
      toolRoundsLeft--;
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

    invalidReasons = ['expected one final structured emit_result call'];
    invalidOutputs++;
  }
  return { invalidReasons, toolCallsUsed };
}
