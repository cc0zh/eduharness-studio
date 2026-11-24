# 变更历史

## 2026-11-24 · M1 零密钥离线闭环交付

- 交付从示范课或轻调研进入的白板课堂，支持逐拍演播、翻页、作答、打断续讲与刷新恢复。[阶段规格](archive/m1-spec.md)
- X-Ray 上线六维 19 题离线规则质检与跨页证据联动。Playwright 全链路纳入 `npm run check`，五个切片验收与阶段独立复核均通过。[验收证据](status.md#m1-验收证据)

## 2026-11-23 · M0 骨架与门禁落地

- 完成产品层级对齐：采用轻量两层动态结构（`课程 → 动态单元 → 按需懒生成课节` + `单堂白板课 → 动态要点`），默认中文界面并保留必要英文技术标签。
- 搭好三层 npm workspaces 仓库：`packages/engine`、`apps/server`（Hono + `node:sqlite`）、`apps/web`（React + Vite + Tailwind）。
- 落地全套 Day-1 门禁：三层导入边界（`scripts/check-boundaries.mjs`）、文档防堆放（`scripts/check-docs.mjs`）、代码卫生与防膨胀/根目录白名单（`scripts/check-code-hygiene.mjs`）、Biome 统一 Lint/格式化、秒级 `check:static` + `.githooks/pre-commit`（`prepare` 自动配置）、全仓类型检查、前端构建、单元/门禁/M0 E2E 冒烟测试与 GitHub Actions CI。
- 接入轻量 coss ui 外围原语（`@base-ui/react` + Tailwind v4：`Button` / `Badge` / `Input` / `Switch` / `Tabs` / `Sheet` / `Dialog`）与 `@/*` 路径别名；核心白板画布保持手写 Tailwind。
