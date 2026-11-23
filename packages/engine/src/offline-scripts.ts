import { cacheLesson, distanceLesson } from './demo-scripts.js';
import { compileLesson, type LessonScript, type ScriptSection } from './lesson-playback.js';
import type { CourseBlueprint, LessonRef } from './protocol.js';

export function offlineLesson(course: CourseBlueprint, lesson: LessonRef): LessonScript {
  if (course.id === 'demo-point-line-distance') return distanceLesson();
  if (course.id === 'demo-http-cache') return cacheLesson();

  // The persisted blueprint encodes the foundation and goal choices, including for pre-M1-2 courses.
  const lessons = course.units.flatMap((unit) => unit.lessons);
  const count = Math.max(2, Math.min(6, lessons.length - 1));
  const outline = [
    ['选一个切入点', lesson.summary, lesson.depth, `学习主题：${course.topic}\n${lesson.summary}`],
    [
      '分清概念和例子',
      '先用自己的话说清一个定义。',
      'definition',
      '把关键词和例子分开写。换一个例子后，哪些特征必须保留？',
    ],
    [
      '连接两个概念',
      '解释一个条件改变后会发生什么。',
      'derivation',
      '选两个关键词，用一句「因为……所以……」把它们连起来。',
    ],
    [
      '列出可验证的步骤',
      '把理解用在一个小任务里。',
      'application',
      '写下输入、操作、预期结果；先只改一个条件，再对照结果。',
    ],
    [
      '检查适用前提',
      '识别方法在哪些条件下有效。',
      'theory',
      '逐条列出你刚才默认的条件，挑一条试着去掉。',
    ],
    [
      '用反例复述',
      '用反例说清适用边界。',
      'application',
      '比较一个适用的例子和一个不适用的例子，说清差异。',
    ],
  ] as const;

  return compileLesson(
    outline.slice(0, count).map(
      ([title, objective, depth, content], i): ScriptSection => ({
        id: `focus-${i + 1}`,
        title,
        objective,
        depth,
        beats: [
          ...(i === 1 ? [{ type: 'new_column', column: 2 } as const] : []),
          {
            type: 'board',
            column: i === 0 ? 1 : 2,
            card_id: `note-${i + 1}`,
            title,
            depth,
            content,
          },
          {
            type: 'speak',
            text:
              i === 0 ? `我们先从「${course.topic}」的一个具体情境开始。${objective}` : objective,
          },
          ...(i === count - 1
            ? [
                {
                  type: 'ask',
                  card_id: 'apply-check',
                  mode: 'open',
                  prompt: `用你自己的话说一说，准备怎样检验对「${course.topic}」的理解？`,
                } as const,
              ]
            : []),
        ],
      }),
    ),
  );
}
