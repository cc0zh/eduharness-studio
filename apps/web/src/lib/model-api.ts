const messages: Record<string, string> = {
  invalid_base_url:
    '请输入完整的 http:// 或 https:// Base URI，地址中不能包含凭据、查询参数或片段。',
  invalid_model_config: '请检查供应商、模型 ID 和 Key 格式。',
  model_key_required: '请输入此供应商和 Base URI 对应的 API Key。',
  model_list_unsupported: '此服务不提供模型目录，可以选择预设或手填模型 ID。',
  model_list_http_error: '模型目录请求被服务端拒绝，请检查地址和 Key。',
  model_list_unavailable: '无法连接模型目录，请检查 Base URI、网络和代理。',
  model_list_invalid_response: '模型目录响应格式不符，请手填模型 ID。',
  model_list_timeout: '拉取模型超时，可以重试或手填模型 ID。',
};

export class ModelApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(Object.hasOwn(messages, code) ? messages[code] : '模型配置暂不可用，请重试。');
  }
}

export async function requestModel<T>(path = '/api/model', init?: RequestInit): Promise<T> {
  const deadline = AbortSignal.timeout(6500);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const response = await fetch(path, { cache: 'no-store', ...init, redirect: 'error', signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const code =
      typeof body === 'object' && body && 'error' in body && typeof body.error === 'string'
        ? body.error
        : '';
    throw new ModelApiError(response.status, code);
  }
  return response.json();
}

export function modelJson(method: 'PUT' | 'POST', input: object): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
}
