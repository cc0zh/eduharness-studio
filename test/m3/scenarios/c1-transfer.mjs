const correction = {
  diagnosis: {
    status: 'misconception',
    summary: '把分组胜出当成了整体胜出。',
    strategy: '换一组数据检查权重。',
  },
  panels: [
    {
      title: '先数分子和分母',
      content: '合并时累加成功数、累加尝试数，再作除法。试先看两组尝试数是否对称。',
    },
  ],
  next_ask: {
    transfer: true,
    prompt: '换成两家店：X 是 9/10、15/50，Y 是 40/50、2/10。谁合计更高？为什么？',
  },
};

export default {
  id: 'C1-transfer',
  topic: '辛普森悖论：分组优劣为什么会在合并时翻转',
  title: '被分母改变的胜负',
  objective: '独立用组权重解释近迁移题的排名翻转。',
  keypoints: [
    {
      id: 'weighted',
      title: '按组权重合并',
      objective: '能由各组分子分母计算合计率。',
      depth: 'derivation',
    },
    {
      id: 'fair',
      title: '怎样公平比较',
      objective: '区分汇总描述与控制条件后的比较。',
      depth: 'application',
    },
  ],
  opening: {
    diagnosis: {
      status: 'opening',
      summary: '两种筛选方式的分组表。',
      strategy: '先让学生预测总排名。',
    },
    panels: [
      {
        title: '两组都赢，整体就赢吗',
        content: '简单题：甲 9/10、乙 80/100；困难题：甲 20/100、乙 1/10。',
      },
    ],
    next_ask: { prompt: '你预测合计谁高？两组都赢是否足以决定合计排名？' },
  },
  turns: [
    {
      input: '只要有一种方法在每组都占优，它的合计率就一定更高。',
      liveAsk: { prompt: /(?=.*(?:两组|分组))(?=.*(?:合计|总体|整体))/ },
      output: correction,
      expect: { checkpoint: 'verify', active: 'weighted' },
    },
    {
      input:
        'Y 更高：X 是 24/60，Y 是 42/60。X 多数记录来自 15/50 的组，合计按尝试数加权，不是把两组率平均。',
      liveAsk: {
        checkpoint: 'verify',
        prompt:
          /X\s*[是为:：]?\s*9\s*\/\s*10[、,，和及\s]+15\s*\/\s*50(?!\d).*Y\s*[是为:：]?\s*40\s*\/\s*50[、,，和及\s]+2\s*\/\s*10(?!\d)/iu,
      },
      calc: { expression: '(9 + 15) / (10 + 50)', result: '0.4' },
      output: {
        diagnosis: {
          status: 'mastered',
          summary: '独立比较了两个汇总分母与分子。',
          strategy: '转到同权重比较。',
        },
        resolution: {
          text: '你逐组累加，再解释了低比率组的大权重。',
          conclusion: '组内更高不保证合计更高；汇总率按各组尝试数加权。',
        },
        panels: [{ title: '切换成相同权重', content: '现在让两种方法面对完全相同的组别比例。' }],
        next_ask: { prompt: '如果两种方法用相同组权重，组内都高的还会翻转吗？' },
      },
      expect: { complete: 'weighted', active: 'fair' },
    },
  ],
};
