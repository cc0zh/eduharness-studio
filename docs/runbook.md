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
- 服务启动读取仓库根 `.env`（可用 `STUDIO_ENV_FILE` 指向独立文件），同名进程环境变量优先。内置供应商沿用原生变量，如 `OPENAI_API_KEY`、`OPENROUTER_API_KEY`。用 `STUDIO_MODEL_PROVIDER`、`STUDIO_MODEL_ID`、`STUDIO_MODEL_BASE_URL` 设置供应商、模型和 Base URI。自定义 OpenAI 格式使用 `openai-compatible` 和 `OPENAI_COMPATIBLE_API_KEY`，需要明确指定 Base URI 与模型 ID。
- Base URI 填 API 根地址，例如 `http://127.0.0.1:8080/v1` 或 `https://openrouter.ai/api/v1`。地址格式要求 HTTP(S) 且省略 URL 凭据、查询参数和片段。生成和拉取目录均使用服务端 `HTTPS_PROXY` / `HTTP_PROXY` 和 `NO_PROXY`。
- 「拉取模型」会向选定供应商发送一次 `GET /models`。空密码框仅复用同供应商、同规范化 Base URI 的已有凭据。切换地址需输入该地址的 Key。拉取失败时可用预设或手填模型 ID。保存本身只更新配置。`live` 表示已配置，真实模型冒烟须先获费用授权。
- `node --test test/browser-m2-1.test.mjs` 用 loopback 复验顶栏流程。设置 `STUDIO_MODEL_LIST_SCREENSHOTS` 可保存 M2-1b Chromium 截图。

## 常见排障

1. **三层导入边界报错**：跨层使用 `@eduharness-studio/engine`；只有服务端可引用 `@eduharness-studio/engine/models`，不能经引擎根入口转接。
2. **文档门禁报错**：确认未在根目录或 `docs/` 根目录新建未登记 `.md`，未超出活文档行数预算，且新增归档或经验已链接至对应 `README.md`。
3. **代码卫生 / Biome 报错**：单源码文件上限 360 行，禁止 `@ts-ignore`/`@ts-nocheck`/显式 `any` 及仓库根目录野文件；格式问题可用 `npm run format` 修复。
4. **端口占用**：通过 `PORT` / `WEB_PORT` 临时改端口后重试 `npm run dev`。
