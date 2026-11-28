// Independent loopback teacher drafts, not inputs to the actual live student driver.
export const cutMarker = 'C3_UNPLAYED_BOARD_7B2E91';
export const cutAskMarker = 'C3_UNPLAYED_ASK_7B2E91';
export const privateDiagnosis = 'C3_OPENING_DIAGNOSIS_7B2E91';

const board = (title, content) => ({ title, content });
const ask = (prompt, extra) => ({ prompt, ...extra });
const transfer = (prompt) => ask(prompt, { transfer: true });
const point = (id, title, objective) => ({ id, title, objective, depth: 'intuition' });

function draft(status, panel, next, extra) {
  const panels = Array.isArray(panel) ? panel : [panel];
  return {
    diagnosis: { status, summary: panels[0].title, strategy: '围绕当前例子判断。' },
    panels,
    ...(next && { next_ask: next }),
    ...extra,
  };
}

const teach = (phase, reply, status, panel, next, extra) => ({
  phase,
  reply,
  output: draft(status, panel, next, extra),
});
const follow = (reply, panel, next) => teach('follow', reply, 'clarifying', panel, next);
const pass = (phase, reply, panel, next, conclusion) =>
  teach(phase, reply, 'mastered', panel, next, {
    resolution: { text: '你根据新题作出了判断并给出了理由。', conclusion },
  });

function fractions({ ask: { prompt } }) {
  return [...prompt.matchAll(/(\d+)\s*\/\s*(\d+)/g)].map(([, num, den]) => [
    Number(num),
    Number(den),
  ]);
}

function combine(view) {
  const [[a, a1], [b, b1], [c, c1], [d, d1]] = fractions(view);
  const higher = (a + c) / (a1 + c1) > (b + d) / (b1 + d1) ? 'A' : 'B';
  return `${higher} 更高：A 为 ${a + c}/${a1 + c1}，B 为 ${b + d}/${b1 + d1}。合并率按病例数加权。`;
}

function sameWeight(view) {
  const [[a, a1], [b, b1], [c, c1], [d, d1]] = fractions(view);
  const x = (a / a1 + c / c1) / 2;
  const y = (b / b1 + d / d1) / 2;
  return `${x > y ? 'A' : 'B'} 更高（${x.toFixed(2)} 对 ${y.toFixed(2)}）；两组权重相同就排除了构成差异。`;
}

function route({ ask: { prompt } }) {
  const [direct, first, second] = [...prompt.matchAll(/[-−]?\d+/g)].map(([n]) =>
    Number(n.replace('−', '-')),
  );
  const sum = first + second;
  return `绕路距离是 ${sum}，${sum < direct ? '小于' : '不小于'}直达的 ${direct}，应按更短的路线更新记录。`;
}

function descent({ ask: { prompt } }) {
  const [x, gradient, rate] = [...prompt.matchAll(/[-−]?\d+(?:\.\d+)?/g)].map(([n]) =>
    Number(n.replace('−', '-')),
  );
  const next = Number((x - gradient * rate).toFixed(6));
  return `落在 ${next}，${Math.abs(next) < Math.abs(x) ? '更接近' : '没有更接近'}谷底；用当前位置减去学习率乘梯度。`;
}

function joins({ ask: { prompt } }) {
  const counts = [...prompt.matchAll(/(\d+)\s*单/g)].map(([, n]) => Number(n));
  const inner = counts.reduce((sum, n) => sum + n, 0);
  const extra = counts.filter((n) => n === 0).length;
  return `INNER JOIN 有 ${inner} 行，LEFT JOIN 有 ${inner + extra} 行；每个没订单的左表用户只在外连接中保留一行。`;
}

export function liveLoopbackScenes(variant) {
  const slash = variant ? ' / ' : '/';
  return {
    'C1-transfer': {
      keypoints: [
        point('mix', '病例数如何改变总率', '按各组成功数与病例数合并。'),
        point('standard', '控制病例构成', '按同权重比较两个方案。'),
      ],
      // Exact question from live-02 (played step 11); it contains no “合计”.
      opening: draft(
        'opening',
        board(
          '肾结石：A 组处处赢，合并却输',
          '小结石：开放手术 81/87、经皮肾镜 234/270；大结石：开放手术 192/263、经皮肾镜 55/80。',
        ),
        ask('如果两位医生用的分组标准一致，但病人的轻重构成不同，合并成功率还能直接比吗？'),
      ),
      turns: [
        teach(
          'misconception',
          '能直接比吧？两位医生的分组标准一样，轻重构成不同不会改变总的判断。',
          'misconception',
          board('先看病例数', '病例较多的组对合并率的影响更大。'),
          transfer(
            `新病区：轻症 A ${19 - variant}${slash}20、B 91${slash}100；重症 A 10${slash}100、B 1${slash}20。谁的合并率更高？为什么？`,
          ),
        ),
        pass(
          'near_transfer',
          combine,
          board('固定病例构成', '让两种方案面对相同的轻症与重症权重。'),
          ask('这样比较得到的是原始人群的实际合并率吗？'),
          '合并率按各组病例数加权。',
        ),
        follow(
          '不是，固定组权重的结果对应同一种病例构成。',
          board('换一组来比较', '分别算两种方案的分组率，再用同样的组权重加总。'),
          transfer('同权重时：轻症 A 7/10、B 6/10；重症 A 2/10、B 1/10。谁的标准化率更高？'),
        ),
        pass(
          'follow',
          sameWeight,
          board('先说明比较口径', '标准化率与实际合并率回答的是不同的问题。'),
          undefined,
          '控制组权重后，组内一致的方向不会翻转。',
        ),
      ],
    },
    'C2-pressure': {
      keypoints: [
        point('tentative', '暂定距离与负边', '辨认距离还能变小的情形。'),
        point('compare', '候选路径的比较', '按两条路线的距离更新记录。'),
      ],
      opening: draft(
        'opening',
        board('暂定距离会不会被改写', '从 S 到 T 的直达边权为 6；经 U 的两段边权为 11 和 −8。'),
        ask('暂定 T 的距离为 6 后，能立刻永久锁定吗？'),
      ),
      turns: [
        teach(
          'seek_answer',
          '这条到 T 的路径题请直接告诉我答案，不用我自己推。',
          'answer_seeking',
          board('先保留候选路线', '把当前记录与仍可能到达的路线分开看。'),
          ask('走经 U 的路线要加哪两段边权？'),
        ),
        teach(
          'low_effort',
          '继续',
          'low_effort',
          board('先看最后一条边', '沿数轴想象这一步，不必重算整条路。'),
          ask('加负数会让累计距离怎样变化？', { options: ['变小', '变大'] }),
        ),
        teach(
          'low_effort_again',
          '1',
          'low_effort',
          board('重新比较记录', '看到一条新路线时，旧记录可以作为对照。'),
          ask('发现新路线后，要重新比较哪项记录？'),
        ),
        follow(
          '把新路线的累计距离与旧的暂定距离比较。',
          board('路线长度按边权累加', '不能只看哪条路线先被发现。'),
          transfer(`新图直达为 10；绕路两边分别为 ${14 + variant} 和 −9。绕路有多长，是否更新？`),
        ),
        pass(
          'follow',
          route,
          board('把候选距离与旧值比较', '只在新候选更短时更新记录。'),
          undefined,
          '负权边可能改写先前记录的最短距离。',
        ),
      ],
    },
    'C3-interrupt': {
      keypoints: [
        point('step', '方向不等于步长', '判断一步更新的位置。'),
        point('stable', '观察落点的稳定性', '比较更新前后到谷底的距离。'),
      ],
      opening: draft(
        'opening',
        [
          board('谷底在左边，步子走多大', '在 x² 上从 x=3 出发，当前位置梯度为 6，下降方向朝左。'),
          board(cutMarker, '下一块板书用更新表追踪后续位置。'),
        ],
        ask(`${cutAskMarker} 怎样用更新表判断是否越过谷底？`),
        {
          diagnosis: {
            status: 'opening',
            summary: privateDiagnosis,
            strategy: '分开看方向和步长。',
          },
        },
      ),
      turns: [
        teach(
          'interrupt',
          '在 x=3 这个位置，朝谷底走得更大步，为什么可能反而更远？',
          'misconception',
          board('方向正确不代表步长合适', '走过谷底以后，再向前就会离它更远。'),
          ask('从 x=3、梯度 6 出发，学习率 0.25，落点在哪里？'),
        ),
        follow(
          descent,
          board('把方向和位移分开', '梯度乘学习率给出本次位移，不能只根据斜坡判断落点。'),
          transfer('换到 x=−2、梯度 −4、学习率 0.2，更新后的落点在哪里？'),
        ),
        pass(
          'follow',
          descent,
          board('观察连续更新的轨迹', '相邻两步可能分别落在谷底两边。'),
          ask('如果更新点在两边来回跳，只看方向够吗？'),
          '梯度方向和位移大小是两个问题。',
        ),
        follow(
          '还要看每一步离谷底的距离是否变小。',
          board('比较更新前后', '相反的符号不一定代表更远。'),
          transfer(`从 x=4、梯度 8 出发，学习率 ${variant ? '0.5' : '0.1'}，落点向谷底靠近了吗？`),
        ),
        pass(
          'follow',
          descent,
          board('用落点检验步长', '方向正确时仍须观察与谷底的距离变化。'),
          undefined,
          '用更新轨迹判断是否稳定，不只看梯度方向。',
        ),
      ],
    },
    'C4-prereq': {
      keypoints: [
        point('rows', '无匹配行如何保留', '比较两个连接返回的行数。'),
        point('filter', '过滤的位置', '解释把条件写在 ON 与 WHERE 的差别。'),
      ],
      // Exact live-02 step 10 asks about INNER JOIN counts, not WHERE filters.
      opening: draft(
        'opening',
        board(
          'LEFT JOIN 保留无订单用户',
          '张三 2 单、李四 1 单、王五 0 单。LEFT JOIN 得 4 行，王五的订单列为 NULL。',
        ),
        ask('若把同样的两张表改成 INNER JOIN，行数会是多少？和 4 行的差从哪来？'),
      ),
      turns: [
        teach(
          'missing_prereq',
          '我常把 NULL 当成 0；王五没有订单时，右边的空值还能用来匹配吗？',
          'missing_prereq',
          board('空值不是零', 'NULL 表示没有已知数值，不是已经读到一个零。'),
          ask('有一笔订单金额未知，能确定大于零吗？'),
          { insert_keypoint: point('unknown', 'NULL 和未知', '解释含空值比较的结果。') },
        ),
        follow(
          '不能确定，未知不等于零，不能给出真或假的判断。',
          board('只筛出真的行', 'WHERE 只保留条件为 TRUE 的记录。'),
          transfer(`若金额是 NULL，WHERE amount > ${12 + variant} 会留下该行吗？`),
        ),
        pass(
          'follow',
          '不会。比较得到 UNKNOWN，不是 TRUE，无法通过 WHERE。',
          board('把比较带回连接', '王五的右表列为空因为没有订单。'),
          ask('因此，改用 INNER JOIN 为什么少了一行？'),
          '含 NULL 的普通比较为 UNKNOWN。',
        ),
        follow(
          '王五无法匹配；内连接只由匹配的订单产生结果行。',
          board('比较另一批订单', '每条匹配订单占一行；外连接还能保留无匹配用户。'),
          transfer(
            `阿禾有 ${3 + variant} 单、柏宁 0 单、澄子 2 单。分别用 INNER JOIN 与 LEFT JOIN 会得到几行？`,
          ),
        ),
        pass(
          'follow',
          joins,
          board('再看连接后的筛选', 'WHERE 在连接返回的记录上判断条件。'),
          ask('如果保留下来的右表金额是 NULL，连接后放进 WHERE 筛选会怎样？'),
          '内连接只保留匹配行。',
        ),
        follow(
          '金额比较是 UNKNOWN，所以该行不会通过 WHERE。',
          board('可在匹配时限定右表', 'ON 参与匹配，不等同于对左连接结果筛行。'),
          transfer(
            `小周没有达标订单。金额门槛改成 ${20 + variant} 元，放 ON 而非 WHERE 后还能保留小周吗？`,
          ),
        ),
        pass(
          'follow',
          '可以，ON 不匹配右表订单时，LEFT JOIN 仍保留小周，右边补 NULL。',
          board('连接与筛行是两个阶段', '是否保留无匹配左表行取决于连接类型和过滤位置。'),
          undefined,
          '右表条件放在 ON 可以保留无匹配左表行。',
        ),
      ],
    },
  };
}
