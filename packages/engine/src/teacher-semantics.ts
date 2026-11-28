import { KindGuard, type Static, type TSchema, Type } from '@sinclair/typebox';
import { DepthTagSchema } from './protocol.js';
import type { TeacherPacing } from './teacher-pacing.js';
import { TeacherDiagnosisSchema, teacherText as text } from './teacher-protocol.js';

const strict = { additionalProperties: false };
const GraphDraftSchema = Type.Object(
  {
    diagram_kind: Type.Union([
      Type.Literal('geometry'),
      Type.Literal('structure'),
      Type.Literal('distribution'),
    ]),
    description: text(240),
  },
  {
    ...strict,
    description:
      '至多一张板书可附配图需求。仅为不易用文字表达的几何位置、结构关系或概率分布配图。只描述已有关系、数据与标签，不写 SVG；正文需独立讲清楚，不在图里提前揭晓答案。若需逐字高亮正文，优先展示文字，不请求配图。',
  },
);
export type TeacherGraphDraft = Static<typeof GraphDraftSchema>;

const boardFields = {
  title: text(48, '短标题。'),
  content: text(280, '独立可读的正文，可用紧凑的 Markdown 对比表。'),
  formula: Type.Optional(text(140, '不带 $ 定界符的 LaTeX。')),
  highlight: Type.Optional(text(56, '逐字摘自这一分镜板书正文的短语。')),
  voiceover: Type.Optional(text(140, '随这一分镜讲的一句口语字幕，补充板书而非念稿。')),
};

const PanelSchema = Type.Object(
  { ...boardFields, diagram: Type.Optional(GraphDraftSchema) },
  strict,
);
const panelList = {
  minItems: 1,
  maxItems: 2,
  description: '按教学顺序先摆情境或误区，再给对照或推导。',
};

const insertKeypoint = Type.Object(
  {
    id: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,64}$' }),
    title: text(48),
    objective: text(140),
    depth: DepthTagSchema,
  },
  {
    ...strict,
    description: '仅在确有关键前置缺口（missing_prereq）时填写一个新要点；本轮改教该要点。',
  },
);

const resolution = Type.Object(
  { text: text(140, '说明过关依据的短字幕。'), conclusion: text(140, '独立可读的一行教学结论。') },
  {
    ...strict,
    description: '检查学生对已展示近迁移题的作答，仅当确实答对（mastered）时给出。',
  },
);

const askFields = {
  prompt: text(140, '直击决策、误区或边界条件的一个小问题。'),
  hint: Type.Optional(text(100, '不揭底的短提示。')),
};

function choices(two: boolean) {
  return Type.Array(text(56), {
    minItems: 2,
    maxItems: two ? 2 : 4,
    description: two
      ? '给简短、互斥的直觉判断，降低作答门槛。'
      : '给不同的可见选项文本，长度口吻接近，干扰项对应真实误解；开放题省略。',
  });
}

const transfer = Type.Optional(
  Type.Literal(true, {
    description:
      '仅在学生已显示基本理解且仍在教当前要点时设为 true；换数字、场景或边界条件出一道新近迁移题，不能重用已展示的问题。',
  }),
);

export const TeacherTurnOutputSchema = Type.Object(
  {
    diagnosis: TeacherDiagnosisSchema,
    insert_keypoint: Type.Optional(insertKeypoint),
    resolution: Type.Optional(resolution),
    panels: Type.Array(PanelSchema, panelList),
    next_ask: Type.Optional(
      Type.Object({ ...askFields, options: Type.Optional(choices(false)), transfer }, strict),
    ),
  },
  strict,
);
export type TeacherTurnOutput = Static<typeof TeacherTurnOutputSchema>;

export type TurnPhase =
  | 'opening'
  | 'answer'
  | 'verify'
  | 'interrupt'
  | 'first-low-effort'
  | 'unverified'
  | 'closing'
  | 'budget-close';
export interface TurnPolicy {
  phase: TurnPhase;
  schema: typeof TeacherTurnOutputSchema;
  pacing: TeacherPacing;
}

interface TurnFields {
  phase: TurnPhase;
  diagnoses: readonly TeacherTurnOutput['diagnosis']['status'][];
  insertKeypoint: boolean;
  resolution: boolean;
  transferAsk: boolean;
  diagram: boolean;
  nextAsk: 'required' | 'conditional' | 'omit';
}

export function defineTurnPolicy(policy: TurnFields, pacing: TeacherPacing): TurnPolicy {
  const binary = policy.phase === 'first-low-effort';
  const nextAsk = Type.Object(
    {
      ...askFields,
      options: binary ? choices(true) : Type.Optional(choices(false)),
      ...(policy.transferAsk ? { transfer } : {}),
    },
    {
      ...strict,
      description:
        policy.nextAsk === 'conditional'
          ? '自然交权的问题；仅在最后一个要点确实过关时省略。'
          : '用一个问题自然交权。',
    },
  );
  const schema = Type.Object(
    {
      diagnosis: Type.Object(
        {
          ...TeacherDiagnosisSchema.properties,
          summary: Type.String({ ...TeacherDiagnosisSchema.properties.summary, pattern: '\\S' }),
          strategy: Type.String({ ...TeacherDiagnosisSchema.properties.strategy, pattern: '\\S' }),
          status: Type.Union(policy.diagnoses.map((status) => Type.Literal(status))),
        },
        strict,
      ),
      ...(policy.insertKeypoint && !pacing.tight
        ? { insert_keypoint: Type.Optional(insertKeypoint) }
        : {}),
      ...(policy.resolution ? { resolution: Type.Optional(resolution) } : {}),
      panels: Type.Array(
        policy.diagram ? PanelSchema : Type.Omit(PanelSchema, ['diagram'], strict),
        {
          ...panelList,
          maxItems: pacing.tight ? 1 : panelList.maxItems,
        },
      ),
      ...(policy.nextAsk === 'omit'
        ? {}
        : { next_ask: policy.nextAsk === 'required' ? nextAsk : Type.Optional(nextAsk) }),
    },
    strict,
  );
  // The phase contract is a strict runtime subset of the semantic envelope.
  return {
    phase: policy.phase,
    schema: schema as unknown as typeof TeacherTurnOutputSchema,
    pacing,
  };
}

function shape(node: TSchema): string {
  if (KindGuard.IsLiteral(node)) return JSON.stringify(node.const);
  if (KindGuard.IsUnion(node)) return node.anyOf.map(shape).join(' | ');
  if (KindGuard.IsObject(node)) return '对象';
  if (KindGuard.IsArray(node)) {
    const count =
      node.minItems === node.maxItems ? `${node.minItems}` : `${node.minItems}–${node.maxItems}`;
    return `${count} 项列表（${shape(node.items)}）`;
  }
  if (KindGuard.IsString(node)) {
    return [
      '文本',
      ...(node.minLength === undefined ? [] : [`≥${node.minLength} 字`]),
      ...(node.maxLength === undefined ? [] : [`≤${node.maxLength} 字`]),
      ...(node.pattern ? [node.pattern === '\\S' ? '不可空白' : `匹配 ${node.pattern}`] : []),
    ].join('，');
  }
  return node.type;
}

export function describeTeacherTurn(policy: TurnPolicy): string {
  function fields(node: TSchema, path: string): string[] {
    if (KindGuard.IsArray(node)) return fields(node.items, `${path}[]`);
    if (!KindGuard.IsObject(node)) return [];
    return Object.entries(node.properties).flatMap(([name, child]) => {
      const key = path ? `${path}.${name}` : name;
      const optional = node.required?.includes(name) ? '' : '?';
      const instruction = child.description ? `；${child.description}` : '';
      return [`${key}${optional}：${shape(child)}${instruction}`, ...fields(child, key)];
    });
  }
  return `本轮输出字段骨架（? 可省略，[] 为数组项；不写未列出的字段）：\n${fields(policy.schema, '').join('\n')}`;
}
