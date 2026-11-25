import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COPPERPLATE_PALETTE,
  COPPERPLATE_STYLE_PROMPT,
  type GraphGenerator,
  type GraphRequest,
  generateGraph,
  validateActions,
} from '../src/index.js';

const request: GraphRequest = {
  title: '相同长度，不同基数',
  description: '在刻度线上标出不同基数，并用赤陶线强调第一段。',
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" fill="#1A1917">
  <rect width="100" height="60" fill="#F6F3EC"/>
  <path d="M10 32H90M10 28V36M90 28V36" stroke="#1A1917" stroke-width="1" fill="none"/>
  <path d="M12 31L16 27M18 31L22 27" stroke="#A84428" stroke-width="0.8" fill="none"/>
  <text x="10" y="50" fill="#4D4943" font-family="sans-serif" font-size="10">基数</text>
</svg>`;

test('uses the copperplate prompt and publishes sanitized SVG as an encoded image URL', async () => {
  const generator: GraphGenerator = {
    generate(spec, { stylePrompt, signal }) {
      assert.equal(spec, request);
      assert.equal(stylePrompt, COPPERPLATE_STYLE_PROMPT);
      assert.equal(signal.aborted, false);
      return Promise.resolve(`\n  ${svg}\n`);
    },
  };
  const result = await generateGraph(request, { generator });
  assert.equal(result.status, 'generated');
  assert.equal(result.svgMarkup, svg);
  assert.match(result.dataUrl, /^data:image\/svg\+xml,%3Csvg/);
  assert.equal(decodeURIComponent(result.dataUrl.slice('data:image/svg+xml,'.length)), svg);
  assert.equal(new URL(result.dataUrl).hash, '');
  assert.equal(
    validateActions([
      {
        type: 'graph',
        step_id: 1,
        column: 1,
        card_id: 'graph',
        title: request.title,
        svg_markup: result.svgMarkup,
      },
    ]).ok,
    true,
  );
});

test('exports the fixed copperplate palette and fine hatching constraints', () => {
  assert.deepEqual(COPPERPLATE_PALETTE, {
    paper: '#F6F3EC',
    primaryInk: '#1A1917',
    secondaryInk: '#4D4943',
    mutedInk: '#827B71',
    terracotta: '#A84428',
    paleAmber: '#ECD49B',
  });
  for (const color of Object.values(COPPERPLATE_PALETTE)) {
    assert.ok(COPPERPLATE_STYLE_PROMPT.includes(color), color);
  }
  assert.match(COPPERPLATE_STYLE_PROMPT, /细轮廓线、斜线排线/);
  assert.match(COPPERPLATE_STYLE_PROMPT, /静态 SVG/);
});

test('returns text fallback with no generator or no illustration', async () => {
  assert.deepEqual(await generateGraph(request), { status: 'fallback', reason: 'unavailable' });
  for (const empty of [undefined, null, '', ' \n\t ']) {
    const result = await generateGraph(request, { generator: { generate: () => empty } });
    assert.deepEqual(result, { status: 'fallback', reason: 'empty' });
  }
});

test('rejects SVG with active content or external references without returning markup', async () => {
  for (const [label, unsafe] of [
    ['script', svg.replace('</svg>', '<script/></svg>')],
    ['event attribute', svg.replace('<svg ', '<svg onload="" ')],
    ['external link', svg.replace('<rect ', '<rect href="https://example.invalid/image.svg" ')],
    ['external paint', svg.replace('fill="#F6F3EC"', 'fill="url(https://example.invalid/paint)"')],
  ]) {
    const result = await generateGraph(request, { generator: { generate: () => unsafe } });
    assert.deepEqual(result, { status: 'fallback', reason: 'unsafe_svg' }, label);
  }
});

test('generated SVG rejects off-palette paint and defaults missing fills to copperplate ink', async () => {
  const offPalette = await generateGraph(request, {
    generator: { generate: () => svg.replace('#A84428', 'magenta') },
  });
  assert.deepEqual(offPalette, { status: 'fallback', reason: 'unsafe_svg' });
  const implicitPaint = await generateGraph(request, {
    generator: { generate: () => svg.replace(' fill="#1A1917"', '') },
  });
  assert.equal(implicitPaint.status, 'generated');
  assert.match(implicitPaint.svgMarkup, /^<svg fill="#1A1917"/);
});

test('handles synchronous throws and rejected promises without including provider details', async () => {
  const error = new Error('private provider details');
  const generators: GraphGenerator[] = [
    {
      generate() {
        throw error;
      },
    },
    { generate: () => Promise.reject(error) },
  ];
  for (const generator of generators) {
    const result = await generateGraph(request, { generator });
    assert.deepEqual(result, { status: 'fallback', reason: 'generation_error' });
  }
});

test('times out waiting for a stalled generator and signals cancellation', async () => {
  let observedSignal: AbortSignal | undefined;
  const result = await generateGraph(request, {
    timeoutMs: 10,
    generator: {
      generate(_spec, { signal }) {
        observedSignal = signal;
        return new Promise<never>(() => {});
      },
    },
  });
  assert.deepEqual(result, { status: 'fallback', reason: 'timeout' });
  assert.equal(observedSignal?.aborted, true);
});

test('keeps the timeout reason when cancellation rejects the generator promise', async () => {
  const result = await generateGraph(request, {
    timeoutMs: 10,
    generator: {
      generate(_spec, { signal }) {
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      },
    },
  });
  assert.deepEqual(result, { status: 'fallback', reason: 'timeout' });
});

test('treats late results and errors as timeout even before the timer fires', async (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const error = new Error('late provider failure');
  const outcomes = [
    ['SVG', () => svg],
    [
      'throw',
      () => {
        throw error;
      },
    ],
    ['rejection', () => Promise.reject(error)],
  ] as const;
  for (const [label, settle] of outcomes) {
    now = 0;
    let observedSignal: AbortSignal | undefined;
    const result = await generateGraph(request, {
      timeoutMs: 10,
      generator: {
        generate(_spec, { signal }) {
          observedSignal = signal;
          now = 11;
          return settle();
        },
      },
    });
    assert.deepEqual(result, { status: 'fallback', reason: 'timeout' }, label);
    assert.equal(observedSignal?.aborted, true, label);
  }
});
