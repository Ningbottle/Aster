# Aster

Aster 是面向熟悉 AI 工具的开发者与高级用户的 Windows 本地优先桌面工作台。它在同一应用中分别承载 Pi 与 DeepSeek Harness（DSH），并管理工作目录、Skills、宿主运行状态和本地证据。

AI / Coding Agent 的唯一开发规约见 [`AGENTS.md`](AGENTS.md)。README 只保存公开产品介绍与权威命令。本机若存在被 Git 忽略的 `docs/status.md`，那才是当前工作状态；本机 `content.md` 是稳定产品与架构地图。文档与代码或验证结果冲突时，先纠正 `docs/status.md`，只有公开边界或权威命令变化时才改本文件。

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

所有命令在仓库根目录运行。**本表与 CI 是权威源**；本机 `content.md` 可以重复同一张表，但不能替代它。

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

CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在 Windows 上依次运行 Rust 测试、前端单测、类型检查、假数据门禁和 Tauri 发布构建。

## 数据与仓库边界

默认数据根目录是 %LOCALAPPDATA%\Aster，数据库位于 database\aster.db。开发和测试可以用 ASTER_APP_DATA_DIR 指向隔离目录。

GitHub 只维护两份 Markdown：README.md 是公开产品介绍与权威命令，AGENTS.md 是唯一 AI 开发规约。本机 `docs/`、`content.md`、操作证据、研究输出和 Office 文档由 AI 读取和维护，但通过 .gitignore 留在本机。当前状态以本机 `docs/status.md` 为入口；稳定地图以本机 `content.md` 为入口。源代码中的协议 fixture、测试数据和构建配置不属于项目文档。

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
