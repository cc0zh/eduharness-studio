# 当前状态

- **当前里程碑**　M0–M3 已收官：完成与 `eduharness-ts` 的双项目真评测闭环验真；本仓进入 UI 与业务功能冻结态（M4 建课联网检索已搁置，保留 `LessonBasis` 扩展槽位）。新增付费试学须另获预算授权。
- **最后更新**　2026-11-26

收据、SQLite、HTML 报告及截图位于本机 `C:\tmp\eduharness-studio\`；下列证据路径相对此目录。

## M3 验收证据

[M3 归档规格](archive/m3-spec.md)保留双项目收官契约与切片边界。

- **M3-2 / M3-3 / M3-3c（离线闭环与守卫，`dbfb75a`、`9f876a3`、`befdf6a`）**：落地纯引擎 `EvidenceMessage[]` 裁判投影、只读 SQLite 导出 CLI（`npm run export:judge`）、4 场景 Playwright 对抗采集与单场景/全局 POST 预算守卫。离线预演 4/4 handoff、跨仓离线验真全通，累计检查 **208 项通过、0 失败、0 跳过**；原件见 `m3/integration/`、`m3/m3-3c/`。
- **M3-3d 授权真机闭环（`live-02`，`befdf6a` + `eduharness-ts@1208959`）**：Chromium 真机驱动 DeepSeek 授课并导出公开对话送入 OpenRouter 真机 6 维裁判（`m3-3-live-01`）。
  - **预算与验真**：Studio **19/114 POST**（全 HTTP 200，输出 token 保守上界 77,824）；`eduharness-ts` 裁判 **12/72 次发出、0 重试**（请求输出 token 上界 49,152）；凭据字面扫描 0 命中。`--verify-run` 返回 `verified=true`、`complete=true`、`settled=2`、`failed=0`；单文件离线 HTML 报告（`m3/live-02/ts-report.html`）经 Chrome `file://` 核验 C2 `#7/#4` 与 C3 `#3/#4` 点击定位高亮，console error / CSP 违规 / 外网请求均为 0。
  - **两格原样结果与护栏实证**：`C2-pressure` 1/8（`support_escalation_and_fading=1`），实证索要答案未泄底、敷衍降级二选一、连续敷衍诚实记 `[要点未验证]`；`C3-interrupt` 2/10（`misconception_repair=1`、`representation_pivot=1`），实证第 1 拍插话干净截断第 2–10 未播拍且零泄入公开投影。
  - **诚实边界与收官结论**：① `C1-transfer`（第 11 拍）与 `C4-prereq`（第 10 拍）因固定脚本正则未命中真模型自由规划题面（如“合并成功率”未写“合计”、先讲 `LEFT JOIN` 行数与“王五”）而主动早停，属脚本驱动局限而非生成崩溃；② `C2` 第 37 拍正文写绕路边权 `−3` 与 `−1`，同页公式与表格写 `1+(-3)+1`，印证与 M2.5 同源的「单页多字段 JSON 跨字段数值漂移」缺口；③ 两格均为中途截断短对话，得分仅证明双项目真评测与验真链路闭环，不作教学质量定论。依收官决策本轮不追加付费修复，缺陷边界如实建档。原件见 `m3/live-02/README.md`。

## M2.5

- **离线门禁（`73dce84`、`27055c0`、`cacb8aa`）**：语义分镜编译沿用白板动作协议；live 非示范课统一按需规划（2–4 要点），刷新与并发不重复规划。`27055c0` 累计 `npm run check` 仅用 faux / 本机回环，**174 项通过、0 失败、0 跳过**（收据 `m2.5/check-receipt.txt`）；后续 `cacb8aa` 修复 390px 窄屏插话可用性。[离线验收场景](scenarios.md#m25语义分镜编译)
- **真机完整微课（`27055c0`）**：DeepSeek 跑完贝叶斯筛查首课 `u1-l1`，**81 拍 `completed`**（25/30 POST 全 200，第 6 拍 1 次格式 502 未提交回合），白板、SQLite 与 X-Ray 游标一致。但 81 拍超出 30–45 拍目标，正文写 `10000 − 100 = 9000` 与公式/`calc_verify` 的 `9900` 冲突，回顾误称 90%→99% 翻十倍，原件 `m2.5/live-full/`。
- **离线 UX 审计（`27055c0`）**：零 Key Chromium 1440×900 / 390×844 核验建课、解锁与示范课结课；窄屏插话输入框已于 `cacb8aa` 修复，其余边界（离线自由主题仍为样板、暂停发插话须续播可见、未测实体手机输入法）见 `m2.5/ux-audit/ux-audit.md`。

## M2 验收证据

[M2 归档规格](archive/m2-spec.md)保留原始切片契约。

- **M2-1 / 1b**（`18cc09c`、`8be02fc`）：`pi-ai` faux 模型、loopback CONNECT、内存态 BYOK；OpenRouter / 自定义 Base URI、模型目录与 390px 截图（`m2-1/`、`m2-1b/`）。
- **M2-2 / 2b**（`fb98b93`、`21d1762`）：Teacher Agent 诊断与续讲、护栏、上屏边界；loopback 验证 `calc_verify` 结果回传与 X-Ray（`m2-2/`、`m2-2b/`；早期试学 `604cc2b` 见 `m2-trial/`）。
- **M2-3**（`ef2c03b`、`ea8c41d`）：loopback 动态建课、并发解锁去重、刷新、按点选 `label` 续讲、清 BYOK 后离线续讲（`m2-3/`）。
- **M2-4**（`2379661`，真机基线 `8dfcc27`）：铜版风静态 SVG 与安全降级，零外网预演、模拟 502、Chromium 授权真机全链路（`m2-4/`）。

### M2-4 真机冒烟

- 「三角形面积中的底边与垂高」生成 5 单元 / 15 课节，第 2 节解锁并确认 KaTeX 上屏；两次配图超时均退回文字板书（静态 SVG 由离线联调覆盖）。
- 诊断选项提交后续讲，`last_played_step_id=8` 与记录一致，截断第 9–12 拍、从第 13 拍续讲；刷新恢复同一会话不再请求模型。
- X-Ray 实证自纠偏 1 次、3 个认知诊断、5 个模型耗时与 3 个 `calc_verify` span。本轮 9/20 POST（累计 14/25），0 浏览器外站请求/console error/pageerror；仅作功能冒烟，不代替教学效果评测。

## M1.5 验收证据

- 全量 `npm run check` 49 项通过（`m1.5/check-receipt.txt`），三屏 + 铜版图 + 暖石 X-Ray + 390px 截图已人工复看。M2 配图定案为方案 A（静态铜版风 SVG + `static-svg` 白名单消毒），见 [M2 归档规格](archive/m2-spec.md#24-白板配图graph生成机制m15-已定案)。

## M1 验收证据

五个切片全量 `npm run check` 均退出 0（M1-4 48 项通过、10 张截图人工复看，X-Ray 保留纯文本 LaTeX 供 M3 读取）：

| 切片      | 验收内容                                      | 提交                  | 检查收据                 | 截图目录           |
| --------- | --------------------------------------------- | --------------------- | ------------------------ | ------------------ |
| M1-1      | 示范课直达、轻调研与课程蓝图                  | `e015fa9`             | `m1-1/check-receipt.txt` | `m1-1/`            |
| M1-2 / 2b | 按拍白板演播、翻页、KaTeX 与双示范课 SVG      | `f67be87` / `251d6e4` | `m1-2/` / `m1-2b/`       | `m1-2/` / `m1-2b/` |
| M1-3      | 课堂记录、打断续讲、刷新与重启恢复            | `8db18ea`             | `m1-3/check-receipt.txt` | `m1-3/`            |
| M1-4      | X-Ray 19 题离线质检、跨页高亮、Playwright E2E | `acd5d0f`             | `m1-4/check-receipt.txt` | `m1-4/`            |
