import type { ByokInput, ModelChoice, ModelSettings } from '@eduharness-studio/engine';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ModelApiError, modelJson, requestModel } from '@/lib/model-api';

const selectClass =
  'h-9 w-full min-w-0 rounded-sm border border-border-strong bg-canvas px-2 text-sm text-ink outline-none focus-visible:border-ink disabled:opacity-50';

export function ModelConfigForm({
  settings,
  busy,
  save,
  clear,
}: {
  settings: ModelSettings;
  busy: boolean;
  save: (input: ByokInput) => void;
  clear: () => void;
}) {
  const [providerId, setProviderId] = useState(
    settings.provider ?? settings.providers[0]?.id ?? '',
  );
  const provider = settings.providers.find(({ id }) => id === providerId);
  const [modelId, setModelId] = useState(settings.modelId ?? provider?.models[0]?.id ?? '');
  const [baseUrl, setBaseUrl] = useState(settings.mode === 'live' ? (settings.baseUrl ?? '') : '');
  const [fetched, setFetched] = useState<ModelChoice[]>();
  const [listError, setListError] = useState('');
  const [fetching, setFetching] = useState(false);
  const listRequest = useRef<AbortController>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const disabled = busy || fetching;
  const preset = provider?.models ?? [];
  const models = fetched?.length ? fetched : preset;
  const hasModel = models.some(({ id }) => id === modelId);
  const onSameProvider = settings.provider === provider?.id;

  useEffect(() => () => listRequest.current?.abort(), []);

  function resetList() {
    setFetched(undefined);
    setListError('');
  }

  function connection() {
    return { provider: provider?.id ?? '', baseUrl, apiKey: keyField.current?.value };
  }

  async function fetchModels() {
    if (listRequest.current) return;
    const controller = new AbortController();
    listRequest.current = controller;
    setFetching(true);
    setListError('');
    try {
      const { models } = await requestModel<{ models: ModelChoice[] }>('/api/model/fetch-models', {
        ...modelJson('POST', connection()),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setFetched(models);
    } catch (error) {
      if (!controller.signal.aborted) {
        setListError(
          error instanceof ModelApiError ? error.message : '拉取模型失败，可以重试或手填模型 ID。',
        );
      }
    } finally {
      listRequest.current = null;
      if (!controller.signal.aborted) setFetching(false);
    }
  }

  return (
    <form
      aria-busy={disabled}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !provider || !modelId.trim()) return;
        save({ ...connection(), modelId: modelId.trim() });
        if (keyField.current) keyField.current.value = '';
      }}
    >
      <fieldset disabled={disabled} className="mt-4 grid min-w-0 gap-3 text-xs text-ink-secondary">
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${fieldId}-provider`}>供应商</label>
          <select
            id={`${fieldId}-provider`}
            className={selectClass}
            value={provider?.id ?? ''}
            onChange={(event) => {
              const next = settings.providers.find(({ id }) => id === event.target.value);
              setProviderId(next?.id ?? '');
              setBaseUrl(
                settings.mode === 'live' && settings.provider === next?.id
                  ? (settings.baseUrl ?? '')
                  : '',
              );
              setModelId(
                settings.provider === next?.id
                  ? (settings.modelId ?? '')
                  : (next?.models[0]?.id ?? ''),
              );
              if (keyField.current) keyField.current.value = '';
              resetList();
            }}
          >
            {settings.providers.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <label
            htmlFor={`${fieldId}-base`}
            className={provider?.requiresBaseUrl ? 'font-semibold text-ink' : undefined}
          >
            Base URI{' '}
            <span className="font-normal text-muted">
              {provider?.requiresBaseUrl ? '（必填）' : '（可选覆盖）'}
            </span>
          </label>
          <Input
            id={`${fieldId}-base`}
            required={provider?.requiresBaseUrl}
            inputMode="url"
            maxLength={2048}
            placeholder={provider?.defaultBaseUrl ?? 'http://127.0.0.1:8080/v1'}
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              if (keyField.current) keyField.current.value = '';
              resetList();
            }}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${fieldId}-key`}>临时 API Key</label>
          <Input
            id={`${fieldId}-key`}
            ref={keyField}
            type="password"
            autoComplete="off"
            maxLength={4096}
            placeholder={onSameProvider ? '拉取同一地址可留空' : undefined}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${fieldId}-model`}>模型</label>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select
              id={`${fieldId}-model`}
              className={selectClass}
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">
                {models.length ? '选择模型或在下方手填' : '请拉取模型或在下方手填'}
              </option>
              {modelId && !hasModel && <option value={modelId}>{modelId}</option>}
              {models.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            {provider?.supportsModelList && (
              <Button variant="outline" onClick={() => void fetchModels()}>
                {fetching ? '拉取中…' : '拉取模型'}
              </Button>
            )}
          </div>
        </div>
        {fetched && (
          <p role="status">
            {fetched.length ? `已拉取 ${fetched.length} 个模型` : '模型目录为空，可以手填模型 ID。'}
          </p>
        )}
        {listError && (
          <p role="alert" className="text-accent">
            {listError}
          </p>
        )}
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${fieldId}-model-id`}>模型 ID</label>
          <Input
            id={`${fieldId}-model-id`}
            required
            maxLength={240}
            autoComplete="off"
            spellCheck={false}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder="可直接手填"
          />
        </div>
        <p className="leading-relaxed text-muted">
          拉取会向所选 Base URI 发送 Key。修改地址后请重新输入对应的 Key。
        </p>
      </fieldset>
      <DialogFooter>
        {settings.source === 'byok' && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={clear}>
            清空临时密钥
          </Button>
        )}
        <Button type="submit" size="sm" disabled={disabled || !modelId.trim()}>
          {busy ? '处理中…' : '保存配置'}
        </Button>
      </DialogFooter>
    </form>
  );
}
