const unplayed = '四次沿坡的更新表';

export default {
  id: 'C3-interrupt',
  livePhases: ['interrupt'],
  topic: '梯度下降：学习率与越过极小值',
  title: '为什么沿着下坡也会走过头',
  objective: '按已上屏内容解释梯度方向与步长是两个问题。',
  keypoints: [
    {
      id: 'overshoot',
      title: '跨过谷底',
      objective: '用一维例子追踪一次更新。',
      depth: 'intuition',
    },
    {
      id: 'stability',
      title: '稳定的步长',
      objective: '区分振荡收敛和振荡发散。',
      depth: 'application',
    },
  ],
  opening: {
    diagnosis: {
      status: 'opening',
      summary: '先站在抛物线斜坡上。',
      strategy: '分开讨论方向与位移。',
    },
    panels: [
      {
        title: '沿抛物线往谷底走',
        content: '在函数 x² 上从 x=2 出发，当前位置梯度为 4，下降方向朝左。',
      },
      { title: unplayed, content: '这是下一块板书：依次记录四次更新前后的位置。' },
    ],
    next_ask: { prompt: '你会怎样用四次更新表辨认振荡？' },
  },
  cut: { anchor: '沿抛物线往谷底走', unplayed, reply: '方向正确也会跨过谷底' },
  turns: [
    {
      kind: 'interrupt',
      input: '斜坡越陡梯度越大，步长越大不就应该更快到谷底吗？',
      output: {
        diagnosis: {
          status: 'misconception',
          summary: '把局部的下坡方向当成走多远的依据。',
          strategy: '从刚上屏的 x=2 和梯度 4 代入。',
        },
        panels: [
          {
            title: '方向正确也会跨过谷底',
            content: '沿刚才 x=2 的左向走：学习率取 1.5，一步就是 6，落到 −4，比原处离 0 更远。',
            voiceover: '局部坡度只给方向线索，步子超过到谷底的距离，就会落在另一边。',
          },
        ],
        next_ask: { prompt: '仍从 x=2 出发，把学习率改成 0.25，落点在谷底哪边？' },
      },
    },
  ],
};
