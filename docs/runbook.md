# 运行与排障手册

## 环境要求

- Node.js `>= 22.19.0`（使用内置 `node:sqlite` 与原生 `node --test`）
- npm `>= 10`

## 常用命令

```bash
# 安装依赖
npm ci
npx playwright install chromium

# 一键运行全套门禁（静态门禁 + 前端构建 + 全部测试）
npm run check

# 秒级静态门禁（pre-commit 自动执行：边界 + 文档 + 代码卫生 + Biome + tsc）
npm run check:static

# 单跑专项检查与自动格式化
npm run check:boundaries
npm run check:docs
npm run check:hygiene
npm run lint
npm run format
npm run typecheck
npm test
npm run test:e2e

# 同时启动本地后端（3001）与前端（5173）
npm run dev
```

## 端口与数据库配置

- 可通过环境变量覆盖默认端口与 SQLite 路径：`PORT=3001`、`WEB_PORT=5173`、`STUDIO_DB_PATH=data/studio.sqlite`（测试可使用 `:memory:`）。
- 本地开发无需 `.env` 与 API Key；`data/` 目录已被 `.gitignore` 忽略。
- Playwright 仅为开发依赖：真实 Chromium 验收课堂交互，不进入部署包。E2E 自启随机端口和临时 SQLite；CI 同时安装 Chromium 的系统依赖。
- 复验开发启动路径时，以 `STUDIO_E2E_DEV=1` 运行 `npm run test:e2e`；可选 `STUDIO_E2E_SCREENSHOTS` 指定截图目录。
- X-Ray 离线质检沿用 `eduharness` 工作尺子 `e1-binary-v3` 的 19 题与汇总口径；本地规则只近似判断可观测证据，不等同模型裁判。

## 常见排障

1. **三层导入边界报错**：检查是否跨层引用了禁止依赖（如 `packages/engine` 引入 `node:*`/React/Hono，或 `apps/web` 引入服务端/Node 模块）。跨层引用只能使用工作区包名 `@eduharness-studio/engine`。
2. **文档门禁报错**：确认未在根目录或 `docs/` 根目录新建未登记 `.md`，未超出活文档行数预算，且新增归档或经验已链接至对应 `README.md`。
3. **代码卫生 / Biome 报错**：单源码文件上限 360 行，禁止 `@ts-ignore`/`@ts-nocheck`/显式 `any` 及仓库根目录野文件；格式问题可用 `npm run format` 修复。
4. **端口占用**：通过 `PORT` / `WEB_PORT` 临时改端口后重试 `npm run dev`。
