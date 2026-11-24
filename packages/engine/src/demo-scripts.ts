import { compileLesson } from './lesson-playback.js';

const alarmAreas = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 216">
  <rect width="440" height="216" fill="#F6F3EC"/>
  <path d="M20 34H58M20 30V38M58 30V38" stroke="#1A1917" stroke-width="0.9" fill="none"/>
  <path d="M64 34H420M64 30V38M420 30V38" stroke="#827B71" stroke-width="0.9" fill="none"/>
  <rect x="20" y="46" width="40" height="96" fill="#ECD49B" stroke="#1A1917" stroke-width="1.15"/>
  <path d="M20 62L36 46M20 78L52 46M20 94L60 54M20 110L60 70M20 126L60 86M20 142L60 102M36 142L60 118M52 142L60 134" stroke="#1A1917" stroke-width="0.75" stroke-opacity="0.22" fill="none"/>
  <rect x="20" y="142" width="40" height="24" fill="#FBF9F4" stroke="#827B71" stroke-width="0.85" stroke-dasharray="3 2"/>
  <rect x="64" y="46" width="356" height="26" fill="#F3D6B6" stroke="#A84428" stroke-width="1.2"/>
  <path d="M74 72L100 46M98 72L124 46M122 72L148 46M146 72L172 46M170 72L196 46M194 72L220 46M218 72L244 46M242 72L268 46M266 72L292 46M290 72L316 46M314 72L340 46M338 72L364 46M362 72L388 46M386 72L412 46" stroke="#A84428" stroke-width="0.75" stroke-opacity="0.28" fill="none"/>
  <rect x="64" y="72" width="356" height="94" fill="#EAE5D9" stroke="#BFB6A6" stroke-width="0.9"/>
  <rect x="26" y="82" width="28" height="24" fill="#F6F3EC" fill-opacity="0.9"/>
  <rect x="218" y="49" width="48" height="20" fill="#F6F3EC" fill-opacity="0.92"/>
  <g fill="#1A1917" font-family="sans-serif" font-size="13" text-anchor="middle">
    <text x="39" y="24">贴标 10</text>
    <text x="242" y="24" fill="#4D4943">未贴标 90（基数 9 倍）</text>
    <text x="40" y="99" font-size="16">8</text>
    <text x="40" y="158" font-size="11" fill="#827B71">2 漏报</text>
    <text x="242" y="64" font-size="15" fill="#A84428">18 误报</text>
    <text x="242" y="124" font-size="13" fill="#827B71">72 件未贴标 · 正常放行</text>
    <text x="220" y="196" font-size="12" fill="#A84428">琥珀色＝报警（8 + 18 = 26 件）· 面积代表件数</text>
  </g>
</svg>`;
export function bayesLesson() {
  return compileLesson([
    {
      id: 'sample-space',
      title: '先找对分母',
      objective: '报警后，只在所有报警的包裹里找贴标的那一部分。',
      depth: 'intuition',
      verification:
        '核对你圈的区域：分子是左边贴标且报警的 8 件，分母还要加入右侧 18 件误报。没有报警的两块都不算。',
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
      verification:
        '检验的方法是读条件线右侧：给定贴标时只数贴标组，给定报警时只数报警组。两个分母不同，不能把两个概率直接画等号。',
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
      verification:
        '最后核对：分子 16，分母 32。提高基率后，报警组里真贴标的比例从约三成升到一半；两种条件报警率依然没变。',
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
