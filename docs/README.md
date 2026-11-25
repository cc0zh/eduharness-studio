# 文档索引与防堆放规则

本仓库通过 `scripts/check-docs.mjs` 在 `npm run check` 与 CI 中强制校验文档目录、行数预算、相对链接与索引覆盖。

## 活文档导航

- [当前状态](status.md)（上限 100 行）— 当前里程碑进度与阻断点
- [验收场景](scenarios.md)（上限 100 行）— M0–M4 端到端验收标准
- [运行与排障](runbook.md)（上限 120 行）— 本地启动、门禁检查与常见问题
- [术语表](glossary.md)（上限 60 行）— 两层课程结构、动作流与 X-Ray 词汇
- [变更历史](history.md) — 按里程碑记录关键结论与验收证据
- [路线图](plans/roadmap.md) — M0–M4 分阶段交付计划
- [历史归档索引](archive/README.md) — 已结项规格与其他历史资料
- [踩坑记录索引](learnings/README.md) — 按 `YYYY-MM/` 登记可复用的经验教训

## 已归档规格

- [M1 详细规格书](archive/m1-spec.md)
- [M1.5 详细规格书](archive/m1.5-spec.md)
- [M2 详细规格书](archive/m2-spec.md) — 真实模型与完整课堂闭环

## 写入路由

1. 仓库根目录只允许 `README.md` 与 `AGENTS.md`，禁止新增其他 `.md`。
2. `docs/` 根目录只允许本索引列出的 6 个活文档；长流水拆入 `docs/archive/`。
3. 临时草稿只放 `.tmp/scratch/<任务名>/`，用完清理；文档中禁止链接 `.tmp/`、`data/`、`dist/` 或本机绝对路径。
