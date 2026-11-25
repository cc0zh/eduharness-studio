// Course-planner fixtures use topic-specific plans, not the offline lesson generator.
export function countingScene(status) {
  return {
    diagnosis: {
      status,
      summary: status === 'opening' ? '先预测合并后的数量。' : '沿着学生的选择澄清推理。',
      strategy: '用已核对的算式构造直觉选项。',
    },
    panels: [
      {
        title: '先观察合并',
        content: '2 + 3 = ?',
        highlight: '2 + 3',
        voiceover: '把两组物件合在一起，再数一数。',
      },
    ],
    next_ask: { prompt: '两组合并后共有多少？', options: ['4 个', '5 个'] },
  };
}

export function firstLesson(counting) {
  if (counting)
    return {
      keypoints: [
        {
          id: 'group-sizes',
          title: '数出两组物件',
          objective: '分别数出物件数。',
          depth: 'intuition',
        },
        {
          id: 'merged-total',
          title: '核对合并总数',
          objective: '合并后重新计数。',
          depth: 'application',
        },
      ],
      opening: countingScene('opening'),
    };
  return {
    keypoints: [
      {
        id: 'thermometer',
        title: '辨认温度计读数',
        objective: '区分显示值和被测对象。',
        depth: 'intuition',
      },
      {
        id: 'conditions',
        title: '找出测温条件',
        objective: '判断读数是否已稳定。',
        depth: 'definition',
      },
      {
        id: 'compare',
        title: '复核温度变化',
        objective: '用同一测量条件比较两次温度。',
        depth: 'application',
      },
    ],
    opening: {
      diagnosis: {
        status: 'opening',
        summary: '先检查读数。',
        strategy: '比较刚插入和稳定后的温度。',
      },
      panels: [
        {
          title: '杯水的两次读数',
          content: '刚放入：21 ℃。等一分钟：24 ℃。',
          voiceover: '同一杯水，两个读数。',
        },
      ],
      next_ask: { prompt: '这两个读数能直接证明水变热了吗？' },
    },
  };
}
