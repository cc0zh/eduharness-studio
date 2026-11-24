import type { Static, TSchema } from '@sinclair/typebox';
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
): Promise<{ value: Static<S>; toolCallsUsed: number } | undefined> {
  const messages = [...options.messages];
  let toolCallsUsed = 0;
  let invalidOutputs = 0;

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
      const value: unknown = call.arguments.value;
      if (
        Object.hasOwn(call.arguments, 'value') &&
        Object.keys(call.arguments).length === 1 &&
        Value.Check(options.schema, value)
      ) {
        return { value, toolCallsUsed };
      }
      messages.push(response.message);
      messages.push(
        options.appendToolResult(
          call,
          'The structured result did not match the required schema. Correct it without exposing sensitive data.',
          true,
        ),
      );
      invalidOutputs++;
      if (invalidOutputs >= options.attempts) return undefined;
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
    invalidOutputs++;
    if (invalidOutputs >= options.attempts) return undefined;
  }
  return undefined;
}
