import type { Foundation, IntakeAnswers, LearningGoal } from './intake.js';
import type { CourseBlueprint, LessonRef } from './protocol.js';

type LessonPlan = Pick<LessonRef, 'depth' | 'title' | 'summary'>;
type UnitPlan = { title: string; lessons: LessonPlan[] };

export interface CourseSummary {
  id: string;
  title: string;
  topic: string;
  summary: string;
  unitTitles: string[];
  lessonCount: number;
  kind: 'demo' | 'generated';
}

export interface LessonEntry {
  courseId: string;
  lessonId: string;
}

export function assembleBlueprint(
  course: Pick<CourseBlueprint, 'id' | 'title' | 'topic'>,
  plan: UnitPlan[],
): CourseBlueprint {
  return {
    ...course,
    units: plan.map((unit, u) => ({
      id: `u${u + 1}`,
      title: unit.title,
      lessons: unit.lessons.map((lesson, l) => ({
        ...lesson,
        id: `u${u + 1}-l${l + 1}`,
        status: u === 0 && l === 0 ? 'ready' : 'locked',
      })),
    })),
  };
}

function startingUnits(topic: string, foundation: Foundation, note: string): UnitPlan[] {
  if (foundation === 'experienced') return [];

  const lessons: LessonPlan[] = [
    {
      title: `${topic}：从一个例子起步`,
      summary: note
        ? `从你提到的「${note}」切入，找一个熟悉的例子。`
        : '从一个熟悉的例子出发，看看这个主题能解决什么。',
      depth: 'intuition',
    },
  ];
  if (foundation === 'beginner') {
    lessons.push({
      title: '补齐先备知识',
      summary: '辨认学习这个主题前需要理解的概念，用小问题检查基础。',
      depth: 'definition',
    });
  }
  return [{ title: foundation === 'beginner' ? '建立直觉' : '衔接已有基础', lessons }];
}

function goalUnits(goal: LearningGoal, note: string): UnitPlan[] {
  const useNote = (summary: string) =>
    note ? `${summary} 围绕你的目标「${note}」来检验。` : summary;
  if (goal === 'understand') {
    return [
      {
        title: '检验理解',
        lessons: [
          {
            title: '用自己的话复述',
            summary: useNote('从一个新例子中辨认核心概念，说明它和相近概念的区别。'),
            depth: 'application',
          },
        ],
      },
    ];
  }
  if (goal === 'apply') {
    return [
      {
        title: '动手用一次',
        lessons: [
          {
            title: '拆解一个典型任务',
            summary: '把问题分成已知、未知与可验证的步骤。',
            depth: 'application',
          },
          {
            title: '独立完成并验收',
            summary: useNote('把方法迁移到一个新任务，检查解法是否可靠。'),
            depth: 'application',
          },
        ],
      },
    ];
  }
  return [
    {
      title: '理解为什么',
      lessons: [
        {
          title: '从前提推出结论',
          summary: '逐条检查推理依赖的假设，解释每个关键步骤。',
          depth: 'derivation',
        },
      ],
    },
    {
      title: '辨认边界与反例',
      lessons: [
        {
          title: '找一个不适用的情况',
          summary: '改变一个条件，观察方法何时失效。',
          depth: 'theory',
        },
        {
          title: '向别人讲清楚',
          summary: useNote('用例子和反例讲清原理、条件与限制。'),
          depth: 'application',
        },
      ],
    },
  ];
}

export function generateBlueprint(id: string, answers: IntakeAnswers): CourseBlueprint {
  const topic = answers.topic.trim();
  const foundationNote = answers.foundationNote?.trim() ?? '';
  return assembleBlueprint({ id, topic, title: `${topic} · 学习路线` }, [
    ...startingUnits(topic, answers.foundation, foundationNote),
    {
      title: '掌握核心概念',
      lessons: [
        {
          title: `${topic}：拆解核心概念`,
          summary:
            answers.foundation === 'experienced' && foundationNote
              ? `以你已有的经验「${foundationNote}」为起点，辨认关键定义与适用条件。`
              : '给关键词下定义，分清哪些条件必不可少。',
          depth: 'definition',
        },
        {
          title: '串起概念之间的关系',
          summary: '用一个典型例子解释关键概念是怎样连起来的。',
          depth: 'derivation',
        },
      ],
    },
    ...goalUnits(answers.goal, answers.goalNote?.trim() ?? ''),
  ]);
}
