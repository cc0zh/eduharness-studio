import { compileLesson } from './lesson-playback.js';

export const transformerAttentionFlow = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 364 226">
  <rect width="364" height="226" fill="#F6F3EC"/>
  <rect x="10" y="44" width="120" height="38" fill="#FBF9F4" stroke="#1A1917" stroke-width="1.15"/>
  <rect x="10" y="102" width="120" height="38" fill="#EFECE3" stroke="#BFB6A6" stroke-width="0.95"/>
  <rect x="156" y="44" width="64" height="38" fill="#F3E4DE" stroke="#A84428" stroke-width="1.4"/>
  <rect x="156" y="102" width="64" height="38" fill="#EFECE3" stroke="#BFB6A6" stroke-width="0.95"/>
  <rect x="246" y="44" width="106" height="38" fill="#FBF9F4" stroke="#1A1917" stroke-width="1.15"/>
  <rect x="246" y="102" width="106" height="38" fill="#EFECE3" stroke="#BFB6A6" stroke-width="0.95"/>
  <rect x="92" y="176" width="180" height="36" fill="#1A1917"/>
  <path d="M130 63H152m-5 -4 5 4 -5 4M220 63H242m-5 -4 5 4 -5 4M312 82V94H356V158H182V173m-4 -5 4 5 4 -5" fill="none" stroke="#A84428" stroke-width="2" stroke-linejoin="round"/>
  <path d="M130 121H152m-4 -3.5 4 3.5 -4 3.5M220 121H242m-4 -3.5 4 3.5 -4 3.5M294 140V158" fill="none" stroke="#827B71" stroke-width="1.2" stroke-dasharray="4 3" stroke-linejoin="round"/>
  <g fill="#1A1917" font-family="sans-serif" font-size="13" text-anchor="middle">
    <text x="70" y="28" fill="#827B71">点积匹配</text>
    <text x="188" y="28" fill="#827B71">softmax</text>
    <text x="299" y="28" fill="#827B71">给 V 加权</text>
    <text x="70" y="68">Q 它 · K 小猫</text>
    <text x="70" y="126" fill="#4D4943">Q 它 · K 垫子</text>
    <text x="188" y="68" fill="#A84428" font-size="14">0.8</text>
    <text x="188" y="126" fill="#827B71">0.2</text>
    <text x="299" y="68">0.8 × V 小猫</text>
    <text x="299" y="126" fill="#4D4943">0.2 × V 垫子</text>
    <text x="182" y="199" fill="#FBF9F4" font-size="13">相加 →「它」的新表示</text>
  </g>
</svg>`;

export function transformerLesson() {
  return compileLesson([
    {
      id: 'context',
      title: '找出谁在看谁',
      objective: '把自注意力理解成序列里的位置从同一序列获取信息。',
      depth: 'intuition',
      verification:
        '核对两个位置是否都在同一个输入句里；换成「垫子」作查询时，仍从这句话取信息，但分配的权重可以不同。',
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
        {
          type: 'ask',
          card_id: 'context-check',
          mode: 'open',
          prompt: '在这个例子里，「它」从哪两个位置取信息？这些位置是否来自另一句话？',
        },
      ],
    },
    {
      id: 'qkv',
      title: '分清 Q、K、V',
      objective: '区分用于匹配的 Q、K，和真正送进输出的 V。',
      depth: 'definition',
      verification:
        '检验时沿两条箭头走：Q 和 K 决定取多少，权重乘的是 V。如果只换 V 而不动 Q、K，权重不变，取回的内容会变。',
      beats: [
        { type: 'new_column', column: 2 },
        {
          type: 'graph',
          column: 2,
          card_id: 'qkv-flow',
          title: 'Q/K/V 权重流向',
          depth: 'definition',
          svg_markup: transformerAttentionFlow,
          formula: String.raw`\alpha_1+\alpha_2=1`,
        },
        {
          type: 'speak',
          text: '同一个输入向量做三次可学习的投影。Q 像需求，K 像供匹配的索引，V 才是实际取回的信息。图里是单个位置、单个头的示意。',
        },
        {
          type: 'ask',
          card_id: 'qkv-check',
          mode: 'open',
          prompt: '如果只替换「小猫」的 V，匹配权重和取回的内容分别会不会变？',
        },
      ],
    },
    {
      id: 'weights',
      title: '把匹配变成权重',
      objective: '用缩放点积打分，再逐行做 softmax。',
      depth: 'derivation',
      verification:
        '核对顺序：先缩放分数，再按查询行做 softmax。分数相等的两个可见位置得到相等权重，两者权重之和为一。',
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
        {
          type: 'ask',
          card_id: 'weights-check',
          mode: 'open',
          prompt: '若同一查询只有两个可见位置，且分数相等，得到的两个权重有什么关系？',
        },
      ],
    },
    {
      id: 'weighted-value',
      title: '按权重取回信息',
      objective: '把注意力输出写成 V 的加权和，不把权重当作输出。',
      depth: 'theory',
      verification:
        '检验输出的形状：0.8 和 0.2 是两个标量，混合后的结果与单个 V 一样是向量，不能把那两个系数直接当成输出。',
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
        {
          type: 'ask',
          card_id: 'weighted-value-check',
          mode: 'open',
          prompt:
            '用 0.8 和 0.2 混合两个 V 后，输出的形状与一个 V 一样，还是由这两个系数本身组成？',
        },
      ],
    },
    {
      id: 'transfer-weights',
      title: '迁移到一组新权重',
      objective: '根据新权重写出输出，并解释某个位置被完全屏蔽时会怎样。',
      depth: 'application',
      verification:
        '最后检验两个极端：两个位置都可见时按 0.4、0.6 混合；若只剩第二个位置可见，输出就等于第二个 V。',
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
