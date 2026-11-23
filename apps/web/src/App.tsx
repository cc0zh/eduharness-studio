import { PROTOCOL_VERSION } from '@eduharness-studio/engine';
import { KeyRound, PanelLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';

interface HealthPayload {
  ok: boolean;
  service: string;
  protocolVersion: string;
  mode: string;
  sqlite: string;
  tables: number;
}

export function App() {
  const [xrayOpen, setXrayOpen] = useState(false);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthPayload>;
      })
      .then((data) => {
        if (active) setHealth(data);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : '无法连接本地服务');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      <header className="h-14 bg-surface border-b border-border px-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Sheet>
            <SheetTrigger
              render={
                <Button variant="outline" size="sm">
                  <PanelLeft className="size-3.5" />
                  课堂记录
                </Button>
              }
            />
            <SheetPopup side="left">
              <SheetHeader>
                <SheetTitle>课堂记录</SheetTitle>
                <SheetDescription>M1 起按拍回看字幕、学生回答与打断截断点</SheetDescription>
              </SheetHeader>
              <div className="p-4 text-xs text-muted leading-relaxed">
                当前处于 M0 骨架阶段；SQLite 建表已就绪，M1 将接入实时演播轨迹持久化与刷新恢复。
              </div>
            </SheetPopup>
          </Sheet>

          <div className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center text-xs font-bold">
            TA
          </div>
          <span className="font-semibold text-[15px] tracking-tight">TeachArena 课堂</span>
          <Badge variant="secondary">零密钥离线可用</Badge>
        </div>

        <div className="flex items-center gap-3">
          <Dialog>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm">
                  <KeyRound className="size-3.5" />
                  模型设置（离线）
                </Button>
              }
            />
            <DialogPopup>
              <DialogHeader>
                <DialogTitle>模型与临时 BYOK 设置</DialogTitle>
                <DialogDescription>
                  离线示范课无需密钥即可运行；M2 将开放临时 BYOK 与 .env
                  统一模型网关，密钥永不写入仓库。
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2">
                <label className="text-xs font-medium text-[#334155]" htmlFor="byok-preview">
                  临时 API Key（M2 启用）
                </label>
                <Input id="byok-preview" placeholder="当前为离线模式（M2 开放）" disabled />
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" size="sm" />}>知道了</DialogClose>
              </DialogFooter>
            </DialogPopup>
          </Dialog>

          <div className="flex items-center gap-2 select-none">
            <label
              htmlFor="agent-xray-switch"
              className="text-xs font-medium text-[#475569] cursor-pointer"
            >
              Agent X-Ray
            </label>
            <Switch
              id="agent-xray-switch"
              checked={xrayOpen}
              onCheckedChange={setXrayOpen}
              aria-label="Agent X-Ray"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        <main className="flex-1 dot-grid-canvas p-8 flex items-center justify-center">
          <section className="w-full max-w-2xl bg-surface rounded-xl border border-border shadow-xs p-7 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-muted">M0 骨架、门禁与 coss ui 原语就绪</p>
                <h1 className="text-xl font-bold mt-1">轻量分栏白板课堂 · eduharness-studio</h1>
              </div>
              <Badge variant="muted">协议 v{PROTOCOL_VERSION}</Badge>
            </div>

            <p className="text-sm text-[#475569] leading-relaxed">
              采用「课程 → 动态单元 → 按需懒生成课节」与「单堂白板课 → 动态要点 →
              按拍动作流」两层结构。外围交互壳由 coss ui 原语承载，点阵白板与按拍演播区保持纯手写
              Tailwind。
            </p>

            <div className="rounded-lg border border-border bg-[#f8fafc] px-4 py-3 text-sm flex items-center justify-between">
              <span className="text-[#475569]">本地后端连接状态</span>
              {health ? (
                <span className="font-medium text-primary">
                  已连接 · SQLite {health.sqlite}（{health.tables} 张表）· {health.mode}
                </span>
              ) : error ? (
                <span className="font-medium text-amber-700">连接异常：{error}</span>
              ) : (
                <span className="text-muted">正在检测 /api/health...</span>
              )}
            </div>
          </section>
        </main>

        {xrayOpen && (
          <aside className="w-88 bg-drawer border-l border-[#cbd5e1] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Agent X-Ray 透视面板</h2>
              <Badge variant="outline">M0 占位</Badge>
            </div>

            <Tabs defaultValue="stream">
              <TabsList>
                <TabsTab value="stream">动作流</TabsTab>
                <TabsTab value="projection">对话投影</TabsTab>
                <TabsTab value="gate">6 维质检</TabsTab>
              </TabsList>

              <TabsPanel value="stream">
                <div className="bg-surface rounded-xl border border-border p-3.5 text-xs space-y-2">
                  <div className="font-medium text-[#334155]">三层连接状态</div>
                  <div className="font-mono text-primary bg-[#f1f5f9] rounded px-2.5 py-1.5">
                    engine v{PROTOCOL_VERSION} → server{' '}
                    {health ? health.protocolVersion : 'pending'}
                  </div>
                  <div className="text-muted">M1 起实时展示白板动作队列与教学状态机节点。</div>
                </div>
              </TabsPanel>

              <TabsPanel value="projection">
                <div className="bg-surface rounded-xl border border-border p-3.5 text-xs text-muted">
                  M1 起实时展示白板动作 → 公开对话投影（#1 / #2 / ...）与工具耗时。
                </div>
              </TabsPanel>

              <TabsPanel value="gate">
                <div className="bg-surface rounded-xl border border-border p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[#334155]">eduharness 6 维质检</span>
                    <Badge variant="warning">M1 接入</Badge>
                  </div>
                  <div className="text-muted">点击评分证据 #n 时将高亮定位左侧白板与字幕。</div>
                </div>
              </TabsPanel>
            </Tabs>
          </aside>
        )}
      </div>
    </div>
  );
}
