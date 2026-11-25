# 当前状态

- **当前里程碑**　M2-1 至 M2-4 验收通过，含一次预算内全链路真机冒烟。下一阶段为 M3；新增付费试学仍须另获预算授权。
- **最后更新**　2026-11-25

## M2 验收证据

收据与截图位于本机证据目录 `C:\tmp\eduharness-studio\`；下列路径相对此目录。[M2 归档规格](archive/m2-spec.md)保留原始切片契约。

- **M2-1 / 1b**（`18cc09c`、`8be02fc`）：`pi-ai` faux 模型、loopback CONNECT、内存态 BYOK；OpenRouter / 自定义 Base URI、模型目录与 390px 截图。收据 `m2-1/check-receipt.txt`、`m2-1b/check-receipt.txt`，截图同目录。
- **M2-2 / 2b**（`fb98b93`、`21d1762`）：Teacher Agent 诊断与续讲、护栏、上屏边界；loopback 验证 `calc_verify` 结果回传和 X-Ray。收据 `m2-2/check-receipt.txt`、`m2-2b/check-receipt.txt`，截图同目录。早期真机调校 `604cc2b`，见 `m2-trial/trial-report.md`。
- **M2-3**（`ef2c03b`、`ea8c41d`）：loopback 动态建课、并发解锁去重、刷新、按点选 `label` 续讲、清除 BYOK 后离线续讲。收据 `m2-3/check-receipt.txt`，截图同目录。
- **M2-4**（`2379661`，真机基线 `8dfcc27`）：铜版风静态 SVG 与安全降级，零外网预演、模拟 502、Chromium 授权真机全链路。收据 `m2-4/check-receipt.txt`、`m2-4/smoke-report.md`；真机截图和结构化收据在 `m2-4/9f0f172d-continuation/live/`。

### M2-4 真机冒烟

- 「三角形面积中的底边与垂高」生成 5 单元 / 15 课节。第 2 节由锁定变就绪，确认 KaTeX 上屏；本轮两次配图超时均回到文字板书，静态 SVG 成功渲染由离线联调覆盖。
- 诊断选项提交后续讲，`last_played_step_id=8` 与请求及记录一致，截断第 9–12 拍、从第 13 拍续讲。刷新恢复同一会话、要点和已播记录，不再请求模型。
- X-Ray 实证开场动作超出上限后成功自纠偏 1 次、3 个认知诊断、5 个模型耗时 span、3 个 `calc_verify` 工具耗时 span。本次只跑一轮，使用 9/20 次 HTTPS POST；含此前 5 次，累计 14/25。7 张真机截图，浏览器外站请求、console error、pageerror 均为 0。离线收据位于同批次的 `mock/`、`502/`。
- 这是功能冒烟，不是教学效果验收：本次开场的 `ask` 复用了板书示例，不能证明近迁移；首拍样本包含懒生成、重试与配图超时，不作为普遍时延结论。

## M1.5 验收证据

- 全量检查 `npm run check` 49 项通过（收据 `m1.5/check-receipt.txt`，三屏 + 铜版图 + 暖石 X-Ray + 390px 窄屏截图存 `C:\tmp\eduharness-studio\m1.5\`，已人工复看确认无排版发闷或错位）。
- M2 配图机制定案为方案 A（分工画图 + 预设统一画风静态 SVG，经 `static-svg` 白名单消毒），见 [M2 归档规格](archive/m2-spec.md#24-白板配图graph生成机制m15-已定案)。

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

## 下一步（M3）

- 把已确认上屏的公开课堂对话投影交给 `eduharness-ts --judge-only` 验真。[完整路线图（M0–M4）](plans/roadmap.md)
