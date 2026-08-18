# ADR-0005: 推翻 M1–M3 完成结论与里程碑重排（R1–R5）

## 状态

已接受（2026-08-18）

## 背景与上下文

M1–M3 曾依据 `cargo test`（40 单元 + 4 集成）、`npm run check/build` 与 `--selftest-m1/m2/m3` 全绿标记为完成。2026-08-18 的实际使用核查（命令全部重跑仍为绿灯）发现这些绿灯不构成产品可用：

1. **验证盲区**：selftest 与集成测试在后端内部直接构造正确参数，从不经过 UI→invoke→serde 反序列化这条真实用户链路。
2. **前后端契约断裂**：SkillsView 批量部署发送 `{ host_id, path: "" }`，而后端 `skill_flow::DeploymentTarget` 要求 `host` 字段且 `path` 需为真实路径——serde 反序列化必然失败，UI 的批量部署必然不可用。
3. **大面积假数据**：前端硬编码虚构技能列表（SkillsView `INITIAL_SKILLS`）、假 evidence/部署表与假 `callable_verified success`（InfraView）、假最近会话（HomeView）、假计数（App.svelte）与恒真状态标签（AgentsView `|| true`）；`refreshData()` 用空 catch 吞掉全部后端错误，后端失败时用户看到的是静默假数据。这直接违反 [`AGENTS.md`](../../AGENTS.md)“不把未知状态伪装成成功”。
4. **M2 核心承诺未兑现**：DSH“原生 Web UI”实为 Aster 自写静态占位页（`dsh_connector.rs` 的 `RUNNER_CODE` fallback），`@deepseek-ai/dsh-web-app` 从未被加载，健康探针匹配的是自己占位页的文字，与 [ADR-0003](ADR-0003-m2-dsh-web-connector.md)“完整保留 DSH 的强大生态”的声称矛盾。
5. **后端能力未接线**：`skill_get_diff`、`skill_rollback_latest`、`skill_m1_pipeline` 前端零调用；技能列表不从 SQLite 加载。
6. **Alpha 必须项缺失**（[`content.md`](../../content.md) §4）：工作目录选择、最近项目与每宿主独立工作上下文、GitHub 来源 UI、Device Flow、隔离区 UI。

同时确认后端资产真实健康，应保留：`pi_connector`（4 个 fixture 测试覆盖正常/取消/错误/崩溃）、`db` 版本化迁移、evidence、`skill_flow` 管道、supervisor、DSH 进程生命周期（端口分配、Drop 清理、安装探测）。

## 决策

1. **推翻 M2“完成”结论**；M1/M3 降级为“后端成立、UI 不成立”。`content.md` §14 逐条标注实际状态。
2. **里程碑重排为 R1→R5**：
   - R1 真实性修复：删除全部前端假数据、修复 `DeploymentTarget` 字段契约并由后端按 host+scope 解析目标路径、接线 Diff/回滚/真实技能列表、后端错误在 UI 可见；
   - R2 DSH 兑现或如实降级（修正 ADR-0003 与 §7，二选一，不允许维持虚假承诺）；
   - R3 Alpha 必备缺失项（工作目录/最近项目、GitHub 来源、Device Flow、隔离区 UI）；
   - 原 M4/M5 顺延为 R4/R5。
   R1 最先：后端已就绪、成本最低、直接回应“前后端未打通”，且契约测试层是后续所有里程碑“真完成”的基础设施。
3. **保留与推翻边界**：保留第 6 点列出的后端模块及其测试；推翻 UI 假数据层与 M2“完成”结论，不做补丁式辩护。
4. **新完成门槛**（自 R1 起适用于所有里程碑）：
   - 必须附真实 UI 链路操作证据，selftest/单测绿灯不构成完成；
   - 前端禁止硬编码业务数据，CI 增加 grep 门禁；
   - 后端错误必须在 UI 可见，禁止空 catch；
   - 为每个 invoke 参数结构建立契约测试（前端序列化样本→Rust serde round-trip）并进入 CI。
5. **R1–R3 不新增后端能力**，只做接线、修复与缺失项补齐；不提前展开 R4。

## 后果与验证

- **优点**：里程碑“完成”重新获得含义；验证体系覆盖真实用户链路；虚假承诺被显式纠正或兑现。
- **代价**：总周期增加约 4–8 周；R1 期间无新功能产出。
- **验证方式**：
  - 契约测试与假数据 grep 门禁进入 CI；
  - 每个 R 里程碑以真实窗口操作记录验收，而非 selftest 输出；
  - [`content.md`](../../content.md) §14（里程碑与实际状态）、§15（验收标准第 11 条）、§19（下一步）已同步修订。
