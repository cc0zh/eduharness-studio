import type { ModelChoice } from '@eduharness-studio/engine';
import { containsCredential, ModelIdSchema } from '@eduharness-studio/engine/models';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const CatalogSchema = Type.Object({ data: Type.Array(Type.Unknown()) });
const ItemSchema = Type.Object({ id: ModelIdSchema });
const responseLimit = 4 * 1024 * 1024;
const modelLimit = 3000;

export class ModelListError extends Error {
  constructor(
    public readonly code:
      | 'model_list_unsupported'
      | 'model_list_http_error'
      | 'model_list_unavailable'
      | 'model_list_invalid_response'
      | 'model_list_timeout',
  ) {
    super(code);
  }
}

async function readCatalog(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ModelListError('model_list_invalid_response');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > responseLimit) throw new ModelListError('model_list_invalid_response');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** `/models` metadata, shared by providers using the OpenAI catalog shape. */
export async function fetchModelList(
  { baseUrl, apiKey }: { baseUrl: string; apiKey: string },
  modelFetch: typeof globalThis.fetch,
  requestSignal: AbortSignal,
): Promise<ModelChoice[]> {
  const deadline = AbortSignal.timeout(5000);
  const signal = AbortSignal.any([requestSignal, deadline]);
  try {
    const response = await modelFetch(`${baseUrl}/models`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      const unsupported = [404, 405, 501].includes(response.status);
      throw new ModelListError(unsupported ? 'model_list_unsupported' : 'model_list_http_error');
    }
    const body = await readCatalog(response);
    if (!Value.Check(CatalogSchema, body)) throw new ModelListError('model_list_invalid_response');
    const models = new Map<string, ModelChoice>();
    for (const item of body.data) {
      if (!Value.Check(ItemSchema, item) || containsCredential(item.id, apiKey)) continue;
      const label = 'name' in item && typeof item.name === 'string' ? item.name.trim() : '';
      const name = label && !containsCredential(label, apiKey) ? label.slice(0, 180) : item.id;
      if (!models.has(item.id)) models.set(item.id, { id: item.id, name });
      if (models.size > modelLimit) throw new ModelListError('model_list_invalid_response');
    }
    if (body.data.length > 0 && models.size === 0)
      throw new ModelListError('model_list_invalid_response');
    return [...models.values()];
  } catch (error) {
    if (signal.aborted) throw new ModelListError('model_list_timeout');
    if (error instanceof ModelListError) throw error;
    if (error instanceof SyntaxError) throw new ModelListError('model_list_invalid_response');
    throw new ModelListError('model_list_unavailable');
  }
}
