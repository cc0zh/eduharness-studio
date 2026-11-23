import { compileLesson } from './lesson-playback.js';

const alarmAreas = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 210">
  <rect width="440" height="210" rx="12" fill="#F2F8F7"/>
  <rect x="20" y="52" width="400" height="120" fill="#D9ECEB"/>
  <rect x="20" y="52" width="40" height="96" fill="#FDE0A6"/>
  <rect x="60" y="52" width="360" height="24" fill="#FDE0A6"/>
  <rect x="20" y="52" width="400" height="120" fill="none" stroke="#0F5250"/>
  <path d="M60 52V172M20 148H60M60 76H420" stroke="#0F5250" fill="none"/>
  <g fill="#0F5250" font-family="sans-serif" font-size="16" text-anchor="middle">
    <text x="42" y="38">贴标 10</text><text x="240" y="38">未贴标 90</text>
    <text x="40" y="106">8</text><text x="240" y="70">18</text>
    <text x="220" y="195">琥珀色＝报警 · 面积代表件数</text>
  </g>
</svg>`;

const attentionFlow = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 224">
  <rect width="360" height="224" rx="12" fill="#F2F8F7"/>
  <g fill="#D9ECEB">
    <rect x="10" y="45" width="122" height="39" rx="7"/><rect x="10" y="101" width="122" height="39" rx="7"/>
    <rect x="243" y="45" width="103" height="39" rx="7"/><rect x="243" y="101" width="103" height="39" rx="7"/>
    <rect x="95" y="174" width="170" height="36" rx="7"/>
  </g>
  <g fill="#FDE0A6">
    <rect x="155" y="45" width="65" height="39" rx="7"/><rect x="155" y="101" width="65" height="39" rx="7"/>
  </g>
  <path d="M132 64H151m-5 -4 5 4 -5 4M220 64H239m-5 -4 5 4 -5 4M132 120H151m-5 -4 5 4 -5 4M220 120H239m-5 -4 5 4 -5 4M309 84V92H352V158H180V171m-4 -5 4 5 4 -5M286 140V158"
    fill="none" stroke="#0F5250" stroke-width="2" stroke-linejoin="round"/>
  <g fill="#0F5250" font-family="sans-serif" font-size="15" text-anchor="middle">
    <text x="70" y="29">点积匹配</text><text x="187" y="29">softmax</text><text x="294" y="29">给 V 加权</text>
    <text x="70" y="70">Q 它 · K 小猫</text><text x="70" y="126">Q 它 · K 垫子</text>
    <text x="187" y="70">0.8</text><text x="187" y="126">0.2</text>
    <text x="294" y="70">0.8 × V 小猫</text><text x="294" y="126">0.2 × V 垫子</text>
    <text x="180" y="198">相加 →「它」的新表示</text>
  </g>
</svg>`;

export function bayesLesson() {
  return compileLesson([
    {
      id: 'sample-space',
      title: '先找对分母',
      objective: '报警后，只在所有报警的包裹里找贴标的那一部分。',
      depth: 'intuition',
      beats: [
        {
          type: 'board',
          column: 1,
          card_id: 'alarm-setup',
          title: '一个警报，两个方向',
          content:
            '100 件包裹，10 件有贴标，90 件没有。\n贴标包裹有 80% 会报警；没贴标的也有 20% 会误报。\n听到警报，眼前的包裹有贴标的概率也是 80% 吗？',
        },
        {
          type: 'speak',
          text: '先猜一下：听见警报，就能把八成原样搬过来吗？我们换成一百件包裹来画。',
        },
        { type: 'highlight', card_id: 'alarm-setup', target_text: '听到警报', style: 'highlight' },
        { type: 'new_column', column: 2 },
        {
          type: 'graph',
          column: 2,
          card_id: 'alarm-areas',
          title: '面积方块 · 报警样本',
          svg_markup: alarmAreas,
        },
        { type: 'speak', text: '每一块面积对应件数。现在只看琥珀色的区域，灰绿色的先排除。' },
        {
          type: 'speak',
          text: '先不下结论。图上有两块琥珀色，想清楚它们各代表什么后再往下走。',
        },
        {
          type: 'ask',
          card_id: 'guess-denominator',
          mode: 'open',
          prompt: '只在响过的包裹里挑一件。你会拿哪块作分子？分母又要圈进哪些块？',
          hint: '给定条件是「已报警」，不是「已贴标」。先找图上同一种颜色。',
        },
      ],
    },
    {
      id: 'reverse-conditions',
      title: '修正倒置的条件',
      objective: '用面积图解释贝叶斯公式，区分两个方向的条件概率。',
      depth: 'derivation',
      beats: [
        {
          type: 'speak',
          text: '八成的分母是十件贴标包裹。反过来问时，未贴标却报警的十八件也要算进去。两个问题数的不是同一群包裹。',
        },
        {
          type: 'board',
          column: 1,
          card_id: 'reverse-conditions',
          title: '修正直觉 · 分母换了',
          depth: 'definition',
          content:
            '报警的有 8 件贴标包裹，加上 18 件误报。\n分母是 26 件报警包裹，不是 10 件贴标包裹。',
          formula: String.raw`\frac{8}{8+18}=\frac{4}{13}\approx31\%`,
        },
        {
          type: 'highlight',
          card_id: 'reverse-conditions',
          target_text: '26 件报警包裹',
          style: 'circle',
        },
        {
          type: 'board',
          column: 2,
          card_id: 'bayes-rule',
          title: '贝叶斯公式 · 把面积写成概率',
          depth: 'derivation',
          content:
            'M 代表贴标，A 代表报警。分子是「贴标且报警」，分母是「所有报警」。只有报警概率大于 0 时才能这样除。',
          formula: String.raw`P(M\mid A)=\frac{P(A\mid M)\,P(M)}{P(A)}`,
        },
        {
          type: 'speak',
          text: '分子是左边那小块，分母是两块琥珀色面积之和。图和公式其实在做同一次筛选。',
        },
        {
          type: 'ask',
          card_id: 'misconception-repair-check',
          mode: 'open',
          prompt:
            '现在判断「报警后的贴标概率一定等于贴标后的报警概率」对不对？请各指出一次分母对应的人群。',
        },
      ],
    },
    {
      id: 'transfer-base-rate',
      title: '换一批包裹试试',
      objective: '检测器不变时，独立算出基率变化怎样影响报警后的判断。',
      depth: 'application',
      beats: [
        { type: 'new_page', page_id: 'base-rate', title: '迁移练习 · 换一批包裹' },
        {
          type: 'board',
          column: 1,
          card_id: 'changed-base-rate',
          title: '这次贴标包裹多了一倍',
          depth: 'application',
          content:
            '仍然是 100 件包裹，现在有 20 件贴标。\n检测器没变：贴标时 80% 报警，未贴标时 20% 报警。',
        },
        {
          type: 'speak',
          text: '现在你来。检测器没有改，这次警报值得相信的程度会不会变？先自己算，再核对。',
        },
        {
          type: 'ask',
          card_id: 'new-base-rate-check',
          mode: 'open',
          prompt: '报警后有贴标的概率是多少？请写出分子和分母，并说说为什么与上一批不同。',
        },
        { type: 'new_column', column: 2 },
        {
          type: 'board',
          column: 2,
          card_id: 'base-rate-answer',
          title: '核对 · 两种报警一样多',
          depth: 'application',
          content: '20 件贴标包裹里有 16 件报警，80 件未贴标包裹里也有 16 件报警。',
          formula: String.raw`\frac{16}{16+16}=50\%`,
        },
        {
          type: 'speak',
          text: '从约三成升到一半，不是检测器变准了，而是原本贴标的比例变高了。以后先问：分母是哪一群？',
        },
      ],
    },
  ]);
}

export function transformerLesson() {
  return compileLesson([
    {
      id: 'context',
      title: '找出谁在看谁',
      objective: '把自注意力理解成序列里的位置从同一序列获取信息。',
      depth: 'intuition',
      beats: [
        {
          type: 'board',
          column: 1,
          card_id: 'context',
          title: '「它」可以向谁取信息？',
          content:
            '小猫趴在垫子上。它睡着了。\n读到「它」时，附近的词可以提供不同线索。示意只选「小猫」和「垫子」两个位置。',
        },
        {
          type: 'speak',
          text: '同一个词放进不同句子，需要不同的上下文。自注意力让每个位置从同一序列里按权重取信息。',
        },
        { type: 'highlight', card_id: 'context', target_text: '「它」', style: 'highlight' },
      ],
    },
    {
      id: 'qkv',
      title: '分清 Q、K、V',
      objective: '区分用于匹配的 Q、K，和真正送进输出的 V。',
      depth: 'definition',
      beats: [
        { type: 'new_column', column: 2 },
        {
          type: 'graph',
          column: 2,
          card_id: 'qkv-flow',
          title: 'Q/K/V 权重流向',
          depth: 'definition',
          svg_markup: attentionFlow,
          formula: String.raw`\alpha_1+\alpha_2=1`,
        },
        {
          type: 'speak',
          text: '同一个输入向量做三次可学习的投影。Q 像需求，K 像供匹配的索引，V 才是实际取回的信息。图里是单个位置、单个头的示意。',
        },
      ],
    },
    {
      id: 'weights',
      title: '把匹配变成权重',
      objective: '用缩放点积打分，再逐行做 softmax。',
      depth: 'derivation',
      beats: [
        { type: 'new_column', column: 3 },
        {
          type: 'board',
          column: 3,
          card_id: 'scaled-dot-product',
          title: '缩放点积注意力',
          depth: 'derivation',
          content:
            'Q 与各个 K 做点积。除以键向量维度的平方根，再按行做 softmax。\n每行权重非负，总和为 1；最后用这行权重对 V 求加权和。',
          formula: String.raw`\operatorname{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V`,
        },
        {
          type: 'speak',
          text: '维度变高时，点积的波动往往变大。除以根号键维度，是为了缓和 softmax 把权重挤得过尖。',
        },
      ],
    },
    {
      id: 'weighted-value',
      title: '按权重取回信息',
      objective: '把注意力输出写成 V 的加权和，不把权重当作输出。',
      depth: 'theory',
      beats: [
        {
          type: 'board',
          column: 1,
          card_id: 'weighted-value',
          title: '输出不是权重，而是混合后的向量',
          depth: 'theory',
          content:
            '若「小猫」和「垫子」的权重分别是 0.8 和 0.2，就按这个比例混合它们的 V。权重是示例，不是模型实际跑出的结果。',
          formula: String.raw`o=0.8\,v_1+0.2\,v_2`,
        },
        {
          type: 'speak',
          text: 'K 用来算系数，V 用来拼向量。可以想成店里先对货架编号，再按比例取货；别把编号本身装进袋子。',
        },
      ],
    },
    {
      id: 'transfer-weights',
      title: '迁移到一组新权重',
      objective: '根据新权重写出输出，并解释某个位置被完全屏蔽时会怎样。',
      depth: 'application',
      beats: [
        { type: 'new_page', page_id: 'attention-transfer', title: '迁移练习 · 改一组权重' },
        {
          type: 'board',
          column: 1,
          card_id: 'change-weights',
          title: '这次垫子的权重更高',
          depth: 'application',
          content: '这次得到 0.4 和 0.6 两个权重，V 保持不变。',
        },
        {
          type: 'speak',
          text: '轮到你按新的比例组合向量。再想一步，如果第一个位置被遮住，它还能提供信息吗？',
        },
        {
          type: 'ask',
          card_id: 'attention-check',
          mode: 'open',
          prompt: '给两个 V 分别乘什么系数？若第一个位置被掩码完全排除，它对加权和还有贡献吗？',
        },
        { type: 'new_column', column: 2 },
        {
          type: 'board',
          column: 2,
          card_id: 'attention-check-answer',
          title: '核对 · 权重决定各自的贡献',
          depth: 'application',
          content:
            '在这次混合里，第二个 V 的系数更大。若掩码排除了第一个位置，第一个权重是 0，其余可见位置重新归一化。',
          formula: String.raw`o=0.4\,v_1+0.6\,v_2`,
        },
        {
          type: 'speak',
          text: '只剩一个可见位置时，它的权重就是一。回看板书，你能指出哪一步在比较、哪一步在取信息吗？',
        },
      ],
    },
  ]);
}
