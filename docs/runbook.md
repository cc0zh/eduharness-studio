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

## 模型配置（M2-1）

- 顶栏「模型与自带密钥」从 `/api/model` 读取状态和目录。临时 Key 仅保存在本地服务进程，刷新页面会读回状态（不读回 Key）；清空或重启服务回落环境配置，无 Key 则离线。
- 服务启动读取仓库根 `.env`（可用 `STUDIO_ENV_FILE` 指向独立文件）；同名进程环境变量优先。使用供应商原生变量（如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`），可用 `STUDIO_MODEL_PROVIDER` / `STUDIO_MODEL_ID` 指定模型；未指定则用首个有凭据的目录项。模型调用可经 `HTTPS_PROXY`，支持 `NO_PROXY`。
- 当前目录限 `pi-ai` 支持单 Key 且可注入代理传输的 OpenAI、Anthropic、DeepSeek、Moonshot AI、OpenRouter。保存配置时只更新模型设置。带模型配置新开或重开非示范课会调用 Teacher Agent；运行中模型不可用时保留已提交作答，并以离线方式将未完成要点标为未验证。真实试学前先取得费用授权。
- 复验顶栏 BYOK：`node --test test/browser-m2-1.test.mjs`。设置 `STUDIO_MODEL_SCREENSHOTS` 可保存 Chromium 截图。
- 复验教师回合使用 `node --test test/browser-m2-2.test.mjs`。该用例注入独立 faux 网关并使用临时 SQLite。设置 `STUDIO_TEACHER_SCREENSHOTS` 可保存 Chromium 截图。

## 常见排障

1. **三层导入边界报错**：跨层使用 `@eduharness-studio/engine`；只有服务端可引用 `@eduharness-studio/engine/models`，不能经引擎根入口转接。
2. **文档门禁报错**：确认未在根目录或 `docs/` 根目录新建未登记 `.md`，未超出活文档行数预算，且新增归档或经验已链接至对应 `README.md`。
3. **代码卫生 / Biome 报错**：单源码文件上限 360 行，禁止 `@ts-ignore`/`@ts-nocheck`/显式 `any` 及仓库根目录野文件；格式问题可用 `npm run format` 修复。
4. **端口占用**：通过 `PORT` / `WEB_PORT` 临时改端口后重试 `npm run dev`。
