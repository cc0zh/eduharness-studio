# eduharness-studio 工作入口

- 先读 [README](README.md) 了解定位与启动方式，再看 [文档索引](docs/README.md)、[当前状态](docs/status.md) 与 [验收场景](docs/scenarios.md)。
- 产品采用两层动态结构：**课程蓝图**（`课程 → 动态单元 → 按需懒生成课节`）与**单堂白板课**（`课节 → 动态要点 → 按拍动作流`），绝不做成普通聊天机器人。
- 三层架构严格隔离：`packages/engine`（纯引擎，零 React/HTTP/SQLite/Node 耦合）、`apps/server`（Node 22 + Hono + `node:sqlite`）、`apps/web`（React + Vite + Tailwind）。
- 仅 `packages/engine/src/models.ts` 允许导入 `@earendil-works/pi-ai`；密钥不进入浏览器持久化、SQLite、日志或错误消息。[供应商 SDK 日志边界](docs/learnings/2026-11/model-credential-boundary.md)。未获预算授权不发真实付费模型请求。
- 以 E2E 场景验证为主，纯逻辑硬边界补单测；本地提交触发 `.githooks/pre-commit`（`npm run check:static`），每次阶段交付须通过 `npm run check`（边界 + 文档 + 卫生/防膨胀 + Biome + 类型检查 + 前端构建 + 全部测试）。
- 打断、恢复、公开对话和质检统一以播放器确认上屏的动作作为课堂事实。[演播证据边界](docs/learnings/2026-11/played-evidence.md)
- 预算内真机验收：区分 SSE 消费端释放与真实断流；若要续跑，停机前保存脱敏蓝图、可恢复会话与累计 POST 账本。[真机验收证据边界](docs/learnings/2026-11/live-acceptance-evidence.md)
- 防文档堆放与四分法。能代码/测试拦截的用门禁，普通 bug 止于回归测试。仅症状≠根因的高代价坑或新的跨层边界写 5 栏并浓缩 1 行进本文件（满上限先删旧）。[经验索引](docs/learnings/README.md)
- 文档只记意图、边界和证据，活文档严守行数上限。历史归档，草稿放 `.tmp/scratch/<任务名>/` 用后清理。[历史归档](docs/archive/README.md)
- 排障见 [runbook](docs/runbook.md)，术语见 [glossary](docs/glossary.md)，规划见 [roadmap](docs/plans/roadmap.md)，记录见 [history](docs/history.md)。
