# Phase 5 研究缺口与后续验证

## 高优先级缺口

### 1. DSH 仍处 Developer Preview

DSH 官方明确警告会发生兼容性破坏，且其仓库刚公开不久。当前文档足以支持架构方向，但不足以冻结连接协议。项目骨架应先定义 connector capability 和 contract tests，具体字段以版本探测和 fixture 固定，避免 UI 直接依赖上游内部类型。

### 2. Pi/DSH 的 Windows 真实运行证据尚未采集

本轮是论文、官方文档和源码结构调研，没有在用户机器安装两个宿主并运行 end-to-end probe。骨架之后需要建立最小真实矩阵：Windows 11、PowerShell、路径含空格/中文、CRLF、进程异常退出、超长 JSONL、工作区移动、Skill 热变更。

### 3. Zcode 与 Grok Build 缺乏可确认的一手定义

目前无法仅凭名称唯一确认产品、官方仓库和 Skills 规范。第一阶段只能支持高级自定义目录和 scan-only，不能预填“官方路径”或给出兼容徽标。需要用户后续提供实际安装或官方地址，再建立 profile。

### 4. Cursor、Codex、Antigravity 的版本级规则仍不完整

官方资料确认了 Skills 能力和部分路径/调用方式，但不足以覆盖所有版本、scope 和 precedence。建议 profile 初版把这些平台标为 `partial`，并在用户机器通过只读目录探测补证据；不要将社区帖子作为正式规则来源。

### 5. “可调用验证”缺少统一的无副作用测试定义

即使 Pi/DSH 都能观察加载，怎样验证 Skill 可调用而不执行危险工作仍需设计。建议每个 Skill 可选声明 Aster 自己的外部 verification recipe，但 recipe 不来自不可信 Skill 包且首阶段由开发者维护。没有 recipe 时最多到 session_loaded。

## 中优先级缺口

### 6. Profile 分发与签名

第一阶段建议 profile 随 Aster 版本内置，本地自定义 profile 自动标为 unverified。未来若需要独立更新 profile，必须设计签名、schema migration、撤销和回滚，不能把远端 JSON 直接当可信规则。

### 7. GitHub 私有仓库与 submodule/LFS

Device flow 和 Credential Manager 边界已确定，但仍需验证私有仓库、组织 SSO、submodule、Git LFS、大仓库 partial fetch、rate limit 和仓库转移。第一阶段可以明确不支持 submodule/LFS 自动展开，先保守失败。

### 8. Windows 文件系统语义

需要覆盖 junction、symlink、reparse point、大小写不敏感冲突、保留名称、长路径、Alternate Data Streams、文件被占用、杀毒软件竞态和跨卷原子替换。路径安全测试应在部署模块之前建立。

### 9. 翻译质量和版本漂移

中文 Markdown 说明与原 snapshot 分离是正确方向，但需要记录翻译基于的 snapshot hash、译者、时间和状态。上游更新后说明应标记 stale，而不是悄悄沿用。

### 10. 多 Skill 仓库的部分更新语义

同一 commit 含多个 Skills 时，用户可以只部署部分 entry，但 snapshot 应仍以仓库 commit 为单位。需要验证 UI 是否能清楚表达“仓库快照已更新，某些 Skill deployment 仍在旧 snapshot”。

## 证据局限

- 多篇直接相关论文来自 2026 年预印本，缺少长期复现；数字应作为设计压力测试，不是产品 KPI。
- 真实生态语料主要来自公开、英语、许可清晰的 Skills，不能代表私有团队 Skills。
- 安全研究中的静态标记不等于恶意，合成 benchmark 的高 precision 也不能外推为真实世界保证。
- 星标和仓库活跃度易变，只能说明生态关注度，不能说明 API 稳定性。
- 论文常把某个模型与 harness 作为组合评测，不能将结果归因给其中单一部分。

## 建议的下一轮实证工作

1. 固定 Pi 和 DSH 的首个支持版本，保存 `--version`、启动输出和协议 fixture。
2. 为两者各建立 6–10 个 connector contract tests：正常启动、目录发现、会话加载、取消、崩溃、版本不支持、输出污染、重连。
3. 构造 12 个跨平台 Skill fixtures：最小合法、平面、嵌套、name mismatch、扩展 frontmatter、脚本、symlink、路径穿越、超长描述、同名冲突、外部修改、多 Skill repo。
4. 在 Windows 上记录每个目标工具的实际版本、真实目录和 reload 行为，生成 profile evidence，而不是手工复制网络表格。
5. 用一个完全无副作用的 test Skill 验证 Pi/DSH 的 `target_discovered → session_loaded → callable_verified` 状态转移。

## 会改变当前结论的证据

以下任一情况出现时，应重新审视架构：

- Pi 或 DSH 提供稳定、跨版本且语义等价的官方共同宿主协议；
- 多个平台共同标准化运行时 catalog、加载回执和 verification，而不仅是文件格式；
- 第一阶段必须允许第三方实现运行时连接器，且已有可信签名/隔离机制；
- Windows 上无法可靠区分 Aster-managed 与 external-modified deployment；
- 用户目标从“小范围个人/同学使用”扩展到企业多租户和强合规。

在这些证据出现之前，`HostProfile + HostConnector + EvidenceStore` 是风险和开发成本之间最合适的边界。

