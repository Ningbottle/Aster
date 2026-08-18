# Phase 5 — 证据缺口与待验证问题

日期：2026-08-16

以下内容不是继续访谈的理由，而是初始化后应通过 spike、fixture、官方发布样本或 Windows 测试消除的不确定性。除非它们改变用户可见承诺，否则由开发者/Agent 在里程碑内决策。

## 高优先级缺口

| 缺口 | 当前证据 | 风险 | 最小验证方式 | 最晚决策点 |
|---|---|---|---|---|
| Pi 当前 RPC 的完整生命周期、错误与恢复语义 | 已知只采用 RPC；尚无锁定版本的本地契约样本 | M1 会话无法恢复或误判完成 | 固定一个官方版本，录制成功/取消/异常退出 JSONL fixture，并做 Rust contract test | M1 开工首周 |
| DSH Web UI 的嵌入、端口发现与进程退出边界 | 官方有 web 启动方式，但仍是 Developer Preview | 端口冲突、孤儿进程、WebView 限制 | 用锁定版本做本机 spike：随机/指定端口、健康检查、退出、崩溃、重启 | M2 设计前 |
| 官方 Pi/DSH Windows 发布产物与校验/签名覆盖 | 仓库和发布策略快速变化，不能假定每版形态一致 | 更新器下载错误资产或无法验证 | 建 release-metadata fixture；针对无签名/仅 SHA/多资产情况建立拒绝与提示策略 | M4 前，M1 可先只支持一种已验证来源 |
| 宿主数据迁移对程序位回滚的影响 | 上游没有共同事务协议 | 回到旧程序后数据不兼容 | 每次支持新版本时记录 program rollback compatible/unknown；不自动启动旧版读新数据 | M4 |
| 11 个目标工具的真实 Skill 搜索路径、作用域与加载时机 | 用户列出目标，部分缺少稳定官方资料 | 部署到错误目录或制造假兼容 | 每个 HostProfile 都需官方链接或用户提供的可复现实例；无证据则 scan-only/experimental | M3 每个 profile 合入前 |

## 中优先级缺口

### Windows 文件系统语义

必须测试长路径、大小写、保留名、ACL、只读、文件锁、杀毒软件占用、junction/symlink/reparse point、Zone.Identifier/ADS、跨卷移动和非原子目录替换。当前设计只能承诺“经过验证的文件级步骤和补偿回滚”，不能承诺跨目录 ACID。

### GitHub 限流、认证与供应链

需要验证匿名 API 限流、Device Flow、私有仓库、重定向、Git LFS、submodule、超大仓库、release 资产、tag 移动和 force-push。来源版本必须以 commit SHA 与内容哈希落地，tag/branch 只作用户可读标签。令牌只能进入 Windows Credential Manager。

### Evidence 的失效策略

已定义 evidence key，但 TTL/失效触发仍需实现实验。最低规则：snapshot、host version、scope 或 profile 版本任一变化，深证据不得沿用；文件仍在不等于宿主已加载；一次 callable success 不保证所有任务兼容。

### SQLite 并发与崩溃恢复

桌面单实例是预期，但更新、进程事件和 UI 查询会并发。需要验证 WAL、迁移幂等、崩溃点和 evidence append 语义；大文件/Skill 内容不应直接堆入数据库，数据库保存元数据与哈希，快照留在文件系统。

### WebView2 与 DSH 原生 UI 边界

需要确认 CSP、localhost 导航、下载、文件选择、开发者工具、外链和 cookie/storage 清理策略。Aster 不重做 DSH UI，但仍对嵌入容器和本地导航安全负责。

## 低优先级或 Alpha 后问题

- 签名、只读、不可执行的远程 HostProfile 数据包是否值得支持；Alpha 先随 Aster 发行。
- `AppData\\Roaming` 是否更适合用户撰写的中文说明；Alpha 仍使用 Local 并依赖导出/导入。
- 多用户 Windows、ARM64、macOS/Linux、portable mode、组织策略、多人共享仓库。
- Skill 中文说明的自动生成或翻译质量评测；Alpha 先由用户与开发 Agent 编写，明确来源和更新时间。
- 通用 sandbox、统一模型凭据、统一对话、完整 IDE 与第三方可执行 connector 均为明确非目标，不列入待办。

## 研究外推限制

1. AGENTS.md、ClarifyCodeBench、SWE-RPG、RoadmapBench、SkillsBench 多数为 2026 预印本或快速变化基准，不能当作不可推翻的定律。
2. 这些研究多运行于 Linux/容器或 issue-resolution 环境，与 Windows/Tauri 桌面产品不同。
3. SkillsBench 的平均正向结果不证明任意 GitHub Skill 安全、兼容或有效；Aster 必须保留目标版本证据。
4. SWE-agent 证明 interface 重要，但其数值来自较早模型与 SWE-bench，不能用来估算 Aster 的用户成功率。
5. Agent Context 文件研究观察到生态做法，并不说明常见做法最佳。Aster 的短文档策略仍需在实际开发中用返工率、漏约束与 Agent 成本复核。

## 何时需要重新问用户

只有以下情况需要中断并请求产品决定：

- 官方上游不提供可验证的 Windows 安装路径，而替代方案会改变“普通用户权限”或供应链承诺；
- DSH 无法安全嵌入，必须在外部浏览器与自建 UI 之间选择；
- 某目标工具只能通过覆盖用户文件或执行第三方脚本才能部署；
- 产品范围、公开平台、账号/凭据责任、遥测或静默更新政策需要改变；
- 预计工期因上游变化超出当前区间一倍以上，需要删减 Alpha 范围。

其他实现分歧用短 ADR、实验结果和测试解决，不重新开启无止境的逐题访谈。

## Phase 5 gaps gate

- 已按高/中/低优先级记录未决证据。
- 每个高优先级缺口都有最小验证方式和最晚决策点。
- 已区分需要用户决定的问题与可由工程实验解决的问题。

