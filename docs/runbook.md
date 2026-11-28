# 运行与排障手册

## 环境要求

- Node.js `>= 22.19.0`（使用内置 `node:sqlite` 与原生 `node --test`）
- pnpm `10.4.1`（以 `package.json` 的 `packageManager` 为准）。`package.json` 白名单仅允许 `esbuild` 安装脚本；`@google/genai` 和 `protobufjs` 的脚本不产出构建文件，macOS 的 `fsevents` 已随包提供预编译件，无需手动批准。

## 常用命令

```bash
# 从旧工作区切换时先移除根目录与子包中的旧 node_modules，再冻结安装
pnpm install --frozen-lockfile
# store 已备齐时可改用 pnpm install --offline --frozen-lockfile
pnpm exec playwright install chromium

# 一键运行全套门禁（静态门禁 + 前端构建 + 全部测试）
pnpm run check

# 秒级静态门禁（pre-commit 自动执行：边界 + 文档 + 代码卫生 + Biome + tsc）
pnpm run check:static

# 单跑专项检查与自动格式化
pnpm run check:boundaries
pnpm run check:docs
pnpm run check:hygiene
pnpm run lint
pnpm run format
pnpm run typecheck
pnpm test
pnpm run test:e2e

# 同时启动本地后端（3001）与前端（5173）
pnpm run dev

# 只读导出最近一轮课堂的已上屏公开对话到新目录，供 eduharness-ts --judge-only 评分
mkdir -p .tmp
pnpm run export:judge --db data/studio.sqlite --out-dir .tmp/judge-export

# 离线零外网预演 M3 四场景对抗采集（不发真实模型请求）
pnpm run m3:rehearse --out-dir .tmp/m3-rehearsal
```

## 端口与数据库配置

- 可通过环境变量覆盖默认端口与 SQLite 路径：`PORT=3001`、`WEB_PORT=5173`、`STUDIO_DB_PATH=data/studio.sqlite`（测试可使用 `:memory:`）。
- 本地开发无需 `.env` 与 API Key；`data/` 目录已被 `.gitignore` 忽略。
- Playwright 仅为开发依赖：真实 Chromium 验收课堂交互，不进入部署包。E2E 自启随机端口和临时 SQLite；CI 同时安装 Chromium 的系统依赖。
- 复验开发启动路径时，以 `STUDIO_E2E_DEV=1` 运行 `pnpm run test:e2e`；可选 `STUDIO_E2E_SCREENSHOTS` 指定截图目录。
- X-Ray 离线质检沿用 `eduharness` 工作尺子 `e1-binary-v3` 的 19 题与汇总口径；本地规则只近似判断可观测证据，不等同模型裁判。

## 模型配置（M2-1）

- 顶栏「模型与自带密钥」从 `/api/model` 读取状态和目录。临时 Key 仅保存在本地服务进程，刷新页面会读回状态（不读回 Key）；清空或重启服务回落环境配置，无 Key 则离线。
- 服务启动读取仓库根 `.env`（可用 `STUDIO_ENV_FILE` 指向独立文件）；同名进程环境变量优先。使用供应商原生变量（如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`），可用 `STUDIO_MODEL_PROVIDER` / `STUDIO_MODEL_ID` 指定模型；未指定则用首个有凭据的目录项。模型调用可经 `HTTPS_PROXY`，支持 `NO_PROXY`。
- 服务端通过 `pi-ai` 适配 OpenAI、Anthropic、DeepSeek、Moonshot AI、OpenRouter 与自定义 OpenAI-compatible；支持单 Key 和代理传输。使用 `STUDIO_MODEL_PROVIDER`、`STUDIO_MODEL_ID`、`STUDIO_MODEL_BASE_URL` 设置供应商、模型和 Base URI；自定义 OpenAI-compatible 使用 `OPENAI_COMPATIBLE_API_KEY`，并明确指定 Base URI 与模型 ID。
- Base URI 填 API 根地址（如 `http://127.0.0.1:8080/v1`），必须为 HTTP(S)，不可包含凭据、查询参数或片段。生成与目录请求使用服务端 `HTTP_PROXY` / `HTTPS_PROXY` 和 `NO_PROXY`。
- 顶栏「拉取模型」请求一次 `GET /models`；空密码框仅复用同供应商、同规范化 Base URI 的已有凭据，切换地址需输入该地址的 Key。拉取失败可改用预设或手填模型 ID，保存本身只更新配置。`live` 表示已配置，不代表模型请求已通过；真实模型调用前须获费用授权。
- 带模型配置新开或重开非示范课会调用 Teacher Agent；运行中模型不可用时保留已提交作答，并以离线方式将未完成要点标为未验证。
- `node --test test/browser-m2-1.test.mjs` 用 loopback 复验 BYOK 与模型目录；设置 `STUDIO_MODEL_LIST_SCREENSHOTS` 保存 M2-1b Chromium 截图。Teacher Agent 用例注入独立 faux 网关和临时 SQLite；设置 `STUDIO_TEACHER_SCREENSHOTS` 保存其截图。

## 常见排障

1. **三层导入边界报错**：跨层使用 `@eduharness-studio/engine`；只有服务端可引用 `@eduharness-studio/engine/models`，不能经引擎根入口转接。
2. **文档门禁报错**：确认未在根目录或 `docs/` 根目录新建未登记 `.md`，未超出活文档行数预算，且新增归档或经验已链接至对应 `README.md`。
3. **代码卫生 / Biome 报错**：单源码文件上限 360 行，禁止 `@ts-ignore`/`@ts-nocheck`/显式 `any` 及仓库根目录野文件；格式问题可用 `pnpm run format` 修复。
4. **端口占用**：通过 `PORT` / `WEB_PORT` 临时改端口后重试 `pnpm run dev`。
