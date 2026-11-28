# eduharness-studio（Eduharness课堂）

面向 1 对 1 交互式学习的**受控多轮 Agent 全栈参考实现与 Eval 闭环载体**，与同栈 TypeScript 评测仓库 `eduharness-ts`（6 维 19 题二元证据尺子 `e1-binary-v3`，99/99 黄金对拍 0 偏差）组成双项目组合。当前 M0–M3 已完成收官验收并进入 UI/功能冻结态。

## 核心能力与双项目闭环

1. **轻量两层学习结构**：输入任意主题经轻调研生成动态 `课程 → 单元 → 课节` 蓝图（后续课节按需懒生成），内置两节精选示范课一键直达单节白板课；保留 `LessonBasis` 扩展槽位。
2. **分栏白板按拍演播与受控引擎（无 TTS）**：主舞台为点阵分栏白板，按拍演播板书、荧光高亮/圈画、铜版风静态 SVG 示意图、口语字幕与 `ask` 互动停顿；引擎内置语义分镜编译、状态机护栏（防开场泄底、敷衍降级与 `unverified` 诚实记账）、安全数学工具 `calc_verify` 与打断截断，由本地 `node:sqlite` 持久化已上屏状态。
3. **一键 `Agent X-Ray` 与跨仓真评测闭环**：默认学生界面纯净；开启后右侧滑出工程抽屉，实时查看诊断、动作流队列、工具耗时与公开对话投影，并支持离线 19 题快检及 `#n` 跨页高亮。可通过只读 CLI 将已上屏公开对话导出给 `eduharness-ts --judge-only`，产出 `--verify-run` 验真收据与离线 HTML 复核报告。

## 三层架构

| 层级     | 目录              | 职责与边界                                                                                                                                                       |
| :------- | :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯引擎层 | `packages/engine` | TypeBox 契约、状态机、语义分镜编译、认知护栏、`calc_verify`、静态 SVG 消毒与公开投影；零 React/HTTP/SQLite 依赖，仅 `src/models.ts` 接入 `@earendil-works/pi-ai` |
| 服务端   | `apps/server`     | Node 22 + Hono + `node:sqlite` 本地持久化、SSE 下发、内存态 BYOK 与只读裁判导出 CLI；严禁导入前端或模型 SDK                                                      |
| 前端     | `apps/web`        | React + Vite + Tailwind 点阵白板与 X-Ray 抽屉；仅引用浏览器安全引擎导出（M3 收官已冻结）                                                                         |

## 快速开始

需要 Node.js `>=22.19.0` 和 `package.json` 中锁定的 pnpm 版本。

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run check
pnpm run dev
```

默认零密钥离线运行（无需 `.env`）；`pnpm run dev` 同时启动本地后端（`http://127.0.0.1:3001`）与前端（`http://127.0.0.1:5173`）。导出最近一轮课堂的已上屏对话供 `eduharness-ts --judge-only` 评分：

```bash
mkdir -p .tmp
pnpm run export:judge --db data/studio.sqlite --out-dir .tmp/judge-export
```

模型配置、门禁与排障见[运行手册](docs/runbook.md#模型配置m2-1)。

## 文档导航

- [文档总索引与防堆放规则](docs/README.md)
- [当前里程碑状态与收官证据](docs/status.md)
- [分阶段 E2E 验收场景](docs/scenarios.md)
- [本地运行与排障手册](docs/runbook.md)
- [路线图（M0–M3 收官）](docs/plans/roadmap.md)
