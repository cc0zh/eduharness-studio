export const liveProvider = 'deepseek';
export const liveModel = 'deepseek-flash';
export const liveEndpoint = 'https://api.deepseek.com/chat/completions';

export function runMode(live, env) {
  const raw = env.M3_LIVE_POST_BUDGET;
  if (!live) {
    if (raw !== undefined) throw new Error('M3_LIVE_POST_BUDGET requires explicit --live');
    return { mode: 'faux' };
  }
  const limit = Number(raw);
  if (!/^[1-9]\d*$/.test(raw ?? '') || !Number.isSafeInteger(limit)) {
    throw new Error('--live requires a positive integer M3_LIVE_POST_BUDGET');
  }
  if (!env.DEEPSEEK_API_KEY?.trim()) throw new Error('--live requires DEEPSEEK_API_KEY');
  return {
    mode: 'live',
    limit,
    endpoint: liveEndpoint,
    modelEnv: {
      STUDIO_MODEL_PROVIDER: liveProvider,
      STUDIO_MODEL_ID: liveModel,
      DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY.trim(),
      HTTPS_PROXY: env.HTTPS_PROXY,
      NO_PROXY: env.NO_PROXY,
    },
  };
}

export function liveAnswerFits(ask, rule) {
  return (
    ask?.type === 'ask' &&
    (rule === true ||
      Boolean(
        rule?.prompt.test(ask.prompt) && (!rule.checkpoint || ask.checkpoint === rule.checkpoint),
      ))
  );
}
