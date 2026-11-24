import type { ByokInput, ModelSettings } from '@eduharness-studio/engine';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { ModelApiError, modelJson, requestModel } from '@/lib/model-api';
import { ModelConfigForm } from './ModelConfigForm';

export function ModelStatusDialog({ compact }: { compact: boolean }) {
  const [settings, setSettings] = useState<ModelSettings>();
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading) return;
    const controller = new AbortController();
    void requestModel<ModelSettings>(undefined, { signal: controller.signal }).then(
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

  const label = settings
    ? settings.mode === 'live'
      ? '在线模型已配置'
      : '离线确定性模式'
    : loading
      ? '读取模型状态…'
      : '模型状态不可用';

  function close() {
    setOpen(false);
    setError('');
  }

  async function update(input?: ByokInput) {
    setPending(true);
    setError('');
    try {
      setSettings(
        await requestModel<ModelSettings>(
          undefined,
          input ? modelJson('PUT', input) : { method: 'DELETE' },
        ),
      );
      close();
    } catch (error) {
      if (error instanceof ModelApiError && error.status === 400) {
        setError(error.message);
        return;
      }
      const action = input ? '保存' : '清空';
      const current = await requestModel<ModelSettings>().catch(() => undefined);
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
          <DialogDescription className="break-all">
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
        {open && settings ? (
          <ModelConfigForm
            key={JSON.stringify([
              settings.provider,
              settings.modelId,
              settings.source,
              settings.mode === 'live' ? settings.baseUrl : undefined,
            ])}
            settings={settings}
            busy={loading || pending}
            save={(input) => void update(input)}
            clear={() => void update()}
          />
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
