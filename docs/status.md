# 当前状态

- **当前里程碑**　M2 进行中。M2-1/M2-1b 与 M2-2b 的 loopback/faux 验收已通过；真实付费试学仍须单独获预算授权。
- **最后更新**　2026-11-24

## M2-1 验收证据

- `npm run check` 及 Chromium BYOK 流程通过，收据和截图位于本机证据目录下的 `m2-1/`。模型生成由 `pi-ai` faux 验证，代理由本机 CONNECT 验证。真实教学调用归入后续切片。
- M2-1b 扩展 OpenRouter、自定义 Base URI 和模型目录拉取。loopback 验收与桌面、390px 截图位于 `m2-1b/`。配置方式见[运行手册](runbook.md#模型配置m2-1)。

## M2-2 验收入口

- `npm run test:e2e` 覆盖 Teacher Agent 状态机回归与 `test/browser-m2-2b.test.mjs` loopback BYOK 联合场景。实际 `calc_verify` 工具结果先回到模型再生成结构化回合，诊断、护栏与脱敏工具耗时在 X-Ray 可读。M2-2b 截图和全量检查收据位于本机证据目录 `m2-2b/`；仅用 loopback/faux，未发真实付费请求。
- 新开带模型配置的非示范课使用 Teacher Agent，示范课和既有离线会话仍使用各自剧本。追踪及恢复只以播放器确认的拍为课堂证据；设置 `STUDIO_TEACHER_SCREENSHOTS` 或 `STUDIO_M2_2B_SCREENSHOTS` 可分别保存浏览器截图。

## M1.5 验收证据

- 全量检查 `npm run check` 49 项通过（收据 `m1.5/check-receipt.txt`，三屏 + 铜版图 + 暖石 X-Ray + 390px 窄屏截图存 `C:\tmp\eduharness-studio\m1.5\`，已人工复看确认无排版发闷或错位）。
- M2 配图机制定案为方案 A（分工画图 + 预设统一画风静态 SVG，经 `static-svg` 白名单消毒），已回填 [M2 规格书](plans/m2-spec.md#24-白板配图graph生成机制m15-已定案)。

## M1 验收证据

五个切片的 `npm run check` 均退出 0，运行前后工作区均干净。下表的收据与截图路径相对于本机证据目录 `C:\tmp\eduharness-studio\`。

| 切片  | 验收内容                                              | 提交      | 检查收据                  | 截图目录 |
| ----- | ----------------------------------------------------- | --------- | ------------------------- | -------- |
| M1-1  | 示范课直达、轻调研与课程蓝图                          | `e015fa9` | `m1-1/check-receipt.txt`  | `m1-1/`  |
| M1-2  | 白板逐拍演播、暂停与作答                              | `f67be87` | `m1-2/check-receipt.txt`  | `m1-2/`  |
| M1-2b | 贝叶斯与 Transformer 示范课、翻页、KaTeX 与 SVG       | `251d6e4` | `m1-2b/check-receipt.txt` | `m1-2b/` |
| M1-3  | 课堂记录、打断续讲、刷新与服务重启后恢复              | `8db18ea` | `m1-3/check-receipt.txt`  | `m1-3/`  |
| M1-4  | X-Ray 19 题离线规则质检、跨页证据高亮、Playwright E2E | `acd5d0f` | `m1-4/check-receipt.txt`  | `m1-4/`  |

M1-4 全量检查 48 项通过。阶段独立复核通过，10 张 M1-4 截图已人工复看。X-Ray「对话与追踪」保留纯文本 LaTeX，供 M3 裁判读取公开对话。

## 下一步（M2）

- **后续**　若需真实模型试学，先取得预算授权；后续切片再接入自由主题建课、懒生成课节和配图。[M2 规格书](plans/m2-spec.md) · [完整路线图（M0–M4）](plans/roadmap.md)
