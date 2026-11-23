import {
  type ActionDraft,
  type LessonScript,
  projectKeypointProgress,
  sectionBeats,
  validateLessonScript,
} from './lesson-playback.js';
import type { Action, ActionBatch, Keypoint } from './protocol.js';
import type { InterruptIntent } from './session-protocol.js';
import { truncateOnInterrupt } from './state.js';
import { transformerAttentionFlow } from './transformer-script.js';

export function classifyInterrupt(text: string): InterruptIntent {
  const normalized = text.normalize('NFKC').toLowerCase();
  const asksForAnswer =
    /直接.{0,8}(?:答案|结果|全解)|(?:告诉我|给我|想要|要看|看).{0,6}(?:答案|全解)|\b(?:give me|just tell me)\b.{0,20}\b(?:answer|solution)\b/;
  const avoidsSpoilers =
    /(?:不要|不用|别).{0,14}(?:答案|全解|剧透)|\b(?:don't|do not)\b.{0,24}\b(?:answer|solution)\b/;
  if (asksForAnswer.test(normalized) && !avoidsSpoilers.test(normalized)) return 'answer-request';
  if (
    /为什么|原理|怎么(?:算|来的|理解|推出来)|(?:没|不|听不|看不)懂|换.{0,5}(?:讲|说|例子|方式|表征)|\b(?:why|confused|don.t understand)\b/.test(
      normalized,
    )
  ) {
    return 'explain';
  }
  return 'continue';
}

type Material = {
  intuition: string;
  bridge: string;
  hint: string;
  prompt: string;
  check: string;
  page?: { id: string; title: string };
  graph?: { title: string; depth: 'definition'; svg_markup: string; formula: string };
  graphIntro?: string;
};

const demoMaterial: Partial<Record<string, Material>> = {
  'sample-space': {
    intuition:
      '用 100 件包裹重画两桌：10 件贴标、90 件未贴标。检测器在两组的报警率分别是 80% 和 20%；先在各自那一行想象警报数，不要把两桌混起来。',
    bridge:
      '沿着刚才的警报重画两行：100 件里 10 件贴标、90 件未贴标；两组报警率分别为 80% 和 20%。先确定这次要从哪一行取样。',
    hint: '题目给了 100 件、10 件贴标和 90 件未贴标；检测器在两组分别有 80% 和 20% 的报警率。先给每行留一个报警数空格，想清楚给定「已报警」时要看哪两行。',
    prompt: '从响过的包裹里抽一件，没贴标却响过的包裹要不要算进分母？说说理由。',
    check:
      '核对：误报虽然没贴标，仍然响过，所以属于分母；分子只数响过且贴标的。可以画两圈标出包含关系。',
  },
  'reverse-conditions': {
    intuition:
      '想象两道筛门：一道只放报警件过去，另一道只放贴标件过去。先走哪道门，决定你接下来在谁里面数。',
    bridge: '我们已经区分了两类包裹。下一步在条件线右边圈出本次计数的范围。',
    hint: '把两句话分别写成「在……里面，有多少……」，先只填第一个空。',
    prompt: '「贴标之后会报警」和「报警之后有贴标」分别先过哪道筛门？',
    check: '检验：条件线右侧决定先筛哪一组；共同命中的是同一批，但各自除以不同的总数。',
  },
  'transfer-base-rate': {
    intuition: '想象把一筐未贴标件换成一筐贴标件，警报装置完全没动；变化发生在送进筛门的两筐大小。',
    bridge: '接下来让检测器保持不变，只动输入的贴标比例，再看听见警报时有什么变化。',
    hint: '画贴标和未贴标两行，各留一个「响了多少」的空格。不急着算最后的比值。',
    prompt: '如果 100 件里有 20 件贴标，先告诉我你会怎样分别计算两行的报警数。',
    check:
      '拿你的两行相加核对分母，并检查分子是不是第一行的报警数。检测器没变，不代表报警组的构成不变。',
    page: { id: 'base-rate', title: '迁移练习 · 重数报警的包裹' },
  },
  context: {
    intuition: '把「它」当成拿着问题的读者：同一句话里的「小猫」和「垫子」像两张可翻阅的线索卡。',
    bridge: '回到「小猫趴在垫子上。它睡着了」：先画出「它」能够联系的同句位置。',
    hint: '标出正在更新的位置；先圈可供查看的词，不急着给它们排序。',
    prompt: '用刚才的句子指出一个查询位置、两个可取线索的位置；为什么叫「自」注意力？',
    check: '核对来源：查询和候选线索来自同一序列。可以更换查询位置，再比较权重是否一定不变。',
  },
  qkv: {
    intuition:
      '借书时你手里有检索需求、书架有目录、书里有内容。需求和目录负责找，放进书包的是书的内容。',
    bridge:
      '先用书店例子区分三种角色：查询者想找什么，目录怎样帮忙匹配，带回书包的又是哪一份内容。之后再对照 Q/K/V 标签。',
    hint: '给三张角色卡分工：查询者想找什么、哪些线索用于匹配、实际要带回的内容。你会怎样分给 Q/K/V？',
    prompt: '保持 Q 和 K 不变，只改一个 V，你预计哪些量会变化？',
    check: '核对两个动作：匹配只看 Q 与 K，取回的混合内容用 V。只改 V 不会改变匹配权重。',
    graph: {
      title: 'Q/K/V 权重流向 · 重新画一次',
      depth: 'definition',
      svg_markup: transformerAttentionFlow,
      formula: String.raw`\alpha_1+\alpha_2=1`,
    },
    graphIntro: '先看图里的 Q、K、V 三条路径：Q 与 K 先匹配，权重再乘 V。',
  },
  weights: {
    intuition:
      '把同一组候选的点积分数想成扩音后的投票；先调低增益，再按相对强弱分份额，避免只有最大声的一票被听到。',
    bridge: '从匹配到权重还要经过两步：先缩放，再在同一个查询行里分配份额。',
    hint: '先盯住同一行的两个分数，想想调低它们的尺度会不会改变大小顺序。',
    prompt: '同一行的分数差距变小时，分到的权重会更集中，还是更接近？',
    check:
      '用 softmax 的相对比例核对：分数之差进入指数；差距变小，权重更接近，且可见位置的权重和仍为一。',
  },
  'weighted-value': {
    intuition: '像调两种颜料：配比写在量杯外面，倒进杯里的是颜料。输出是混好的颜色，不是那串数字。',
    bridge: '权重已经算出，接着追踪「小猫」和「垫子」的 V 各缩放后怎样合到一起。',
    hint: '给两个向量各留一个系数位置；先标出哪个向量乘得更多。',
    prompt: '如果小猫的权重较大，该放大哪一路 V 的贡献？写出加法的结构，不必算数值。',
    check: '核对量纲：系数是标量，每项仍是 V 同形状的向量；两项相加，输出不会变成一对系数。',
  },
  'transfer-weights': {
    intuition: '把掩码当成关上的借阅窗口：那一路不再分到份额，仍开着的窗口重新分完它们的份额。',
    bridge: '最后换一组权重练习。保留两路 V，再看临时挡住一路会怎样。',
    hint: '先在纸上画出两路，把被遮住的一路划掉；看还剩几个位置参与。',
    prompt: '若只能看见垫子，输出会跟它的 V 有什么关系？说说你的判断。',
    check: '检查遮挡的极端情况：关掉的那一路权重为零；只剩一个位置时，它独占全部权重。',
    page: { id: 'attention-transfer', title: '迁移练习 · 改变可见位置' },
  },
};

function generatedMaterial(topic: string, point: Keypoint): Material {
  const task = `「${topic}」的「${point.title}」`;
  const contrast = {
    intuition: '把例子画成发生前、发生后两格，看看哪一格最接近你刚才的疑问。',
    definition: '并排写一个算数的例子和一个不算的例子，像给两张卡片找分界线。',
    derivation: '把「因为」和「所以」分写成两张卡片；一次只移走一个条件，看连线断在哪里。',
    application: '把练习改成一张试验单：输入、操作和可观察的结果各占一行。',
    theory: '从一个能成立的例子倒推它依赖的前提，再尝试抽掉其中一条。',
  }[point.depth];
  return {
    intuition: `我们换个方式看${task}。${contrast}`,
    bridge: `接着做${task}：${point.objective}`,
    hint: `把${task}缩小到一个具体情境。先写下你已经知道的一项和仍要检查的一项。`,
    prompt: `用你选的${topic}例子做一小步：${point.objective} 哪一点可以用例子核对？`,
    check: `对照「${point.title}」的目标核对刚才的${topic}例子：${point.objective} ${contrast}`,
  };
}

export function buildInterruptQueue(
  script: LessonScript,
  lastPlayedStepId: number | null,
  text: string,
  topic: string,
) {
  const cut = truncateOnInterrupt(script.actions, lastPlayedStepId);
  const intent = classifyInterrupt(text);
  const { currentIndex } = projectKeypointProgress(script.keypoints, cut.played);
  const batch: ActionBatch = [];
  const pageIds = new Set(
    cut.played.flatMap((action) => (action.type === 'new_page' ? [action.page_id] : [])),
  );
  // Never recycle even an issued-but-unplayed ID: records and SSE can still refer to it.
  let highWater = script.actions.at(-1)?.step_id ?? 0;
  for (const [i, point] of script.keypoints.slice(currentIndex).entries()) {
    const material = demoMaterial[point.id] ?? generatedMaterial(topic, point);
    const branch = i === 0 ? intent : 'continue';
    const intro = {
      explain: material.intuition,
      'answer-request': `先不揭底，试做一步。${material.hint}`,
      continue: material.bridge,
    }[branch];
    const label = { explain: '换个角度', 'answer-request': '只做第一步', continue: '接着往下' }[
      branch
    ];
    const note = `resume-${highWater + 1}`;
    const beats: ActionDraft[] = [{ type: 'speak', text: intro }];
    if (material.page && !pageIds.has(material.page.id)) {
      beats.push({ type: 'new_page', page_id: material.page.id, title: material.page.title });
      pageIds.add(material.page.id);
    }
    beats.push(
      {
        type: 'board',
        column: 1,
        card_id: note,
        title: `${label} · ${point.title}`,
        content: `${label}：${branch === 'explain' ? material.intuition : material.hint}`,
        depth: point.depth,
      },
      { type: 'highlight', card_id: note, target_text: label, style: 'highlight' },
      { type: 'ask', card_id: `${note}-ask`, prompt: material.prompt, mode: 'open' },
    );
    if (material.graph) {
      beats.splice(
        beats.length - 1,
        0,
        { type: 'new_column', column: 2 },
        { type: 'graph', column: 2, card_id: `${note}-graph`, ...material.graph },
        { type: 'speak', text: material.graphIntro ?? '沿着图里的箭头检查各自的方向。' },
      );
    }
    batch.push(...sectionBeats({ ...point, beats, verification: material.check }, highWater));
    highWater = batch.at(-1)?.step_id ?? highWater;
  }
  const actions: Action[] = [...cut.played, ...batch];
  if (!validateLessonScript({ ...script, actions })) throw new Error('Invalid continuation queue');
  return { ...cut, intent, batch, actions };
}
