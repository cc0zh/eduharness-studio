# 当前状态

- **当前里程碑**：M0（骨架与门禁）已完成并验证通过，准备进入 M1（零密钥离线端到端闭环）。
- **最后更新**：2026-11-23

## 已完成（M0）

- 轻量三层 npm workspaces 仓库：`packages/engine`、`apps/server`、`apps/web`。
- 纯引擎层最小硬契约：两层动态课程蓝图 Schema、8 类白板动作 TypeBox Schema、教学状态机与打断截断逻辑、白板→公开对话投影与对应单测。
- 后端 `apps/server`：Hono + `node:sqlite` 建表探活与 `/api/health`、`/api/meta`。
- 前端 `apps/web`：React + Vite + Tailwind 点阵白板最小页与 `Agent X-Ray` 占位抽屉，经 Vite proxy 连通本地后端。
- 自动化门禁：秒级 `npm run check:static`（三层导入边界 + 文档防堆放 Lint + 代码卫生/防膨胀/根目录白名单 + Biome + 全仓 `tsc --noEmit`）挂载 `.githooks/pre-commit`（`prepare` 自动启用）；全量 `npm run check` 叠加前端构建、引擎/门禁/M0 E2E 冒烟测试及 `.github/workflows/ci.yml`。

## 下一步（M1）

- 落地零密钥离线端到端闭环：进门示范课 + 轻调研生成动态两层蓝图、白板按拍 SSE 演播、左侧可折叠记录栏、打断持久化与刷新恢复、`Agent X-Ray` 离线 6 维质检及 `#n` 联动高亮，并接入真实浏览器 E2E 测试。
