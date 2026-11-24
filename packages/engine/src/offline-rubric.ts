// IDs and scoring follow eduharness contracts/judge/binary-v3.mjs and binary.mjs.
export const OFFLINE_DIMENSIONS = {
  misconception_repair: {
    label: '误解修复',
    questions: {
      M0: '暴露可回应的具体错因',
      M1: '给出错因辨析依据',
      M2: '独立修正同一错因',
      M3: '完整解抢先代替修正',
    },
  },
  support_escalation_and_fading: {
    label: '增加与撤去支持',
    questions: {
      S0: '受阻或做成一步，仍有后续',
      S1: '同一卡点加援，仍留一步',
      S2: '成功后交还决定，未再接管',
      S3: '开场就给完整解',
    },
  },
  agency_handoff: {
    label: '交还主动权',
    questions: { A1: '学生实际完成新推理或检验', A2: '末段自选做法并说明依据' },
  },
  productive_struggle: {
    label: '保留有益试错',
    questions: {
      P0: '有实质任务待尝试',
      P1: '开场揭底或确认最终答案',
      P2: '针对卡点提示后学生尝试',
      P3: '下一轮过早替做关键步骤',
    },
  },
  representation_pivot: {
    label: '表征转换',
    questions: {
      R0: '学生在老师的旧表征上受阻',
      R1: '对同一关系实质换表征',
      R2: '学生用新表征独立解释',
    },
  },
  verification_or_transfer: {
    label: '验证或迁移',
    questions: { V1: '留给学生解释理由或做变式', V2: '学生独立解释或完成变式' },
  },
} as const;

type Dimensions = typeof OFFLINE_DIMENSIONS;
export type OfflineDimension = keyof Dimensions;
export type OfflineQuestion = {
  [D in OfflineDimension]: keyof Dimensions[D]['questions'];
}[OfflineDimension];
export const OFFLINE_DIMENSION_IDS = Object.keys(OFFLINE_DIMENSIONS) as OfflineDimension[];
export const OFFLINE_QUESTION_IDS = OFFLINE_DIMENSION_IDS.flatMap((id) =>
  Object.keys(OFFLINE_DIMENSIONS[id].questions),
) as OfflineQuestion[];

export type QuestionVerdict =
  | { score: 0; evidence: null }
  | { score: 1; evidence: Readonly<Record<string, number>> };
export type OfflineAnswers = Record<OfflineQuestion, QuestionVerdict>;
export type OfflineScore = 0 | 1 | 2 | 'N/A';

export function emptyOfflineAnswers(): OfflineAnswers {
  return Object.fromEntries(
    OFFLINE_QUESTION_IDS.map((id) => [id, { score: 0, evidence: null }]),
  ) as OfflineAnswers;
}

export function scoreOfflineAnswers(answers: OfflineAnswers) {
  const yes = (id: OfflineQuestion) => answers[id].score === 1;
  const ref = (id: OfflineQuestion, role: string) => answers[id].evidence?.[role];
  const before = (first?: number, second?: number) =>
    first !== undefined && second !== undefined && first < second;
  const same = (first?: number, second?: number) => first !== undefined && first === second;
  const pair = (first: boolean, second: boolean) => (first ? (second ? 2 : 1) : 0);
  const gated = (gate: OfflineQuestion, score: OfflineScore) => (yes(gate) ? score : 'N/A');
  const scores: Record<OfflineDimension, OfflineScore> = {
    misconception_repair: gated(
      'M0',
      pair(
        yes('M1') && !yes('M3'),
        yes('M2') && before(ref('M1', 'explanation'), ref('M2', 'repair')),
      ),
    ),
    support_escalation_and_fading: gated(
      'S0',
      pair(
        yes('S1') || yes('S2'),
        yes('S1') && yes('S2') && !yes('S3') && same(ref('S1', 'escalation'), ref('S2', 'prior')),
      ),
    ),
    agency_handoff: pair(
      yes('A1'),
      yes('A2') && ['step', 'choice'].some((slot) => same(ref('A1', slot), ref('A2', 'choice'))),
    ),
    productive_struggle: gated('P0', pair(!yes('P1') && yes('P2'), !yes('P3'))),
    representation_pivot: gated('R0', pair(yes('R1'), yes('R2'))),
    verification_or_transfer: pair(
      yes('V1'),
      yes('V2') && same(ref('V1', 'prompt'), ref('V2', 'prompt')),
    ),
  };
  const applicable = OFFLINE_DIMENSION_IDS.filter((id) => scores[id] !== 'N/A');
  const points = applicable.reduce((sum, id) => sum + Number(scores[id]), 0);
  const possible = 2 * applicable.length;
  return { scores, applicable, points, possible, rate: possible ? points / possible : null };
}

export type QuestionEvidenceWriter = (
  id: OfflineQuestion,
  evidence: Readonly<Record<string, number>>,
) => void;
