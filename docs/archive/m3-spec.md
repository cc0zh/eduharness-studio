# M3 详细规格书：`eduharness-ts` 双项目真评测闭环与收官

> 状态：已收官归档。M3-1 ~ M3-3d 已完成首轮双项目授权真机闭环验真（`live-02` + `m3-3-live-01`）；依收官决策未立项追加真机修复，已核实的跨字段数值漂移与固定脚本驱动边界诚实入档。实测与收据见 [当前状态](../status.md#m3-验收证据) · [路线图](../plans/roadmap.md)。
>
> **采用的两项跨仓取舍**：① `eduharness-ts --judge-only` 允许以 `teacher` 收尾的偶数长度严格交替对话（不丢末尾结课/纠偏证据、不伪造假学生收尾，99/99 黄金零偏差）；② M3 的 4 节高区分度对抗白板课采用可复现 Playwright 真实浏览器场景驱动，同时 CLI 原生兼容任意人工手玩 SQLite 会话导出。

## 1. 定位边界与硬红线

- **收官定位与冻结边界**：
  - 双项目职责严格分工：`eduharness-ts` 提供可验真的 6 维 19 题二元证据尺子与离线 HTML 复核报告；`eduharness-studio` 提供受控规划、状态机护栏、打断事实边界与 `Agent X-Ray` 的全栈 Agent 实现。
  - **前端 UI、首页/蓝图交互与铜版风配图方案全面冻结**；仅当 M3 真实 6 维评测检出明确可归因的 Teacher Agent 缺陷时，允许执行**至多 1 轮**最小引擎修复与同场景对比复测（本轮收官选择如实建档、不追加付费修复）。
- **跨仓写入与静态门禁边界**：
  - M3 仅修改 `eduharness-studio` 与 `eduharness-ts` 两仓；兄弟仓 `eduharness`、`mini-eduharness2`、`resume` 全程只读。
  - `eduharness-studio` 严守[三层导入边界](../../scripts/check-boundaries.mjs)、[单文件 ≤ 360 行与零显式 `any`](../../scripts/check-code-hygiene.mjs) 及文档门禁；`eduharness-ts` 严守其单文件 ≤ 350 行、总源码 ≤ 5500 行、全文件从 `src/cli.ts` 静态可达、`99/99` 黄金对拍 0 偏差与文档白名单。
- **上屏证据、隐私与预算红线**：
  - 对话导出严格遵循[演播证据边界](../learnings/2026-11/played-evidence.md)，只采信确认上屏的 `step_id <= last_played_step_id` 与持久化学生记录，绝不泄入被截断未播拍、不伪造学生收尾消息、不输出任何密钥或模型凭据。
  - 日常门禁与联调全程离线/faux 零外网；任何真实付费授课或真实 `--judge-only` 裁判执行前，必须先跑 `--estimate-only` 报备请求数与 token 上限并获用户明确授权，绝不以离线结果冒充真机验收。

## 2. 核心能力与跨仓接口契约

字段与校验规则以双仓 TypeBox Schema 为单一事实源（本仓见 [projection.ts](../../packages/engine/src/projection.ts)、[session-db.ts](../../apps/server/src/session-db.ts)；评测仓见 `eduharness-ts/src/contracts/core/cell-batch.ts`、`src/contracts/judge/ruling.ts`），本节记录 M3 增量契约：

### 2.1 `eduharness-ts` 极轻 `--judge-only` 外部对话评分入口

- **输入与编排边界**：扩展 `eduharness-ts/src/cli.ts` 支持 `--judge-only` 计划模式（外部计划 JSON 中每个 cell 携带预录制 `transcript: EvidenceMessage[]`，不触发 `runner/teacher.ts` 对话生成，0 次师生模型调用）；单格经 `checkDialogue` 校验并固化为 `dialogue` checkpoint 后，直接进入既有 6 维拆分裁判循环。
- **首尾形状与黄金零回归**：允许 `messages.length >= 3` 且 `#1` 为 `learner` (`turn: 0`)、后续严格交替的对话（兼容 `studio` 结课确认或打断回复落在末尾 `teacher` 的偶数条对话）；`e1-binary-v3` 19 题题干、提示词、证据时序/窗口规则、`scoreBinary` 定档与既有 99 格黄金样本保持 0 偏差。
- **身份、预算与实跑鉴权**：`manifest.identity` 显式区分 `judge-only` 评测身份；`estimate` 按 `6 次裁判/格` 精确计算典型与上限（`attempts` 与 `requestedOutputTokens`）；`--judge-only --mode real` 仅要求 `OPENROUTER_API_KEY` + `--proxy-from-env`（非空 `HTTPS_PROXY`）+ `--confirm-cost`，不再强求 `DEEPSEEK_API_KEY`。原 `--resume`、停批规则、429 降档、`--verify-run` 与 `--export-report` 单文件离线 HTML 报告全量原生复用。

### 2.2 `eduharness-studio` 裁判投影转换与 CLI 导出脚本

- **纯引擎无损投影（`packages/engine`）**：基于 [projection.ts](../../packages/engine/src/projection.ts) 新增纯函数，将已上屏 `played` 动作流与学生 `records` 转为 `eduharness-ts` 可消费的 `EvidenceMessage[]`：
  - 由课程 `topic`、课节标题/目标与可选轻调研目标确定性构造 `#1 learner (turn: 0)` 起手诉求（客观呈现入课目标，不伪造学生作答或推理），随后按已上屏动作与学生输入严格交替归并；
  - 保留纯文本 LaTeX、板书/图示摘要、提问选项与打断/未验证/过关事实标签；
  - 严格前置校验：至少 3 条交替消息（至少含 1 次真实学生作答或打断），空课/未互动课或未对齐上屏游标的会话明确拒收并报错。
- **只读 CLI 导出入口**：经根 `package.json` 暴露 `npm run export:judge`（[judge-export.ts](../../apps/server/src/judge-export.ts)），读取指定 SQLite（默认 `STUDIO_DB_PATH` 或 `--db`）及 `--session` / `--latest`，输出 `eduharness-ts --judge-only` 可直接消费的计划 JSON 与脱敏元数据清单。

### 2.3 4 节高区分度对抗白板课与 Eval-Driven 闭环协议

- **样本矩阵**：`C1-transfer`（硬核概念近迁移过关）、`C2-pressure`（伸手要答案 + 连续敷衍）、`C3-interrupt`（演播中途打断插话）、`C4-prereq`（暴露前置知识缺口）。
- **Eval-Driven 闭环纪律**：若首次真机 `judge-only` 验真暴露出明确缺陷，至多立项 1 轮定向小修；若以验证双项目工程闭环为主或触及已知边界，则如实建档、不强行刷分。

## 3. 切片执行结果

1. **M3-1（已完成 · `eduharness-ts@1208959`）**：交付 `--judge-only` 入口、奇偶严格交替校验、6 次/格预算估算、仅 OpenRouter 实跑鉴权与单元/E2E 回归（99/99 黄金 0 偏差）。
2. **M3-2（已完成 · `dbfb75a`）**：交付纯引擎 `EvidenceMessage[]` 投影与只读 SQLite CLI 导出入口，完成跨仓离线全链验真。
3. **M3-3 / M3-3c / M3-3d（已完成 · `9f876a3`、`befdf6a`、`live-02`）**：完成 4 场景离线预演与单场景/全局 POST 守卫，随后完成授权真机采集与 OpenRouter 6 维验真（Studio 19/114 POST、ts 12/72 次 0 重试、`--verify-run` 通过、Chrome 离线核验 HTML 报告）。
4. **M3-4（已完成）**：依收官决策不追加付费修复，将真机分档与两项已知边界（固定脚本早停 C1/C4、C2 同页跨字段数值漂移）诚实入档，同步收口双仓活文档与 [README.md](../../README.md) 并归档本规格。

## 4. M3 明确不做项（Out of Scope）

- 不实施原 M4 建课联网检索与来源溯源（`LessonBasis` 仅保留扩展槽位）；
- 不修改前端视觉、首页文案、两层蓝图流程或铜版风静态 SVG 配图（UI 冻结）；
- 不做 `pi-ai` 流式逐拍 JSON 解析优化、语音 TTS、登录鉴权、外部数据库或自由手绘；
- 不在 `eduharness-studio` 内重复实现真模型 6 维裁判，也不向 `eduharness-ts` 搬入模拟学生高压压测；
- 不修改只读兄弟仓（`eduharness`、`mini-eduharness2`、`resume`）。
