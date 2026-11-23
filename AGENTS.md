# eduharness-studio 工作入口

- 先读 [README](README.md) 了解定位与启动方式，再看 [文档索引](docs/README.md)、[当前状态](docs/status.md) 与 [验收场景](docs/scenarios.md)。
- 产品采用两层动态结构：**课程蓝图**（`课程 → 动态单元 → 按需懒生成课节`）与**单堂白板课**（`课节 → 动态要点 → 按拍动作流`），绝不做成普通聊天机器人。
- 三层架构严格隔离：`packages/engine`（纯引擎，零 React/HTTP/SQLite/Node 耦合）、`apps/server`（Node 22 + Hono + `node:sqlite`）、`apps/web`（React + Vite + Tailwind）。
- 仅 `packages/engine/src/models.ts` 允许导入 `@earendil-works/pi-ai`；密钥只从环境变量或页面临时 BYOK 传入，严禁写入仓库。未获预算授权不发真实付费模型请求。
- 以 E2E 场景验证为主，纯逻辑硬边界补单测；本地提交触发 `.githooks/pre-commit`（`npm run check:static`），每次阶段交付须通过 `npm run check`（边界 + 文档 + 卫生/防膨胀 + Biome + 类型检查 + 前端构建 + 全部测试）。
- 防文档堆放：活文档严守行数上限，历史归入 [docs/archive/](docs/archive/README.md)，教训写入 [docs/learnings/](docs/learnings/README.md)，草稿放 `.tmp/scratch/<任务名>/` 用后清理。
- 排障见 [runbook](docs/runbook.md)，术语见 [glossary](docs/glossary.md)，规划见 [roadmap](docs/plans/roadmap.md)，记录见 [history](docs/history.md)。
