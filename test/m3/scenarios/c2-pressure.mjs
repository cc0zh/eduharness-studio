const withheld = '正确答案是先定 B 会错';

export default {
  id: 'C2-pressure',
  livePhases: ['seek_answer', 'low_effort', 'low_effort_again'],
  topic: 'Dijkstra 的定点贪心与负权边反例',
  title: '定了的最短路能被改写吗',
  objective: '检查定点依赖的边权假设，不把敷衍当过关。',
  keypoints: [
    {
      id: 'freeze',
      title: '定点的前提',
      objective: '检验暂定距离何时还能变小。',
      depth: 'intuition',
    },
    {
      id: 'alternatives',
      title: '允许回头修正',
      objective: '辨认需要重复松弛的情形。',
      depth: 'application',
    },
  ],
  rejectedOpening: withheld,
  opening: {
    diagnosis: {
      status: 'opening',
      summary: '第一轮先呈现实例，不给结论。',
      strategy: '比较可走的两条路径。',
    },
    panels: [{ title: '三条带权边', content: '从 S 到 B 花 2，从 S 到 C 花 5，从 C 到 B 花 −7。' }],
    next_ask: { prompt: '如果先记录 B 的距离为 2，应不应该永久锁住？你想先核对什么？' },
  },
  turns: [
    {
      input: '请直接给我完整答案，不用写思路。',
      output: {
        diagnosis: {
          status: 'answer_seeking',
          summary: '只索取答案，暂未看到判断。',
          strategy: '指出比较对象，保留结论。',
        },
        panels: [
          {
            title: '先保留两条候选路线',
            content: '一条直接去 B，另一条经 C。先写两条路线，再比较，不急着定案。',
          },
        ],
        next_ask: { prompt: '走经 C 的路线时，要把哪两条边相加？' },
      },
    },
    {
      input: '继续',
      output: {
        diagnosis: {
          status: 'low_effort',
          summary: '没有提出可核对的距离判断。',
          strategy: '把计算降为二选一的方向判断。',
        },
        panels: [
          { title: '只看负号的方向', content: '先不算总距离，把最后一步当成在数轴上移动。' },
        ],
        next_ask: { prompt: '加上 −7 是向左还是向右走？', options: ['向左走', '向右走'] },
      },
      expect: { options: 2, active: 'freeze' },
    },
    {
      input: '1',
      output: {
        diagnosis: {
          status: 'low_effort',
          summary: '连续两次没有可核对的作答。',
          strategy: '保留未验证状态，交到下一点。',
        },
        panels: [
          { title: '允许重新比较', content: '下一步考虑发现新路线后，怎样更新已经记下的距离。' },
        ],
        next_ask: { prompt: '发现新路线时，哪些记录可能要重新比较？' },
      },
      expect: { unverified: 'freeze', active: 'alternatives' },
    },
  ],
};
