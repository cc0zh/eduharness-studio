import assert from 'node:assert/strict';
import { createFauxModelGateway, fauxAssistantMessage, fauxToolCall } from '../src/models.js';
import type { Action } from '../src/protocol.js';
import type { TeacherTurnContext, TeacherTurnOutput } from '../src/teacher.js';

export const openingContext: TeacherTurnContext = {
  topic: '奇偶性',
  input: { kind: 'opening' },
  keypoints: [
    { id: 'pairs', title: '配对', objective: '理解配对', depth: 'intuition', status: 'active' },
    { id: 'sum', title: '和', objective: '应用奇偶性', depth: 'application', status: 'pending' },
  ],
  state: 'intake',
  played: [],
  progress: { insertedCount: 0, lowEffortStreak: 0, highWater: 0, truncatedCardIds: [] },
  generation: 1,
  seed: 'scene-test',
};

export function scene(
  status: TeacherTurnOutput['diagnosis']['status'] = 'opening',
): TeacherTurnOutput {
  return {
    diagnosis: { status, summary: '观察配对', strategy: '换例子推断' },
    panels: [
      {
        title: '积木',
        content: '让积木两两站在一起。',
        highlight: '两两',
        voiceover: '想象桌面上有五块积木。',
      },
    ],
    next_ask: { prompt: '桌上会有什么？', options: ['恰好成对', '剩下一个'] },
  };
}

export const transferAsk: Action = {
  type: 'ask',
  mode: 'open',
  checkpoint: 'verify',
  step_id: 10,
  card_id: 'prior-question',
  prompt: '换成七块如何配对？',
};
export const verifiedContext: TeacherTurnContext = {
  ...openingContext,
  state: 'handoff',
  played: [transferAsk],
  input: { kind: 'answer', ask_step_id: 10, text: '三对，剩一块。' },
  progress: { ...openingContext.progress, highWater: 10 },
};
export const answeredContext: TeacherTurnContext = {
  ...verifiedContext,
  played: [{ ...transferAsk, checkpoint: undefined }],
};

export const masteredScene: TeacherTurnOutput = {
  ...scene('mastered'),
  resolution: { text: '三对后确实剩一块。', conclusion: ' 两两配对后\n仍有剩余的数是奇数。 ' },
  next_ask: { prompt: '两堆拼在一起会怎样？' },
};

export const fauxNativeCall = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });

export const fauxResult = (value: Parameters<typeof fauxToolCall>[1]['value']) =>
  fauxNativeCall('emit_result', { value });

export function offeredToolNames(
  messages: readonly {
    role: string;
    toolsAdded?: readonly { name: string }[];
    toolsRemoved?: readonly { name: string }[];
  }[],
) {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'system') continue;
    for (const { name } of message.toolsRemoved ?? []) names.delete(name);
    for (const { name } of message.toolsAdded ?? []) names.add(name);
  }
  return [...names];
}

export function localFaux(key = 'faux-engine-test-key') {
  const faux = createFauxModelGateway();
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: key }));
  return faux;
}
