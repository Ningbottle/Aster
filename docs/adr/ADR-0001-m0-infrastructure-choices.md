# ADR-0001: M0 基础设施技术选择

状态：已接受（2026-08-16）

## 背景

M0 需要可启动的 Svelte 5 / Tauri 2 / Rust / SQLite 应用，以及 AppData 布局、
迁移、进程监管、Evidence 核心和脱敏日志。content.md 固定了技术主线，本 ADR
记录其下方的实现层选择。

## 决策

1. **SQLite 访问用 `rusqlite`（bundled feature）**，不引 ORM。迁移是手写 SQL
   数组，用 `PRAGMA user_version` 记录进度，每条迁移一个事务。版本高于二进制
   支持范围的数据库直接报错，不回退、不猜测。
2. **AppData 分区命名在 M0 固定**：`database`、`runtimes`、`skills`、
   `translations`、`sessions`、`logs`、`exports`、`quarantine`、`staging`，
   根目录 `%LOCALAPPDATA%\Aster`。`ASTER_APP_DATA_DIR` 环境变量仅用于开发与
   测试重定向，保证测试不写真实用户目录。
3. **Evidence 表按五元组键（snapshot × host × host_version × scope ×
   profile_version）+ 阶段 + 状态建模**，只追加；失效通过 UPDATE 置 `stale`
   实现，不删除历史。阶段与状态用 CHECK 约束的 TEXT 存储而非 rusqlite 自定
   义类型，便于跨语言诊断查询。
4. **脱敏是纯函数 `redact(&str) -> String`**，在写入日志前同步应用。M0 覆盖
   Windows 用户路径、Authorization 头、常见令牌形状（sk-/ghp_/gho_/ghr_/
   github_pat_）和含 secret/token/password/key 的 KEY=value 值；宁可过度脱敏。
   日志为追加式 JSONL；限量保留（rotation）推迟到需要时实现。
5. **进程树终止用 `taskkill /PID <pid> /T /F`**。退出分类 M0 只区分
   CleanExit / FailureExit / TerminatedByAster；“请求取消 vs 宿主确认取消 vs
   被杀”的完整语义随 M1 Pi RPC 取消一起实现。stdout/stderr 捕获同理。
6. **前端只有一个真实状态页**（版本、数据目录、schema 版本、证据计数），
   不做模拟数据页面。

## 后果

- 迁移数组只能追加，改动已发布迁移属于破坏性变更，需要新 ADR。
- rusqlite bundled 使构建需要 C 编译器（MSVC 环境），CI 与本地一致。
- 脱敏规则是黑名单式的机械识别，不能保证覆盖所有敏感形状；导出/诊断包
  在 M4 实现时必须继续走同一 `redact` 入口并有独立检查。
