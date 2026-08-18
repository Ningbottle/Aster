# Aster

Aster 是面向熟悉 AI 工具的开发者的 Windows 本地优先桌面工作台：在同一应用中分别使用
Pi 或 DeepSeek Harness（DSH），管理工作目录与跨工具 Skills，观察工具执行，管理宿主版本。

产品范围、架构与里程碑见 [`content.md`](content.md)；开发不变量见 [`AGENTS.md`](AGENTS.md)。
当前阶段：**M3 Skills Manager 广度管理**（11 个目标工具 Profiles 事实表与本地扫描、
多 Skill 仓库分组与独立快照、中文派生说明生命周期与过期保护、恶意脚本/二进制 Quarantine 分区安全隔离、
快照版本间 Unified Diff 查看、多目标批量部署计划 Plan & Apply、外部冲突拦截与事务补偿回滚、分级 Evidence）。

## 环境要求

- Windows 10 22H2 / Windows 11 x64
- Node.js ≥ 22（开发用；运行时不需要）
- Rust stable（MSVC toolchain）—— `rustup default stable-x86_64-pc-windows-msvc`
- WebView2 Runtime（Windows 11 自带；Windows 10 通常已随 Edge 安装）

## 命令（唯一权威来源）

所有命令在仓库根目录执行，除非另行注明：

| 用途 | 命令 |
|---|---|
| 安装前端依赖 | `npm install` |
| 开发模式（启动完整桌面应用，热重载） | `npm run tauri dev` |
| 前端类型检查 | `npm run check` |
| 前端与后端假数据/规范门禁 | `npm run lint:nofake` |
| 前端生产构建（只产出 `dist/`） | `npm run build` |
| Rust 测试（单元与集成测试） | `cargo test --manifest-path src-tauri/Cargo.toml` |
| M1 真实端到端无头自检（Pi 0.84.2 + GitHub Skill 纵切） | `cargo run --manifest-path src-tauri/Cargo.toml -- --selftest-m1` |
| M2 真实端到端无头自检（DSH 0.1.0-rc.6 发现/安装/端口/健康检查） | `cargo run --manifest-path src-tauri/Cargo.toml -- --selftest-m2` |
| M3 真实端到端无头自检（11 工具 Profiles/多 Skill 仓库/隔离/Diff/批量部署回滚/分级 Evidence） | `cargo run --manifest-path src-tauri/Cargo.toml -- --selftest-m3` |
| 完整发布构建（产出 NSIS 安装包） | `npm run tauri build` |
| 发布版冒烟检查（隔离数据目录启动/验证数据库/终止） | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-run-check.ps1` |

CI（`.github/workflows/ci.yml`，windows-latest）执行：`cargo test` → `npm ci` →
`npm run check` → `npm run lint:nofake` → `npm run tauri build`。不依赖任何上游仓库的实时状态。

## 数据目录

默认根目录 `%LOCALAPPDATA%\Aster`，分区：`database`、`runtimes`、`skills`、
`translations`、`sessions`、`logs`、`exports`、`quarantine`、`staging`。
数据库文件为 `database\aster.db`（SQLite，迁移以 `PRAGMA user_version` 记录）。

开发/测试可用环境变量 `ASTER_APP_DATA_DIR` 重定向根目录；正式运行不要设置。

## 重新生成图标

```bash
node scripts/make-icon.mjs && npx tauri icon scripts/icon-source.png
```

## 仓库结构

```
src/                 Svelte 5 + TypeScript 前端（11 工具 Skills 广度面板、Pi/DSH/Infra 多工作台）
src-tauri/src/
  app_data.rs        AppData 目录布局
  db.rs              SQLite 连接与版本化迁移（Migration 0001, 0002, 0003）
  dsh_connector.rs   DSH 独立连接器、动态端口分配、HTTP 健康检查与生命周期
  evidence.rs        EvidenceStore 核心（追加/查询/失效）
  host_profile.rs    11 工具只读 Profile 事实表、Windows 路径模板与本地扫描
  logging.rs         JSONL 脱敏日志
  pi_connector.rs    Pi 严格 JSONL RPC 连接器、流式状态机与生命周期
  skill_flow.rs      多 Skill 解析、中文派生说明、Quarantine 隔离、Diff 与批量部署回滚
  supervisor.rs      Windows 进程监管（启动/等待/树终止/退出分类）
docs/adr/            架构决策记录（ADR-0001, ADR-0002, ADR-0003, ADR-0004）
```
