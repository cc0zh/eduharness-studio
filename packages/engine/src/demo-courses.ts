import { assembleBlueprint } from './blueprints.js';
import type { CourseBlueprint } from './protocol.js';

export const BAYES_DEMO_ID = 'demo-bayes';
export const TRANSFORMER_DEMO_ID = 'demo-transformer';

export const demoCourses: readonly CourseBlueprint[] = [
  assembleBlueprint(
    {
      id: BAYES_DEMO_ID,
      topic: '概率与统计',
      title: '条件概率与贝叶斯直觉',
    },
    [
      {
        title: '从报警样本到贝叶斯公式',
        lessons: [
          {
            title: '条件概率与贝叶斯直觉',
            summary: '检测器能认出八成贴标包裹。听到报警，包裹有贴标的概率也是八成吗？',
            depth: 'intuition',
          },
          {
            title: '用条件概率串起整棵树',
            summary: '沿着概率树算联合概率，再把不同路径合起来。',
            depth: 'derivation',
          },
        ],
      },
      {
        title: '用新证据更新判断',
        lessons: [
          {
            title: '收到两次报警怎么办？',
            summary: '区分独立和相关的证据，判断能否连续做两次更新。',
            depth: 'application',
          },
        ],
      },
    ],
  ),
  assembleBlueprint(
    {
      id: TRANSFORMER_DEMO_ID,
      topic: '深度学习',
      title: 'Transformer 自注意力机制',
    },
    [
      {
        title: '让词从上下文取信息',
        lessons: [
          {
            title: 'Transformer 自注意力机制',
            summary: '从「它」在看谁开始，沿 Q、K、V 看懂权重怎样变成新的词表示。',
            depth: 'intuition',
          },
          {
            title: '从单头到多头注意力',
            summary: '追踪多组投影各自的输出，以及如何把它们合并。',
            depth: 'definition',
          },
        ],
      },
      {
        title: '限制注意力的范围',
        lessons: [
          {
            title: '掩码怎样阻止偷看后文',
            summary: '在 softmax 前遮住不可见位置，理解因果掩码。',
            depth: 'application',
          },
          {
            title: '看懂长序列的计算代价',
            summary: '从两两打分的矩阵形状出发，理解序列越长为什么越贵。',
            depth: 'application',
          },
        ],
      },
    ],
  ),
];
