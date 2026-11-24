# 当前状态

- **当前里程碑**　M1.5 已完成，交付「象牙纸 × 浓炭墨 × 焦赭赤陶」出版书房视觉重构、6 项交互升级、示范课铜版风配图与 M2 配图定案。
- **最后更新**　2026-11-24

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

- **M2**：复用 `@earendil-works/pi-ai` 接入真实模型（`.env`/代理 + 内存态 BYOK）、打通自由主题建课与懒生成课节解锁、`calc_verify`、`GraphGenerator`（方案 A）与 `basis` 槽位预留（真实冒烟须先获预算授权）；真 6 维裁判统一归口 M3 的 `eduharness-ts --judge-only`。[M2 规格书](plans/m2-spec.md) · [完整路线图（M0–M4）](plans/roadmap.md)
