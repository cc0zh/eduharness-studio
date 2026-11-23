import { PROTOCOL_VERSION } from '@eduharness-studio/engine';
import { useEffect, useState } from 'react';

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
    <div className="min-h-screen flex flex-col bg-[#F7F9F8] text-[#111827]">
      <header className="h-14 bg-white border-b border-[#E2E8F0] px-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#0F5250] text-white flex items-center justify-center text-xs font-bold">
            TA
          </div>
          <span className="font-semibold text-[15px] tracking-tight">TeachArena 课堂</span>
          <span className="px-2.5 py-0.5 rounded-full bg-[#D9ECEB] text-[#0F5250] text-xs font-medium">
            零密钥离线可用
          </span>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <span className="text-xs font-medium text-[#475569]">Agent X-Ray</span>
          <button
            type="button"
            role="switch"
            aria-checked={xrayOpen}
            onClick={() => setXrayOpen((v) => !v)}
            className={`w-10 h-5 rounded-full transition-colors p-0.5 ${
              xrayOpen ? 'bg-[#0F5250]' : 'bg-[#CBD5E1]'
            }`}
          >
            <span
              className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                xrayOpen ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </header>

      <div className="flex-1 flex">
        <main className="flex-1 dot-grid-canvas p-8 flex items-center justify-center">
          <section className="w-full max-w-2xl bg-white rounded-xl border border-[#E2E8F0] shadow-xs p-7 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#64748B]">M0 骨架与门禁就绪</p>
                <h1 className="text-xl font-bold mt-1">轻量分栏白板课堂 · eduharness-studio</h1>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#F1F5F9] text-[#334155]">
                协议 v{PROTOCOL_VERSION}
              </span>
            </div>

            <p className="text-sm text-[#475569] leading-relaxed">
              采用「课程 → 动态单元 → 按需懒生成课节」与「单堂白板课 → 动态要点 →
              按拍动作流」两层结构。M1 将在此骨架上落地离线示范课、分栏白板演播、打断持久化与 Agent
              X-Ray 6 维质检。
            </p>

            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm flex items-center justify-between">
              <span className="text-[#475569]">本地后端连接状态</span>
              {health ? (
                <span className="font-medium text-[#0F5250]">
                  已连接 · SQLite {health.sqlite}（{health.tables} 张表）· {health.mode}
                </span>
              ) : error ? (
                <span className="font-medium text-amber-700">连接异常：{error}</span>
              ) : (
                <span className="text-[#64748B]">正在检测 /api/health...</span>
              )}
            </div>
          </section>
        </main>

        {xrayOpen && (
          <aside className="w-80 bg-[#E2E7EA] border-l border-[#CBD5E1] p-4 space-y-3">
            <h2 className="text-sm font-semibold text-[#111827]">
              Agent X-Ray 透视面板（M0 占位）
            </h2>
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-3.5 text-xs space-y-2">
              <div className="font-medium text-[#334155]">三层连接状态</div>
              <div className="font-mono text-[#0F5250] bg-[#F1F5F9] rounded px-2.5 py-1.5">
                engine v{PROTOCOL_VERSION} → server {health ? health.protocolVersion : 'pending'}
              </div>
              <div className="text-[#64748B]">
                M1 起在此展示实时动作流队列、状态机节点、公开对话投影与 eduharness 6 维质检联动。
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
