# 术语表

- **课程蓝图（Course Blueprint）**：针对学习主题经轻调研生成的宏观结构，由动态数量的 `单元（Unit）` 与 `课节（Lesson）` 组成，后续课节默认懒生成（`locked`）。
- **单堂白板课（Lesson Session）**：进入某一就绪课节后的 1 对 1 交互会话，也是 SQLite 持久化、`Agent X-Ray` 与 `eduharness` 质检的基本粒度。
- **动态要点（Keypoint）**：单堂白板课内部的知识拆分节点（数量按知识结构动态决定，不写死为 3 个）；必须经学生真正过关后才由 `keypoint_complete` 打钩。
- **动作流与单拍（Action Stream / Beat）**：后端产出的 TypeBox 校验动作数组（`board` / `new_column` / `new_page` / `highlight` / `graph` / `speak` / `ask` / `keypoint_complete`），经 SSE 逐拍下发、前端逐拍演播并回传已播 `step_id`。
- **打断截断（Interrupt Truncation）**：学生演播中途插话时立即截断未播拍，仅持久化已真实展示到白板的动作，教师从已播画面继续接话。
- **白板→公开对话投影（Public Dialogue Projection）**：将已播白板动作与学生回复投影为编号公开对话（`#1 / #2 / ...`），同时供 `eduharness` 门禁与 X-Ray 高亮定位消费。
- **Agent X-Ray**：右上角一键开启的工程透视抽屉，默认学生界面完全隐藏。
