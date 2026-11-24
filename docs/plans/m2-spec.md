# M2 详细规格书：真实模型与完整课堂闭环

> 状态：活动规格书（已结合 M1.5 配图定案与方向校准更新：聚焦单堂课认知规划 Teacher Agent 闭环，并将 M2 切片调序为“先打穿单堂真课并尽早亲测，再补薄蓝图与配图”）。总览见 [路线图](roadmap.md) 与 [验收场景](../scenarios.md)。

## 1. 架构边界与硬红线

- **80/20 聚焦原则**：
  - 将 80% 工程深度投入**单堂课的严师活白板、认知规划 Teacher Agent（诊断 → 工具/动态插点 → 护栏自纠偏）、打断续讲与 `Agent X-Ray` 证据闭环**；
  - 课程蓝图/懒解锁与静态 SVG 配图刻意**做薄做稳、宁缺毋滥**（非每课强求画图，优先结构化要点/表格/KaTeX 公式保住出版书房排版质感）。

- **唯一模型边界与子路径隔离**：
  - 仅 [packages/engine/src/models.ts](../../packages/engine/src/models.ts)（通过 `packages/engine/package.json` 暴露 `@eduharness-studio/engine/models` 子路径）允许导入 `@earendil-works/pi-ai`；**禁止从 `packages/engine/src/index.ts` 重导出**，确保前端 `apps/web` 零打包模型 SDK 且不触碰 [导入边界门禁](../../scripts/check-boundaries.mjs)。
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
- M2-1b 支持 OpenRouter 和自定义 OpenAI 格式。`POST /api/model/fetch-models` 使用所选供应商及 Base URI 拉取 `/models`，同一供应商与地址可留空复用已有凭据。弹窗保留预设与手填模型 ID；自定义格式走 `pi-ai` 的 OpenAI Completions 实现。环境变量与使用步骤见[运行手册](../runbook.md#模型配置m2-1)。
- 前端顶栏复用 `Dialog` 配置 BYOK；保存/清空立即反映在状态查询中。`live` 表示已配置，保存不发模型请求。M2-2、M2-3 再接入教学回合、建课和解锁；示范课仍离线。

### 2.2 自由主题建课、懒生成课节解锁与 `basis` 槽位

- **真模型建课**：`/api/intake/generate` 在 `live` 模式下调用模型网关，根据主题与 2–3 步校准答案动态产出 `CourseBlueprint`（严禁写死单元/课节数），首节置 `ready`、其余课节置 `locked` 并写入 SQLite `courses`；`offline` 模式下维持 M1 确定性生成。
- **按需解锁懒生成课节**：
  - 新增 `POST /api/courses/:courseId/lessons/:lessonId/unlock`：当用户点击蓝图中 `locked` 课节时，按课程蓝图上下文与前序已学要点生成该课节的动态 `Keypoint[]`、可选 `LessonBasis` 与首回合剧本，原子持久化进 SQLite 并将蓝图中该课节状态更新为 `ready`。
  - 同一课节并发点击须幂等去重（不重复触发多次付费请求）；已 `ready`/`completed` 课节直接返回就绪态。
- **可选 `basis` 槽位预留（为 M4 铺路）**：
  - 在课节持久化契约中预留可选 `LessonBasis`（核心目标、关键示例/推导要点、典型误解与可选外部来源 `sources?: { id, title, url?, snippet }[]`）。M2 无联网检索时由模型依据自身知识生成或留空，M4 接入轻联网调研时无需破坏性迁移。

### 2.3 认知规划型 Teacher Agent、诊断型互动与 `calc_verify`

- **按回合认知闭环（显式诊断 + 动态插拔补课要点）**：
  - 开课、学生提交 `ask` 回答或演播中途打断时，服务端汇总「当前 `keypoints` 与活跃要点 + 当前 `TeachingState`（[state.ts](../../packages/engine/src/state.ts)）+ 可选 `LessonBasis` + **仅已上屏**白板摘要 + **仅已确认**公开对话 + 学生最新输入」，经单回合受控编排产出结构化 `TeacherTurnOutput`：
    - `diagnosis`：`status`（`opening | mastered | misconception | missing_prereq | answer_seeking | low_effort | clarifying`）、一句话错因/状态摘要 `summary` 与本轮教法 `strategy`（写入 `SessionTrace` 供 X-Ray 透视，学生侧隐藏）；
    - 可选 `insert_keypoint`：仅当诊断为 `missing_prereq` 时允许在当前要点前动态插入 1 个临时补课要点（单课最多插 2 个、总要点 ≤ 6），原子更新会话 `keypoints` 并同步前端进度条与 SQLite 恢复；
    - `actions`：本回合 4–8 拍 `ActionDraft[]`（严格递增 `step_id`，禁引已截断 `card_id`），校验通过后追加进队列沿既有 SSE 逐拍下发。
- **诊断型选项 `ask` + 自定义输入 + 敷衍柔性降级**：
  - 扩展 `AskActionSchema`：当 `mode === 'choice'` 时支持 `options?: { id, label }[]`；Prompt 约束干扰项来自高频直觉误解、字数与口吻一致并附带“我拿不准 / 给点提示”类逃生项，引擎侧随机打乱选项顺序防止位置蒙猜；前端 [LessonAskCard.tsx](../../apps/web/src/LessonAskCard.tsx) 渲染一键点选卡片并在下方保留紧凑自定义输入框。
  - `verify` 过关检验优先采用**变式近迁移判断**（换数值或边界条件），既降低打字摩擦又防语感蒙混，与 `eduharness` V 维同源。
  - 面对 `"1"` / `"继续"` / `"直接讲"` 等 `low_effort` 敷衍输入：第 1 次**不死锁也不放水**（不发 `keypoint_complete`，自动降级为 2 选 1 极简直觉点选题）；连续敷衍或明确要求跳过时继续推进不劝退，但诚实记录为 `unverified`（绝不伪装 `mastered`），并在 X-Ray 透明标注。
- **状态机硬护栏、排版节奏约束与自纠偏**：
  - 吸取 `eduharness` 阶段 3 教训，**严禁在 prompt 或代码中硬塞固定交权套话**；改由纯引擎状态机硬校验（`diagnosis.status !== 'mastered'` 或未经历已上屏的 `ask(checkpoint='verify') → 学生作答 → speak(checkpoint='verify')` 均禁止发出 `keypoint_complete`；首回合禁直接揭底；非结课回合须停在 `ask`；约束单张板书/字幕长度与单回合 4–8 拍以守住 M1.5 排版质感）。跳过由独立的 `keypoint_unverified` 拍推进，不计过关。
  - 违规时附具体错误原因触发自纠偏重规划（最多重试 2 次），拦截与重试轨迹写入 `SessionTrace`；超限则报错并保住已上屏现场不污染会话。服务端采用「事务外异步调模型 + 会话级并发互斥锁 + 校验通过后短事务原子落盘」。
- **受控计算工具 `calc_verify`**：
  - 在 `packages/engine` 实现零 `eval`、零网络的安全算式/分数/概率求值器；作为最多 2 步轻工具循环挂入 `pi-ai`，需要核对数值或构造反例时先调用 `calc_verify` 再定稿板书，把工具名、脱敏入参/结果与耗时写入 `LessonTraceSpan`（扩展 `kind: 'offline' | 'model' | 'tool'`）。
- **批推与流式演进**：
  - M2 先跑稳小批次（4–8 拍）结构化 JSON 校验后按拍推 SSE；若真实试学实测首拍等待普遍超过 2 秒，再基于 `pi-ai` 内置 `streaming-json` 平滑升级为增量逐拍解析（前后端 SSE 协议零改动）。

### 2.4 白板配图（`graph`）生成机制（M1.5 已定案）

- 经 M1.5 视觉样板拍板，M2 正式采用 **方案 A（分工画图 + 预设统一画风静态 SVG）**：坚持**宁缺毋滥**原则（非每课强求配图，优先结构化板书/表格/KaTeX 公式），引擎层提供可插拔 `GraphGenerator` 钩子，使用固定出版铜版风色板约束（底色 `#F6F3EC`、主墨 `#1A1917`、次墨 `#4D4943`/`#827B71`、焦点赤陶 `#A84428`、淡琥珀 `#ECD49B` 与细线排线）生成静态 SVG，并强制经既有 `sanitizeSvg` 白名单消毒后以 `data:image/svg+xml` 渲染；生成失败或被消毒拒绝时优雅退回文字板书不阻断课堂。

### 2.5 `Agent X-Ray` 边界

- 沿用现有 3 页签与 `#n` 跨页高亮机制；「对话与追踪」补全每回合**显式认知诊断（`diagnosis`）、动态插点记录、护栏拦截自纠偏轨迹**以及真实模型与 `calc_verify` 工具耗时 span；「6 维质检」在 M2 继续走离线快检，**不在本仓维护真模型 6 维裁判 prompt**（真 6 维裁判统一走 M3 的 `eduharness-ts --judge-only`）。

## 3. 切片清单与依赖顺序（调序版：先打穿单堂真课）

均须遵守单文件 ≤ 360 行、零显式 `any`、三层导入隔离与 `npm run check` 全绿：

1. **M2-1 · `pi-ai` 统一模型网关、代理注入与内存态 BYOK**（顺序前置）
   - **交付**：`packages/engine/src/models.ts`（子路径 `@eduharness-studio/engine/models`）+ `apps/server` 环境变量/代理注入与 `/api/model` 内存态接口 + 顶栏 BYOK 弹窗 + `pi-ai` faux 通道单测与边界负例测试。
   - **黑盒验收**：零密钥下 `/api/model` 报离线且 M1 全套 Playwright 回归全绿；填入假 Key 经 mock 通道可切换 `live`、清空即回落离线，校验 SQLite 与日志零明文密钥。
   - **不算交付**：把 `models.ts` 暴露进前端 bundle、密钥写入磁盘/日志、或无 Key 时破坏离线演示。
2. **M2-2 · 单堂课认知规划 Teacher Agent 闭环、诊断型 `ask`、打断续讲与早期真机试学**（顺序接力，依赖 M2-1；核心拳头切片）
   - **交付**：纯引擎回合编排（显式 `diagnosis` + 动态插补课要点 + 排版/状态机硬护栏自纠偏）+ `AskActionSchema` 诊断选项与引擎洗牌 + [LessonAskCard.tsx](../../apps/web/src/LessonAskCard.tsx) 点选卡片与自定义输入 + 敷衍柔性降级 + 零 `eval` `calc_verify` + `apps/server` 事务外异步编排与并发锁 + X-Ray 展示诊断/拦截/工具耗时；并在**获明确预算授权后尽早亲身真学 1–2 个陌生硬核概念**（留存试学收据与截图至 `C:\tmp\eduharness-studio\m2\`），确认体感达标后再进入 M2-3。
   - **黑盒验收**：mock 通道验证正常点选/自定义作答过关、`"1"` 敷衍自动降级二选一不放水、卡壳动态插入临时补课要点且刷新持久化、演播中途打断截断并沿已上屏 `last_played_step_id` 续讲、非法跳过 `verify` 被护栏拦截重试、`calc_verify` 与诊断轨迹出现在 X-Ray；授权后完成 1–2 节真实模型试学，离线回归全绿。
   - **不算交付**：打断引用未上屏拍、非 `mastered` 放行 `keypoint_complete`、死锁卡死敷衍用户、把固定交权套话写死进代码，或未经预算授权擅自发起付费请求。
3. **M2-3 · 自由主题真模型建课（薄版）、懒生成课节解锁与 `basis` 持久化**（顺序接力，M2-2 真机体感过关后启动；纯引擎单测可提前与 M2-2 并行）
   - **交付**：真模型蓝图生成 + SQLite 课节生成产物与可选 `basis` 存储 + `POST /api/courses/:courseId/lessons/:lessonId/unlock`（幂等防并发）+ 蓝图页点击 `locked` 课节解锁进入白板交互与 Playwright 测试。
   - **黑盒验收**：mock 模型通道下输入任意主题生成动态单元与课节 → 点击第 2 节 `locked` 课节触发懒生成并点亮进课堂 → 刷新页面后解锁状态与蓝图持久化不丢失。
   - **不算交付**：仍写死固定单元/课节、点击 `locked` 仍报 409、或并发点击触发重复生成。
4. **M2-4 · 静态铜版风配图钩子（宁缺毋滥）与全链路真机冒烟收口**（顺序收官，依赖 M2-2 + M2-3 + 用户预算授权）
   - **交付**：按 M1.5 拍板落定 `GraphGenerator`（不合规优雅退回文字板书）+ 经预算授权跑通 1 次完整端到端真机冒烟（自由主题建课 → 解锁第 2 节 → 白板演播 + 诊断选项 + `calc_verify` + 打断续讲 → 刷新恢复），收据与截图存 `C:\tmp\eduharness-studio\m2\`；若实测首拍等待 > 2 秒再按需评估流式逐拍解析。
   - **黑盒验收**：真实浏览器完成一次无报错全链路真实授课并留存截图与耗时记录，`npm run check` 全绿。
   - **不算交付**：仅用 mock 冒充真模型冒烟、将破损 SVG 放上白板，或未经预算授权擅自发起付费请求。

## 4. M2 明确不做项（Out of Scope）

- 不在 `eduharness-studio` 内实现真模型 6 维裁判（留 M3 经 `eduharness-ts --judge-only` 验真）；
- 不接入外部联网搜索 API（留 M4，本阶段仅预留可选 `basis` 槽位）；
- 不做重型前端交互沙箱（参数滑块/可执行代码沙箱）、多轮自由 UI Tool-Calling、登录鉴权、外部数据库、语音 TTS 或自由手绘；
- 不修改兄弟仓库（`eduharness`、`eduharness-ts`、`mini-eduharness2`、`resume`）。
