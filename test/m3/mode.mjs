export const liveProvider = 'deepseek';
export const liveModel = 'deepseek-flash';
export const liveEndpoint = 'https://api.deepseek.com/chat/completions';
export const livePostLimit = 114;
export const liveSceneLimits = Object.freeze({
  'C2-pressure': 36,
  'C1-transfer': 30,
  'C3-interrupt': 18,
  'C4-prereq': 30,
});

export function assertLivePostLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > livePostLimit)
    throw new Error(`--live requires a positive integer M3_LIVE_POST_BUDGET <= ${livePostLimit}`);
}
export function runMode(live, env) {
  const raw = env.M3_LIVE_POST_BUDGET;
  if (!live) {
    if (raw !== undefined) throw new Error('M3_LIVE_POST_BUDGET requires explicit --live');
    return { mode: 'faux' };
  }
  const limit = /^[1-9]\d*$/.test(raw ?? '') ? Number(raw) : NaN;
  assertLivePostLimit(limit);
  const deepseek = env.DEEPSEEK_API_KEY?.trim();
  const openrouter = env.OPENROUTER_API_KEY?.trim();
  if (!deepseek) throw new Error('--live requires DEEPSEEK_API_KEY');
  if (!openrouter) throw new Error('--live requires OPENROUTER_API_KEY for export safety');
  const proxy = env.HTTPS_PROXY?.trim();
  if (!proxy) throw new Error('--live requires HTTPS_PROXY');
  const protocol = URL.parse(proxy)?.protocol;
  if (protocol !== 'http:' && protocol !== 'https:')
    throw new Error('Invalid HTTPS_PROXY configuration');
  return {
    mode: 'live',
    limit,
    endpoint: liveEndpoint,
    modelEnv: {
      STUDIO_MODEL_PROVIDER: liveProvider,
      STUDIO_MODEL_ID: liveModel,
      DEEPSEEK_API_KEY: deepseek,
      HTTPS_PROXY: proxy,
    },
    exportEnv: { DEEPSEEK_API_KEY: deepseek, OPENROUTER_API_KEY: openrouter },
  };
}
