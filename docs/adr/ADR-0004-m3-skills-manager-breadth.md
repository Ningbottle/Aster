# ADR-0004: M3 Skills Manager 广度中枢与安全隔离部署

## 状态

已接受（2026-08-16）

## 背景与上下文

在 Aster M3 里程碑中，需要将 Skills Manager 从 M1 的单一 Skill 窄纵切扩展至跨 11 个主流 AI 工具的广度中枢（Cursor, Pi, DSH, Zcode, Grok Build, Qoder, Codex, Claude Code, Zed, Kimi Code, Antigravity）。
根据 [`content.md`](../../content.md) §8、§9、§14 与 [`AGENTS.md`](../../AGENTS.md) 的安全与架构不变量：
- **HostProfile 是版本化、只读、不可执行数据**，运行时由内置连接器或文件系统直接驱动，绝不在宿主描述中执行任意脚本；
- **原始快照不可变**，中文说明（Translations）是独立的派生元数据（Derived Metadata），保存在 `translations/`，支持用户自由编辑，上游快照变更时提示过期但不静默覆盖；
- **供应链安全与隔离（Quarantine）**：扫描拦截可执行文件、脚本（`.exe`, `.bat`, `.ps1`, `.sh`, `.vbs`, `.py`, `.js` 等）、路径穿越、符号链接/reparse point，并将违规文件连同诊断清单隔离至 `quarantine/`；
- **批量部署计划（Plan & Apply）与补偿回滚**：严格拒绝覆盖外部未托管目录；批量部署时单点失败必须执行可逆的补偿回滚；
- **分级 EvidenceStore**：Pi/DSH 记录深度调用证据；其余 9 个工具记录到 `target_discovered` 并如实记录 `unknown`，绝不伪装会话可用。

## 决策

1. **11 个工具 Profiles 事实表与路径解析 (`host_profile.rs`)**：
   - 内置 11 个工具的静态事实表，明确置信度门控（Verified / Experimental / ScanOnly）与发现形态（Flat / Bundle / Recursive）；
   - 支持 Windows 环境变量展开（`%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`）与 `<project>` 作用域解析；
   - 区分 `User`、`Project` 和 `Custom` 作用域。
2. **多 Skill 仓库解析与结构化分组 (`skill_flow.rs`)**：
   - 递归扫描 Git/本地多 Skill 目录（如 `anthropics/skills`），自动提取 YAML frontmatter 元数据、计算独立内容哈希并建立分组资产清单。
3. **中文说明生命周期与过期保护 (`translations/`)**：
   - 派生元数据包含用途、适用任务、目标工具、前置条件、风险提示与正文 Markdown；
   - 基于快照 ID 进行一致性校验；当快照哈希变更时仅标出 `is_stale: true` 警示，绝不静默覆写用户自定义内容。
4. **安全隔离分区 (`quarantine/`)**：
   - 静态检查发现危险脚本或二进制时，立即将危险文件归档至 `%LOCALAPPDATA%\Aster\quarantine/<quarantine_id>/`；
   - 自动生成 `manifest.json` 记录触发原因与检查项，并彻底清理 staging 临时目录。
5. **快照版本 Diff 查看器**：
   - 对比不同快照版本（或快照与目标文件），精准识别新增、删除、修改与相同文件，生成标准 Unified Line Diff。
6. **多目标批量部署计划（Plan & Apply）与事务补偿回滚**：
   - 部署前生成详细计划，对已存在外部文件的非托管目录标记 `BlockedUnmanagedConflict` 并阻止执行；
   - 批量部署若在中间步骤发生磁盘错误、权限不足或哈希校验失败，自动逆向调用 `rollback()` 回滚本批次所有已写入目录，保证原子性与无残留。
7. **分级 Evidence 审计记录**：
   - 对 Cursor, Claude Code, Zed 等外部工具，证据链记录至 `target_discovered` 为 Success，会话与可调用性标记为 `unknown`；
   - 深度证据仅限 Aster 管理的 Pi 与 DSH。

## 后果与验证

- **优点**：为开发者构建了安全、统一、透明且具备可逆恢复能力的 11 工具 Skills 广度中枢，在保证供应链安全的同时最大化兼容各类 AI 研发工具。
- **验证方式**：
  - 单元与集成测试：`cargo test --manifest-path src-tauri/Cargo.toml`（40+ 项测试全部通过）
  - 前端类型与构建：`npm run check`（0 错 0 警）& `npm run build`
  - 端到端自检命令：`cargo run --manifest-path src-tauri/Cargo.toml -- --selftest-m3`（退出码 0）
