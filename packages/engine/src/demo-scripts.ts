import { compileLesson } from './lesson-playback.js';

const distanceDiagram = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" fill="none">
  <rect width="360" height="180" rx="12" fill="#F2F8F7"/>
  <path d="M84 23V158M51 131H309" stroke="#7C9291" stroke-width="1.5"/>
  <path d="M84 131L250 65" stroke="#81918F" stroke-width="2" stroke-dasharray="6 5"/>
  <path d="M84 65H250M84 78H97V65" stroke="#0F5250" stroke-width="3"/>
  <circle cx="84" cy="65" r="4" fill="#0F5250"/><circle cx="84" cy="131" r="4" fill="#657A79"/>
  <circle cx="250" cy="65" r="5" fill="#0F5250"/>
  <g fill="#264A49" font-family="sans-serif" font-size="15">
    <text x="93" y="34">AD · x = 0</text><text x="54" y="65">H</text>
    <text x="63" y="151">A</text><text x="260" y="62">E (3, 2)</text>
    <text x="146" y="57">垂线段</text><text x="312" y="137">x</text>
  </g>
</svg>`;

export function distanceLesson() {
  return compileLesson([
    {
      id: 'foot',
      title: '在图上找垂足',
      objective: '从 E 向 x = 0 作垂线，找到交点 H。',
      depth: 'intuition',
      beats: [
        {
          type: 'board',
          column: 1,
          card_id: 'given',
          title: '题面 · 先看已知',
          depth: 'intuition',
          content: '直线 AD：x = 0。\n点 E = (3, 2)。\nAE 连到了直线，它就是点 E 到直线的距离吗？',
        },
        { type: 'speak', text: '先盯住直线的位置。x 等于 0，意味着 AD 是一条竖直的线。' },
        { type: 'highlight', card_id: 'given', target_text: 'x = 0', style: 'highlight' },
        { type: 'new_column', column: 2 },
        {
          type: 'graph',
          column: 2,
          card_id: 'diagram',
          title: '垂距与斜线段',
          depth: 'derivation',
          svg_markup: distanceDiagram,
          formula: 'd(E, AD) = |EH| = |xₑ − xₕ|',
        },
        { type: 'highlight', card_id: 'given', target_text: 'E = (3, 2)', style: 'circle' },
        {
          type: 'board',
          column: 2,
          card_id: 'foot',
          title: '落点 H 在哪里？',
          depth: 'definition',
          content: '垂线是水平的，所以 H 和 E 高度相同。\nH = (0, 2)。',
        },
        {
          type: 'speak',
          text: '沿着水平线从 E 走到 AD，交点是 H。虚线 AE 虽然也碰到直线，却没有形成直角。',
        },
        {
          type: 'ask',
          card_id: 'distance-check',
          mode: 'open',
          prompt: '点 E 到 AD 的距离是多少？为什么不用 AE？',
          hint: '比较 E 和 H 的横坐标，再观察哪条线段与 AD 成直角。',
        },
      ],
    },
    {
      id: 'measure',
      title: '用定义计算垂距',
      objective: '用垂线段的两端坐标求出长度。',
      depth: 'derivation',
      beats: [
        { type: 'speak', text: '我们量的是垂线段 EH。两端同高，因此只算横坐标之差。' },
        {
          type: 'board',
          column: 1,
          card_id: 'length',
          title: '求垂线段长度',
          depth: 'derivation',
          content: '|EH| = |3 − 0| = 3。\n注意：垂距是长度，不能是负数。',
        },
      ],
    },
    {
      id: 'transfer',
      title: '换一条直线再判断',
      objective: '直线变了，仍然要先找垂足，再算长度。',
      depth: 'application',
      beats: [
        { type: 'new_page', page_id: 'transfer', title: '迁移练习 · 平移直线' },
        { type: 'speak', text: '现在把直线移到 x 等于 1，看看垂足和距离怎样改变。' },
        {
          type: 'board',
          column: 1,
          card_id: 'move-line',
          title: '当 AD 移到 x = 1',
          depth: 'application',
          content: 'E 仍在 (3, 2)，垂足变为 (1, 2)。\n垂距变为 |3 − 1| = 2。',
        },
      ],
    },
  ]);
}

export function cacheLesson() {
  return compileLesson([
    {
      id: 'reuse',
      title: '识别复用场景',
      depth: 'intuition',
      objective: '区分重新下载与复用已保存的响应。',
      beats: [
        {
          type: 'speak',
          text: '想象刷新同一张头像。关键不是刷新本身，而是浏览器能不能复用上一次的响应。',
        },
        {
          type: 'board',
          column: 1,
          card_id: 'cached',
          title: '一次点击，两条路径',
          depth: 'intuition',
          content: '首次请求：获取头像，并按响应头保存。\n再次请求：先判断保存的响应是否还能用。',
        },
      ],
    },
    {
      id: 'fresh',
      title: '判断缓存是否新鲜',
      depth: 'definition',
      objective: '比较缓存年龄与 max-age 给出的新鲜期。',
      beats: [
        { type: 'new_column', column: 2 },
        {
          type: 'board',
          column: 2,
          card_id: 'freshness',
          title: '新鲜期还剩多久？',
          depth: 'definition',
          content:
            'Cache-Control: max-age=60\n若当前缓存年龄是 30 秒，它还在新鲜期内；到 60 秒则已过期。',
        },
        { type: 'highlight', card_id: 'freshness', target_text: 'max-age=60', style: 'highlight' },
      ],
    },
    {
      id: 'tag',
      title: '读懂 ETag',
      depth: 'definition',
      objective: '过期不一定是内容变了，可以用 ETag 询问服务器。',
      beats: [
        { type: 'new_page', page_id: 'validation', title: '缓存过期 · 条件请求' },
        {
          type: 'board',
          column: 1,
          card_id: 'tag',
          title: '带着版本标识去确认',
          depth: 'definition',
          content: '服务端给响应附上 ETag。\n浏览器可在条件请求中用 If-None-Match 带回这个标识。',
        },
        { type: 'speak', text: '问的不是“有没有头像”，而是“我手里的这个版本还可以用吗”。' },
      ],
    },
    {
      id: 'compare',
      title: '区分 304 与 200',
      depth: 'derivation',
      objective: '304 复用原响应体，条件不满足通常返回新内容。',
      beats: [
        {
          type: 'board',
          column: 1,
          card_id: 'response',
          title: '检查服务端的答复',
          depth: 'derivation',
          content: '304 Not Modified：继续用已保存的响应体。\n200 OK：本次响应携带表示内容。',
        },
        {
          type: 'ask',
          card_id: 'cache-check',
          mode: 'open',
          prompt: '头像的缓存过期了，但 ETag 没变。这次要重下图片吗？',
        },
      ],
    },
    {
      id: 'policy',
      title: '给资源选策略',
      depth: 'application',
      objective: '根据更新频率，为不同资源选择不同的复用策略。',
      beats: [
        { type: 'new_column', column: 2 },
        {
          type: 'board',
          column: 2,
          card_id: 'policy',
          title: '入口和版本化资源分开考虑',
          depth: 'application',
          content:
            '经常变化的入口：更短的新鲜期或要求重新验证。\n文件名含版本的静态资源：可以给更长的新鲜期。',
        },
        { type: 'speak', text: '决定缓存策略时，先问能接受多旧的内容，再决定多久检查一次。' },
      ],
    },
  ]);
}
