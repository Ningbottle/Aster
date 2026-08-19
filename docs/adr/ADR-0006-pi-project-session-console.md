# ADR-0006: Pi 控制台以项目组织原生会话

## 状态

已接受（2026-08-19）

## 背景

Aster 原先用单个全局 `SessionSlot` 启动 Pi：活动项目可以切换，进程工作目录却不跟随；会话消息只存在于当前页面的事件数组里；侧栏“新对话”并不创建原生 Pi 会话。锁定的 Pi 0.84.2 已经提供原生 JSONL 会话、`switch_session`、`get_messages`、`get_session_stats` 与 `--session` 启动选择。缺口在 Aster，不在上游。

## 决策

1. **Pi 仍是独立顶层控制台。** 不与 DSH 共享 RPC 类型、对话状态机、插件模型或 UI 流程。
2. **导航层级是 Project → Session。** 模型属于活动会话标题栏，不是侧栏树节点。
3. **Pi JSONL 是对话事实源。** SQLite 只保存可重建的会话索引元数据（原生 session ID、项目路径、相对定位符、名称、时间戳、消息计数、可用性）。不保存对话原文、工具输出、工作区文件内容或模型/API 凭据。
4. **Alpha 同一时刻只有一个 Pi 进程。** 同项目空闲切换使用锁定的 `switch_session` RPC；跨项目切换先停止再以目标项目为 cwd 启动，打开已有会话时附加 `--session`。流式/压缩中拒绝静默替换。
5. **事件带 `runtimeInstanceId`。** 前端丢弃过期实例的事件。
6. **Aster 不管理 Pi 凭据。** 配置缺失时只呈现 Needs setup 与修复入口。权限摘要固定为 `windows_user`（界面：Windows 用户权限（未沙箱化））。

## 后果

- 可见项目必须等于活动进程/会话绑定的 cwd；不再有全局 `pi_session_ensure` 隐式启动。
- 会话恢复必须走 `get_messages`，而不是重放本页事件。
- 前端只按 `sessionId` + `projectPath` 选择会话，不得发送 `sessionFile`。
- 缺失的会话文件或项目目录保持 `missing` / `project_missing`，索引删除不得删除 JSONL。
