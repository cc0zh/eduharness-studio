import type { ModelSettings } from '@eduharness-studio/engine';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const selectClass =
  'h-9 w-full rounded-sm border border-border-strong bg-canvas px-2 text-sm text-ink outline-none focus-visible:border-ink disabled:opacity-50';

async function modelSettings(init?: RequestInit): Promise<ModelSettings> {
  const deadline = AbortSignal.timeout(5000);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const response = await fetch('/api/model', { cache: 'no-store', ...init, signal });
  if (!response.ok) throw new Error('model_settings_unavailable');
  return response.json();
}

export function ModelStatusDialog({ compact }: { compact: boolean }) {
  const [settings, setSettings] = useState<ModelSettings>();
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ provider: string; modelId: string }>();
  const keyField = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!loading) return;
    const controller = new AbortController();
    void modelSettings({ signal: controller.signal }).then(
      (next) => {
        if (controller.signal.aborted) return;
        setSettings(next);
        setLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setSettings(undefined);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [loading]);

  const provider =
    settings?.providers.find(({ id }) => id === (draft?.provider ?? settings.provider)) ??
    settings?.providers[0];
  const modelId =
    draft?.modelId ||
    (provider?.id === settings?.provider && settings?.modelId) ||
    provider?.models[0]?.id;
  const label = settings
    ? settings.mode === 'live'
      ? '在线模型已配置'
      : '离线确定性模式'
    : loading
      ? '读取模型状态…'
      : '模型状态不可用';

  function close() {
    if (keyField.current) keyField.current.value = '';
    setOpen(false);
    setDraft(undefined);
    setError('');
  }

  async function update(method: 'PUT' | 'DELETE') {
    setPending(true);
    setError('');
    const init: RequestInit = { method };
    if (method === 'PUT') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify({
        provider: provider?.id,
        modelId,
        apiKey: keyField.current?.value,
      });
    }
    if (keyField.current) keyField.current.value = '';
    try {
      setSettings(await modelSettings(init));
      close();
    } catch {
      const action = method === 'PUT' ? '保存' : '清空';
      const current = await modelSettings().catch(() => undefined);
      setSettings(current);
      setError(
        current ? `未确认${action}结果，请查看当前配置。` : `未确认${action}结果，请重试读取。`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          if (!pending) setLoading(true);
        } else {
          close();
        }
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`${label}（模型与 BYOK）`}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          />
        }
      >
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        <span className={compact ? 'hidden sm:inline' : undefined}>{label}</span>
        {compact && settings && (
          <span className="sm:hidden">{settings.mode === 'live' ? '在线' : '离线'}</span>
        )}
      </DialogTrigger>
      <DialogPopup className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>模型与自带密钥（BYOK）</DialogTitle>
          <DialogDescription>
            {settings?.mode === 'live'
              ? `当前：${settings.provider} / ${settings.modelId}（${settings.source === 'env' ? '环境配置' : '临时 Key'}）`
              : label}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="mt-3 text-xs text-accent">
            {error}
          </p>
        )}
        {settings ? (
          <form
            aria-busy={loading || pending}
            onSubmit={(event) => {
              event.preventDefault();
              if (!loading && !pending && modelId) void update('PUT');
            }}
          >
            <fieldset
              disabled={loading || pending}
              className="mt-4 grid gap-3 text-xs text-ink-secondary"
            >
              <div className="grid gap-1">
                <label htmlFor={`${fieldId}-provider`}>供应商</label>
                <select
                  id={`${fieldId}-provider`}
                  className={selectClass}
                  value={provider?.id ?? ''}
                  onChange={(event) => {
                    setDraft({ provider: event.target.value, modelId: '' });
                  }}
                >
                  {settings.providers.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <label htmlFor={`${fieldId}-model`}>模型</label>
                <select
                  id={`${fieldId}-model`}
                  className={selectClass}
                  value={modelId ?? ''}
                  onChange={(event) => {
                    if (provider) setDraft({ provider: provider.id, modelId: event.target.value });
                  }}
                >
                  {provider?.models.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <label htmlFor={`${fieldId}-key`}>临时 API Key</label>
                <Input
                  id={`${fieldId}-key`}
                  ref={keyField}
                  type="password"
                  autoComplete="off"
                  required
                  maxLength={4096}
                />
              </div>
              <p className="leading-relaxed text-muted">
                保存不会验证 Key 或调用模型。Key
                仅在本次服务进程中保留；清空或重启服务后，回落环境配置或离线模式。
              </p>
            </fieldset>
            <DialogFooter>
              {settings.source === 'byok' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading || pending}
                  onClick={() => void update('DELETE')}
                >
                  清空临时密钥
                </Button>
              )}
              <Button type="submit" size="sm" disabled={loading || pending || !modelId}>
                {pending ? '处理中…' : '保存配置'}
              </Button>
            </DialogFooter>
          </form>
        ) : !loading ? (
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError('');
                setLoading(true);
              }}
            >
              重试读取
            </Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
