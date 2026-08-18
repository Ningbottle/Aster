# ADR-0002: M1 Pi 纵切与 Skill 部署技术选择

状态：已接受（2026-08-16）

## 背景

M1 需要交付第一个窄纵切：
1. 真实锁定版本 Pi（0.84.2）的会话与事件观察，支持取消确认与异常恢复；
2. 真实 GitHub Skill（`anthropics/skills` · `skills/doc-coauthoring`）的不可变快照、静态检查、部署到 Aster 管理的测试作用域与分阶段 Evidence；
3. 严格遵守凭据不读取/不迁移、unmanaged 目录不覆盖、Skill 脚本绝不执行的安全不变量。

## 决策

1. **Pi RPC 连接器协议以 0.84.2 Fixture 为合同基线**：
   - 仅通过严格 JSONL (`node <cli.js> --mode rpc`) 交互，不设第二种集成方式。
   - 取消语义以观察到 `agent_end` + `agent_settled` 为准（0.84.2 不保证显式 `abort` 响应）。
   - `PiSession` 必须实现 `Drop` 自动终止子进程树，防止后台孤儿进程。
2. **Managed Pi 运行时并排隔离**：
   - 安装至 `%LOCALAPPDATA%\Aster\runtimes\pi\<version>`，通过 `npm install --prefix` 部署。
   - `locked_runtime()` 优先选用 Aster-managed 安装，其次选用版本一致的外部全局安装。
3. **Skill 不可变快照与文件级部署**：
   - 从 GitHub tarball 解出指定 skill 子路径，校验相对路径、无链接、扩展名白名单（纯文档类），计算全目录 SHA-256 哈希。
   - 快照存放于 `skills/snapshots/<sha12>-<name>`，写入后只读。
   - 部署仅复制文件至测试作用域 `runtimes/pi/test-scope/skills/<name>`，部署后校验哈希；绝不创建 symlink/junction。
   - 回滚仅删除 Aster 部署的目标文件并标记数据库记录；未托管目录绝不覆盖。
4. **测试作用域与 Evidence 分阶段状态**：
   - 测试作用域 `runtimes/pi/test-scope` 独立设置 `PI_CODING_AGENT_DIR`，其下不配置任何宿主凭据。
   - 阶段 `discovered` → `downloaded` → `structurally_validated` → `configured` → `target_discovered` 记录真实 `success/failure`；`session_loaded` 与 `callable_verified` 在测试作用域下诚实记录为 `unknown` 并附注凭据边界原因。

## 后果

- 锁定 Pi 0.84.2 的行为由 fixture 与自检保障，上游小版本升级需要经过新 verification。
- 测试作用域内无法执行需要真实 API Key 的调用，符合 Aster 绝不窃取/迁移用户模型凭据的安全承诺。
