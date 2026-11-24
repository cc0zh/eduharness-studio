import { sanitizeSvg } from './static-svg.js';

export const COPPERPLATE_PALETTE = Object.freeze({
  paper: '#F6F3EC',
  primaryInk: '#1A1917',
  secondaryInk: '#4D4943',
  mutedInk: '#827B71',
  terracotta: '#A84428',
  paleAmber: '#ECD49B',
});

export const COPPERPLATE_STYLE_PROMPT = [
  '绘制单幅出版铜版风教学示意图。只有配图能帮助理解时才画，否则返回空。',
  `只用固定色板。底色 ${COPPERPLATE_PALETTE.paper}，主墨 ${COPPERPLATE_PALETTE.primaryInk}，次墨 ${COPPERPLATE_PALETTE.secondaryInk} / ${COPPERPLATE_PALETTE.mutedInk}，焦点赤陶 ${COPPERPLATE_PALETTE.terracotta}，淡琥珀 ${COPPERPLATE_PALETTE.paleAmber}。`,
  '用细轮廓线、斜线排线和简短标签表达层次。赤陶只点出一个焦点，淡琥珀用于浅底。',
  '只返回原始静态 SVG。根元素需有 xmlns="http://www.w3.org/2000/svg" 和有效 viewBox。',
  '用 rect、line、path 等基本图形与 text（sans-serif）。禁用脚本、事件属性、外部链接、CSS、渐变和滤镜。',
].join('\n');

export interface GraphRequest {
  readonly title: string;
  /** The concept or relationship that the illustration should make clear. */
  readonly description: string;
}

export interface GraphGeneratorContext {
  readonly stylePrompt: string;
  /** Pass through to asynchronous generation work so it can stop on timeout. */
  readonly signal: AbortSignal;
}

export interface GraphGenerator {
  generate(
    request: GraphRequest,
    context: GraphGeneratorContext,
  ): string | null | undefined | Promise<string | null | undefined>;
}

export interface GraphGenerationOptions {
  readonly generator?: GraphGenerator;
  /** Positive whole milliseconds. Defaults to 2,000 ms. */
  readonly timeoutMs?: number;
}

export type GraphGenerationResult =
  | {
      status: 'generated';
      /** Sanitized payload for the existing graph action's svg_markup. */
      svgMarkup: string;
      /** Encoded image source for rendering in an img element. */
      dataUrl: `data:image/svg+xml,${string}`;
    }
  | {
      /** Continue with text boardwork and record the reason in the trace if needed. */
      status: 'fallback';
      reason: 'unavailable' | 'empty' | 'timeout' | 'generation_error' | 'unsafe_svg';
    };

const DEFAULT_TIMEOUT_MS = 2_000;
const TIMED_OUT = Symbol('graph-generation-timeout');
const GENERATION_FAILED = Symbol('graph-generation-failed');

export async function generateGraph(
  request: GraphRequest,
  { generator, timeoutMs = DEFAULT_TIMEOUT_MS }: GraphGenerationOptions = {},
): Promise<GraphGenerationResult> {
  if (!generator) return { status: 'fallback', reason: 'unavailable' };

  const waitMs =
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_483_647
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const deadline = performance.now() + waitMs;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), waitMs);
    });
    const generation = Promise.resolve()
      .then(() =>
        generator.generate(request, {
          stylePrompt: COPPERPLATE_STYLE_PROMPT,
          signal: controller.signal,
        }),
      )
      .catch(() => GENERATION_FAILED);
    const markup = await Promise.race([timeout, generation]);
    // A busy event loop can let the generator settle before the deadline callback runs.
    if (markup === TIMED_OUT || performance.now() >= deadline) {
      controller.abort();
      return { status: 'fallback', reason: 'timeout' };
    }
    if (markup === GENERATION_FAILED) return { status: 'fallback', reason: 'generation_error' };
    if (markup == null || (typeof markup === 'string' && !markup.trim())) {
      return { status: 'fallback', reason: 'empty' };
    }

    const svgMarkup = typeof markup === 'string' ? sanitizeSvg(markup) : undefined;
    if (!svgMarkup) return { status: 'fallback', reason: 'unsafe_svg' };
    return {
      status: 'generated',
      svgMarkup,
      dataUrl: `data:image/svg+xml,${encodeURIComponent(svgMarkup)}`,
    };
  } catch {
    return { status: 'fallback', reason: 'generation_error' };
  } finally {
    clearTimeout(timer);
  }
}
