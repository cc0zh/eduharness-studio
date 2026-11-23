import { type Static, Type } from '@sinclair/typebox';

export const INTAKE_LIMITS = { topic: 80, note: 160 } as const;

const topic = Type.String({ maxLength: INTAKE_LIMITS.topic, pattern: '\\S' });
const note = Type.Optional(Type.String({ maxLength: INTAKE_LIMITS.note }));
const foundation = Type.Union([
  Type.Literal('beginner'),
  Type.Literal('familiar'),
  Type.Literal('experienced'),
]);
const goal = Type.Union([
  Type.Literal('understand'),
  Type.Literal('apply'),
  Type.Literal('explain'),
]);
const foundationFields = { topic, foundation, foundationNote: note };
const strict = { additionalProperties: false };

export const IntakeStartSchema = Type.Object({ topic }, strict);
export const IntakeNextSchema = Type.Object(foundationFields, strict);
export const IntakeGenerateSchema = Type.Object(
  { ...foundationFields, goal, goalNote: note },
  strict,
);

export type IntakeStart = Static<typeof IntakeStartSchema>;
export type IntakeNext = Static<typeof IntakeNextSchema>;
export type IntakeAnswers = Static<typeof IntakeGenerateSchema>;
export type Foundation = IntakeAnswers['foundation'];
export type LearningGoal = IntakeAnswers['goal'];

interface Question<Value> {
  prompt: string;
  options: { value: Value; label: string }[];
  noteLabel: string;
  noteExample: string;
}

export interface FoundationStep extends Question<Foundation> {
  topic: string;
}

export type GoalStep = Question<LearningGoal>;

export function startIntake(input: IntakeStart): FoundationStep {
  return {
    topic: input.topic.trim(),
    prompt: '你对这个主题有多少了解？',
    options: [
      { value: 'beginner', label: '我是初学者' },
      { value: 'familiar', label: '听过一些概念' },
      { value: 'experienced', label: '有实践经验' },
    ],
    noteLabel: '补充你的基础',
    noteExample: '例如：看过入门资料，但没做过练习',
  };
}

export function nextIntake(input: IntakeNext): GoalStep {
  return {
    prompt:
      input.foundation === 'experienced'
        ? '你想在已有基础上做到什么？'
        : '学完后，你最想做到什么？',
    options: [
      { value: 'understand', label: '弄懂核心概念' },
      { value: 'apply', label: '解决实际问题' },
      { value: 'explain', label: '讲清原理与边界' },
    ],
    noteLabel: '补充你的目标',
    noteExample: '例如：想把它用到手上的项目里',
  };
}
