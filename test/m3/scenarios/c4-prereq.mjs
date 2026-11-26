const prerequisite = {
  id: 'unknown',
  title: 'NULL 与未知判断',
  objective: '说明 NULL 参与比较为何得到 UNKNOWN。',
  depth: 'intuition',
};

export default {
  id: 'C4-prereq',
  topic: 'SQL LEFT JOIN：WHERE 与 ON 的过滤位置',
  title: '被 WHERE 丢掉的左表行',
  objective: '用三值逻辑解释外连接为什么可能看起来像内连接。',
  keypoints: [
    {
      id: 'filter',
      title: '连接后过滤',
      objective: '追踪无匹配的左表行过 WHERE 时的状态。',
      depth: 'definition',
    },
    {
      id: 'on',
      title: '移动过滤条件',
      objective: '比较同一条件写在 ON 或 WHERE 的结果。',
      depth: 'application',
    },
  ],
  opening: {
    diagnosis: {
      status: 'opening',
      summary: '呈现没有订单的顾客。',
      strategy: '找出行在哪一步消失。',
    },
    panels: [
      {
        title: '没有订单的顾客',
        content: '顾客表左连订单表，随后过滤 price > 0。假设小林没有订单。',
      },
    ],
    next_ask: { prompt: '小林那行经过连接和 WHERE 后会发生什么？' },
  },
  turns: [
    {
      input: '没订单就把 price 当 0 吧？我不懂 NULL 到底是零、假，还是根本不能比较。',
      liveAsk: { prompt: /(?=.*(?:订单|price|小林))(?=.*(?:WHERE|过滤))/i },
      output: {
        diagnosis: {
          status: 'missing_prereq',
          summary: '缺少 NULL 参与比较的三值逻辑。',
          strategy: '先不用连接，只看一条记录。',
        },
        insert_keypoint: prerequisite,
        panels: [
          {
            title: '记账簿里没有这个数',
            content: '空位表示不知道数值，并不是已经测到 0。先说比较结果是否能确定。',
          },
        ],
        next_ask: { prompt: '金额尚不知道时，能确定它大于 0 或不大于 0 吗？' },
      },
      expect: { inserted: prerequisite.id, active: prerequisite.id, pending: 'filter' },
    },
    {
      input: '不能确定。空位不是一个已经知道的数，所以两边都不能断言。',
      liveAsk: { prompt: /(?=.*(?:不知道|未知|缺失|NULL))(?=.*(?:比较|大于))/i },
      output: {
        diagnosis: {
          status: 'clarifying',
          summary: '已区分未知与零。',
          strategy: '换一个比较并加入 WHERE。',
        },
        panels: [
          {
            title: '只保留真的条件',
            content: 'WHERE 只选结果为 TRUE 的行；UNKNOWN 不是 FALSE，但同样不会入选。',
          },
        ],
        next_ask: {
          prompt: '若 score 是 NULL，WHERE score = 5 会保留这行吗？为什么？',
          transfer: true,
        },
      },
      expect: { checkpoint: 'verify', active: prerequisite.id, pending: 'filter' },
    },
    {
      input: '不保留。NULL 和 5 作等值比较返回 UNKNOWN，不是 TRUE；WHERE 只留 TRUE。',
      liveAsk: { checkpoint: 'verify', prompt: /(?=.*NULL)(?=.*WHERE)(?=.*=\s*5(?:\D|$))/i },
      output: {
        diagnosis: {
          status: 'mastered',
          summary: '迁移到等值比较并区分了筛选判据。',
          strategy: '回到原来的左表行。',
        },
        resolution: {
          text: '对，未知不等于假，但两者都不能通过 WHERE。',
          conclusion: 'NULL 与常量的普通比较是 UNKNOWN，WHERE 只保留 TRUE。',
        },
        panels: [
          {
            title: '回到小林的订单列',
            content: '无匹配时右表 price 是 NULL。现在按连接、比较、保留三个步骤追踪。',
          },
        ],
        next_ask: { prompt: '小林的 price > 0 会得到什么？最终能否留下这行？' },
      },
      expect: { complete: prerequisite.id, active: 'filter' },
    },
  ],
};
