# 变更历史

## 2026-11-23 · M0 骨架与门禁落地

- 完成产品层级对齐：采用轻量两层动态结构（`课程 → 动态单元 → 按需懒生成课节` + `单堂白板课 → 动态要点`），默认中文界面并保留必要英文技术标签。
- 搭好三层 npm workspaces 仓库：`packages/engine`、`apps/server`（Hono + `node:sqlite`）、`apps/web`（React + Vite + Tailwind）。
- 落地全套 Day-1 门禁：三层导入边界（`scripts/check-boundaries.mjs`）、文档防堆放（`scripts/check-docs.mjs`）、代码卫生与防膨胀/根目录白名单（`scripts/check-code-hygiene.mjs`）、Biome 统一 Lint/格式化、秒级 `check:static` + `.githooks/pre-commit`（`prepare` 自动配置）、全仓类型检查、前端构建、单元/门禁/M0 E2E 冒烟测试与 GitHub Actions CI。
