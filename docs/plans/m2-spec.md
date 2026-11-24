# M2 详细规格书：真实模型与完整课堂闭环

> 状态：活动规格书（第 2.4 节配图生成机制已随 M1.5 定案回填，其余后端与纯引擎边界已对齐）。总览见 [路线图](roadmap.md) 与 [验收场景](../scenarios.md)。

## 1. 架构边界与硬红线

- **唯一模型边界与子路径隔离**：
  - 仅 [packages/engine/src/models.ts](../../packages/engine/src/index.ts)（新增模块，通过 `packages/engine/package.json` 暴露 `@eduharness-studio/engine/models` 子路径）允许导入 `@earendil-works/pi-ai`；**禁止从 `packages/engine/src/index.ts` 重导出**，确保前端 `apps/web` 零打包模型 SDK 且不触碰 [导入边界门禁](../../scripts/check-boundaries.mjs)。
  - 直接复用 `@earendil-works/pi-ai` 内置供应商注册表与鉴权体系，不手写各家 HTTP 适配器；`packages/engine` 保持零 `node:*` 耦合，环境变量读取、`.env` 加载与 `HTTPS_PROXY` 代理分发由 `apps/server` 注入。
- **密钥安全与离线零回归**：
  - 支持 `.env` 与顶栏内存态 BYOK 配置；明文密钥**仅驻留服务端进程内存**，严禁写入 SQLite、日志、错误消息或浏览器持久化存储，接口永不回显明文密钥。
  - 无可用 Key 时自动回落零密钥离线模式；2 节精选示范课保持零密钥离线秒开，现有 M1 全部单测与 Playwright E2E 回归保持全绿。
- **上屏证据与预算红线**：
  - 真模型续讲、打断截断、公开对话投影与 X-Ray 追踪严格沿用 [演播证据边界](../learnings/2026-11/played-evidence.md)，只认播放器确认的 `last_played_step_id`。
  - 本地门禁与 CI 全程使用 `pi-ai` faux/mock 通道零网络验证；真实付费模型冒烟前须先报备预计请求数与 token 上限并获明确授权。

## 2. 核心能力与接口行为契约

字段与校验规则以源码 TypeBox Schema（[protocol.ts](../../packages/engine/src/protocol.ts)、[session-protocol.ts](../../packages/engine/src/session-protocol.ts)、[intake.ts](../../packages/engine/src/intake.ts)）为单一事实源，本节只定义 M2 增量行为：

### 2.1 模型网关与内存态 BYOK

- `models.ts` 对外提供统一结构化生成调用（带 TypeBox Schema 校验、超时控制、受控重试与 `durationMs` 采集）和当前运行态查询（`mode: 'offline' | 'live'`、已选 `provider` / `modelId`、来源 `env | byok | none`）。
- 服务端新增轻量配置接口：`GET /api/model`（返回脱敏状态与可选供应商/模型目录）、`PUT /api/model`（写入内存态 BYOK 供应商、模型与 Key，不落盘）、`DELETE /api/model`（清空 BYOK 并回落 `.env` 或离线模式）。
- 前端顶栏开放极简 BYOK 弹窗（接入现有 `Dialog` 原语），切换后立即反映在当前会话的后续建课、解锁与教学回合中。

### 2.2 自由主题建课、懒生成课节解锁与 `basis` 槽位

- **真模型建课**：`/api/intake/generate` 在 `live` 模式下调用模型网关，根据主题与 2–3 步校准答案动态产出 `CourseBlueprint`（严禁写死单元/课节数），首节置 `ready`、其余课节置 `locked` 并写入 SQLite `courses`；`offline` 模式下维持 M1 确定性生成。
- **按需解锁懒生成课节**：
  - 新增 `POST /api/courses/:courseId/lessons/:lessonId/unlock`：当用户点击蓝图中 `locked` 课节时，按课程蓝图上下文与前序已学要点生成该课节的动态 `Keypoint[]`、可选 `LessonBasis` 与首回合剧本，原子持久化进 SQLite 并将蓝图中该课节状态更新为 `ready`。
  - 同一课节并发点击须幂等去重（不重复触发多次付费请求）；已 `ready`/`completed` 课节直接返回就绪态。
- **可选 `basis` 槽位预留（为 M4 铺路）**：
  - 在课节持久化契约中预留可选 `LessonBasis`（核心目标、关键示例/推导要点、典型误解与可选外部来源 `sources?: { id, title, url?, snippet }[]`）。M2 无联网检索时由模型依据自身知识生成或留空，M4 接入轻联网调研时无需破坏性迁移。

### 2.3 单循环状态机教师引擎、打断续讲与 `calc_verify`

- **按回合动态生成**：
  - 开课、学生提交 `ask` 回答或演播中途打断时，服务端汇总「目标要点 + 当前 `TeachingState`（[state.ts](../../packages/engine/src/state.ts)）+ 可选 `LessonBasis` + 已上屏白板摘要 + 已确认公开对话 + 学生最新输入」，经单循环调用模型网关产出下一批 `ActionBatch`（`step_id` 严格递增，禁止引用已截断 `card_id`），校验通过后入队并沿既有 SSE 逐拍下发。
- **防 V 维退化护栏**：
  - 吸取 `eduharness` 阶段 3 教训，**严禁在 prompt 或代码中硬塞固定交权套话**；改由纯引擎状态机对模型输出的 `ActionBatch` 做硬校验（未经历 `ask → 学生作答 → speak(checkpoint='verify')` 禁止发出 `keypoint_complete`；首回合禁止直接揭底全解），不合规则附具体错误原因自动纠偏重试（最多 2 次），超限则报错并保住已上屏现场不污染会话。
- **受控计算工具 `calc_verify`**：
  - 在 `packages/engine` 实现零 `eval`、零网络的安全算式/分数/概率求值器；教师回合在需要核对数值或公式代入时可执行一次受控 `calc_verify` 再定稿板书，把工具名、脱敏入参/结果与耗时写入 `LessonTraceSpan`（扩展 `kind: 'offline' | 'model' | 'tool'`）。
- **批推与流式演进**：
  - M2 先跑稳单次结构化 JSON 校验后按拍推 SSE；若真实冒烟实测首拍等待普遍超过 2 秒，再基于 `pi-ai` 内置 `streaming-json` 平滑升级为增量逐拍解析（前后端 SSE 协议零改动）。

### 2.4 白板配图（`graph`）生成机制（M1.5 已定案）

- 经 M1.5 视觉样板拍板，M2 正式采用 **方案 A（分工画图 + 预设统一画风静态 SVG）**：引擎层提供可插拔 `GraphGenerator` 钩子，使用固定出版铜版风色板约束（底色 `#F6F3EC`、主墨 `#1A1917`、次墨 `#4D4943`/`#827B71`、焦点赤陶 `#A84428`、淡琥珀 `#ECD49B` 与细线排线）生成静态 SVG，并强制经既有 `sanitizeSvg` 白名单消毒后以 `data:image/svg+xml` 渲染；生成失败或被消毒拒绝时优雅退回文字板书不阻断课堂。

### 2.5 `Agent X-Ray` 边界

- 沿用现有 3 页签与 `#n` 跨页高亮机制；「对话与追踪」补全真实模型调用与 `calc_verify` 工具耗时 span；「6 维质检」在 M2 继续走离线快检，**不在本仓维护真模型 6 维裁判 prompt**（真 6 维裁判统一走 M3 的 `eduharness-ts --judge-only`）。

## 3. 切片清单与依赖顺序

均须遵守单文件 ≤ 360 行、零显式 `any`、三层导入隔离与 `npm run check` 全绿：

1. **M2-1 · `pi-ai` 统一模型网关、代理注入与内存态 BYOK**（基础前置）
   - **交付**：`packages/engine/src/models.ts`（子路径 `@eduharness-studio/engine/models`）+ `apps/server` 环境变量/代理注入与 `/api/model` 内存态接口 + 顶栏 BYOK 弹窗 + `pi-ai` faux 通道单测与边界负例测试。
   - **黑盒验收**：零密钥下 `/api/model` 报离线且 M1 全套 Playwright 回归全绿；填入假 Key 经 mock 通道可切换 `live`、清空即回落离线，校验 SQLite 与日志零明文密钥。
   - **不算交付**：把 `models.ts` 暴露进前端 bundle、密钥写入磁盘/日志、或无 Key 时破坏离线演示。
2. **M2-2 · 自由主题真模型建课、懒生成课节解锁与 `basis` 持久化**（依赖 M2-1；可与 M2-3 纯引擎单测并行）
   - **交付**：真模型蓝图生成 + SQLite 课节生成产物与可选 `basis` 存储 + `POST /api/courses/:courseId/lessons/:lessonId/unlock`（幂等防并发）+ 蓝图页点击 `locked` 课节解锁进入白板交互与 Playwright 测试。
   - **黑盒验收**：mock 模型通道下输入任意主题生成动态单元与课节 → 点击第 2 节 `locked` 课节触发懒生成并点亮进课堂 → 刷新页面后解锁状态与蓝图持久化不丢失。
   - **不算交付**：仍写死固定单元/课节、点击 `locked` 仍报 409、或并发点击触发重复生成。
3. **M2-3 · 单循环状态机教师引擎、打断续讲与 `calc_verify`**（依赖 M2-1，与 M2-2 汇合联调）
   - **交付**：纯引擎回合编排与状态机护栏（保 `verify`、结构化纠偏重试）+ 零 `eval` `calc_verify` 工具与 `model`/`tool` trace span + `apps/server` 接通真模型开课/作答/打断截断续讲 + X-Ray 展示模型与工具耗时。
   - **黑盒验收**：mock 模型通道下验证正常作答过关、演播中途打断截断并沿已上屏 `last_played_step_id` 续讲、非法跳过 `verify` 被引擎自动拦截重试、`calc_verify` 耗时出现在 X-Ray 追踪面板；刷新恢复与离线回归全绿。
   - **不算交付**：打断引用未上屏拍、跳过 `verify` 直接 `keypoint_complete`、或把固定交权套话写死进代码。
4. **M2-4 · 配图钩子定型与授权后真模型端到端冒烟**（依赖 M2-2 + M2-3 + M1.5 配图拍板 + 用户预算授权）
   - **交付**：按 M1.5 拍板结果落定 `GraphGenerator` + 经用户预算确认后跑通 1 次真实模型端到端冒烟（自由主题建课 → 解锁第 2 节 → 白板演播 + `calc_verify` + 打断续讲 → 刷新恢复），收据与截图存 `C:\tmp\eduharness-studio\m2\`；若实测首拍等待 > 2 秒再按需评估流式逐拍解析。
   - **黑盒验收**：真实浏览器完成一次无报错全链路真实授课并留存截图与耗时记录，`npm run check` 全绿。
   - **不算交付**：仅用 mock 冒充真模型冒烟，或未经预算授权擅自发起付费请求。

## 4. M2 明确不做项（Out of Scope）

- 不在 `eduharness-studio` 内实现真模型 6 维裁判（留 M3 经 `eduharness-ts --judge-only` 验真）；
- 不接入外部联网搜索 API（留 M4，本阶段仅预留可选 `basis` 槽位）；
- 不做多轮自由 UI Tool-Calling、登录鉴权、外部数据库、语音 TTS 或自由手绘；
- 不修改兄弟仓库（`eduharness`、`eduharness-ts`、`mini-eduharness2`、`resume`）。
