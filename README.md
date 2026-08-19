# Aster

Aster 是面向熟悉 AI 工具的开发者与高级用户的 Windows 本地优先桌面工作台。它在同一应用中分别承载 Pi 与 DeepSeek Harness（DSH），并管理工作目录、Skills、宿主运行状态和本地证据。

更新日期：2026-08-19

当前结论：**项目处于新版 M0「安全阻断」阶段，M0 尚未完成。** M0.1 活动 Pi Session 下的 Project 保护已有真实 invoke 验收。M0.2 Skills 错误入口已从普通 UI 和 command API 移除，GitHub 弹窗三种关闭已再次观察到。M0.3/M0.4 Runtime 事实源已有 `platform/runtimeStatus.ts` 落点，App 尚未把各宿主状态收口为唯一订阅源。Pi 控制台 V0–V5 主项此前已观察。不能把 M0 或 M2/M3 标为阶段完成。

AI / Coding Agent 的唯一开发规约见 [`AGENTS.md`](AGENTS.md)。README 保存公开产品基线和状态摘要；本机可在被 Git 忽略的 `docs/` 中维护详细状态、计划和证据。二者冲突时必须依据代码与验证结果纠正，不能让旧文档覆盖当前结论。

## 目前到底做到哪里

仓库经历过三套阶段命名，旧名称不能直接映射成当前完成度：

| 时期 | 发生了什么 | 现在如何看待 |
|---|---|---|
| 初始 M0–M3 | 建立 Svelte/Tauri/Rust/SQLite、Pi RPC、DSH、Skills 等基础；提交 4265376 曾写成 “M0–M3 complete” | 后续审计证明 selftest 和后端测试不能代表真实 UI 可用，该完成结论已失效 |
| 整改 R1–R3 | R1 修复假数据和 Skills UI 链路；R2 兑现 DSH 原生 Web UI 并修复 Windows 建窗死锁；R3 增加项目、GitHub 来源、Credential Manager 和隔离区入口 | R1/R2 做过真实 UI 复审；相关实现已落入本地提交。R3 外部授权和若干失败路径没有完成 |
| Pi Project→Session | 4265376 之后有本地提交，建立 Pi 原生会话索引、项目树、RPC 操作和会话工作区 | 核心架构完成；V0–V5 主项已观察；tool-call 路由、OS 200% DPI、真实 Tab 遍历未覆盖 |
| 当前 M0–M7 | 按产品结构和真实用户链路重新排序 | 这是唯一有效的当前路线图 |

当前分阶段状态：

| 阶段 | 状态 | 代码事实 |
|---|---|---|
| M0 — 安全阻断 | **未完成** | Project 切换保护有 invoke 验收，全局选择器已离开 Home；Pi 树仍可挑项目。GitHub 弹窗 X/遮罩/Escape 关闭已观察。无作用域回滚与 M1 示例 API 已删除。Runtime 状态仍分散，仅建立 `runtimeStatus.ts` 落点 |
| M1 — 稳定控制台外壳 | 部分推进，未完成 | 一级入口只剩 Pi、DSH、Skills-Hub；伪菜单和 Home/Agents/Infra 已删除。Pi Sidebar 可隐藏/调宽；三模块各自完整 Sidebar 记忆尚未做 |
| M2 — Pi Project→Session 模型 | 核心架构完成，阶段未验收 | 索引/树/打开/重命名/重启恢复/缺失状态已观察；M0 全局 Project 切换仍未保护 |
| M3 — Pi Session 工作区 | 核心架构完成，阶段未验收 | Prompt/stream/cancel/busy/settle 与重启恢复已观察；tool-call 与 Crash Recovery 未真实覆盖 |
| M4 — DSH 控制台降噪 | 未开始 | DSH 原生 Web UI 已能承载，但普通栏仍展示 PID、URL、版本和 Boot Probe，尚未移入 Details |
| M5 — Skills 本地发现与来源模型 | 未开始 | 现有扫描、快照和部署资产可复用，但三类关系与可空、带证据/置信度的来源模型尚未建立 |
| M6 — Skills-Hub UI | 未开始 | 现有 Skills 页面不是目标中的工具分类 Sidebar、紧凑列表、Provenance/Compatibility/History 完整信息架构 |
| M7 — Settings 与产品级验证 | 未开始 | 尚无独立 Settings 产品面和完整的高 DPI、200% 缩放、高对比、焦点及长期使用验收 |

因此，不能说“已经做到 M3”。准确说法是：**当前总阶段仍在 M0；Pi 控制台核心架构与 V1 主链路已通过，但 M2/M3 没有通过新版阶段门禁。**

## 当前 M0 — 安全阻断

M0 只矫正安全与事实错误，不做视觉重构：

- 阻止活动 Pi Session 下静默切换 Project。
- 修复 GitHub 弹窗无法关闭。
- 移除无作用域回滚和 M1 示例按钮。
- 统一 Runtime 状态事实。

上述四项全部完成并经过真实 UI 操作验证后，才进入 M1。

## 当前路线图

### M1 — 稳定控制台外壳

- 只保留 Pi、DSH、Skills-Hub 三个一级模块。
- 建立固定全局模块栏。
- 建立可折叠、隐藏、调整宽度的模块 Sidebar。
- 为三个模块分别记忆 Sidebar 状态。
- 移除伪菜单、Home、Agents 和 Infra 一级入口。
- 验收最小窗口、高 DPI、折叠/恢复和无水平滚动。

### M2 — Pi Project→Session 模型

- 建立 Project 与 Pi 原生 Session 的可靠索引。
- Sidebar 展示 Project Tree 和真实 Session。
- 创建 Session 时绑定 Project/cwd。
- 恢复、归档和重命名 Session。
- Project 切换不改变运行中 Session。

本阶段先解决状态事实，不先美化聊天区。

### M3 — Pi Session 工作区

- 完整恢复 Pi 时间线。
- Session Header 提供模型、Thinking、Context、Compaction 和权限状态。
- 工具调用可展开。
- 支持 Cancel、Retry 和 Crash Recovery。
- 删除假“默认模型”和开发计数。

### M4 — DSH 控制台降噪

- 保留 DSH 一级模块和原生 Web UI 全幅展示。
- 普通标题栏只显示语义状态和必要操作。
- PID、URL、版本和 Boot Probe 移入 Details。
- 完成启动慢、配置缺失、崩溃和端口冲突状态。
- 不重写 DSH 原生 Session、插件或模型系统。

### M5 — Skills 本地发现与来源模型

- 按工具扫描本地 Skills。
- 区分 discovered_under、compatible_with、deployed_to。
- 来源为可空、带证据和置信度的对象。
- 支持来源未知、本地导入、远程来源和部署副本。
- 不按名称猜来源或自动合并。

### M6 — Skills-Hub UI

- 工具分类 Sidebar。
- 紧凑 Skill 列表、搜索、过滤和排序。
- Markdown 阅读器与中文派生说明过期状态。
- Compatibility、Deployments、History、Provenance。
- 安全展示同名、未知来源的 Skills。

### M7 — Settings 与产品级验证

- Appearance、字体、字号、UI Zoom、密度和主题。
- Sidebar 行为。
- Pi 默认模型和新 Session 行为。
- DSH Runtime 策略。
- Skills 扫描和翻译设置。
- Advanced/Developer Diagnostics。
- 键盘、焦点、200% 缩放、高对比和长期使用验证。

## 不可破坏的产品边界

- Alpha 只正式支持 Windows 10 22H2 / Windows 11 x64，普通用户权限。
- 技术主线是 Svelte 5 + TypeScript、Tauri 2、Rust Core、SQLite 和受监管子进程。
- Pi 与 DSH 是独立宿主，不共享 RPC 类型、会话状态机、插件模型或 UI 流程。
- Pi 只走严格 JSONL RPC；Pi JSONL 是对话事实源，SQLite 只保存可重建索引。
- DSH 保留原生 Web UI、插件、自定义模式和持久化语义。
- Aster 不读取、保存、迁移或同步 Pi/DSH 的模型/API 凭据。
- GitHub 私有来源令牌只进入 Windows Credential Manager。
- 原始 Skill snapshot 不可变；Aster 不执行下载内容中的脚本或二进制。
- 默认复制部署，不覆盖未托管目录；检测到外部修改后停止自动写入。
- Evidence 区分发现、配置、宿主加载和真实可调用，未知状态不能写成成功。
- Aster、Pi、DSH 更新是三个独立任务；任何安装或切换都需要用户确认。
- Alpha 不上传遥测或崩溃报告；诊断导出必须主动触发、可预览并默认脱敏。

## 完成与验证规则

- 单元测试、fixture 或后端命令成功不等于用户功能完成。
- 用户可见功能必须有真实 UI → invoke → Rust 链路操作证据。
- 前端不硬编码 Skills、Evidence、会话、计数或状态标签；后端错误必须在 UI 可见。
- 前端 invoke 参数与 Rust serde DTO 必须有契约测试。
- 没有实际运行验证，不声称“通过”“兼容”“可回滚”或“完成”。

## 开发环境

- Windows 10 22H2 / Windows 11 x64
- Node.js 22 或更高
- Rust stable，MSVC toolchain
- WebView2 Runtime

所有命令在仓库根目录运行：

| 用途 | 命令 |
|---|---|
| 安装依赖 | npm install |
| 启动完整桌面应用 | npm run tauri dev |
| 前端单元测试 | npm run test:unit |
| 前端类型检查 | npm run check |
| 假数据/规范门禁 | npm run lint:nofake |
| 前端生产构建 | npm run build |
| Rust 测试 | cargo test --manifest-path src-tauri/Cargo.toml |
| 完整发布构建 | npm run tauri build |
| 发布版冒烟检查 | powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/e2e-run-check.ps1 |

CI 在 Windows 上依次运行 Rust 测试、前端单测、类型检查、假数据门禁和 Tauri 发布构建。

## 数据与仓库边界

默认数据根目录是 %LOCALAPPDATA%\Aster，数据库位于 database\aster.db。开发和测试可以用 ASTER_APP_DATA_DIR 指向隔离目录。

GitHub 只维护两份 Markdown：README.md 是公开产品基线与状态摘要，AGENTS.md 是唯一 AI 开发规约。本机 `docs/`、`content.md`、操作证据、研究输出和 Office 文档由 AI 读取和维护，但通过 .gitignore 留在本机；详细状态以本机 `docs/status.md` 为入口。源代码中的协议 fixture、测试数据和构建配置不属于项目文档。

主要目录：

    src/shell/           标题栏与模块侧栏
    src/modules/         Pi、DSH、Skills-Hub 三个一级模块
    src/platform/        前端 invoke 封装、runtime 落点、markdown
    src/types/           按领域拆分的共享类型
    src-tauri/src/       Rust Core：platform / pi / dsh / skills / hosts / ipc
    src-tauri/tests/     按验收对象命名的契约与集成测试
    scripts/ci/          假数据门禁与契约 fixture
    scripts/evidence/    真实验收脚本
    scripts/dev/         开发辅助与冒烟
    .github/workflows/   Windows CI
