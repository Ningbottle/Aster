# Phase 4 代码仓库与宿主实现调查

核查日期：2026-08-15。星标为核查时 GitHub 页面/API 显示值，属于易变指标；“最后更新”取默认分支最新提交时间。它们用于判断项目成熟度和活跃度，不用于证明技术正确性。

## 仓库总览

| 仓库 | 角色 | Stars | 主要语言 | 默认分支最后更新（UTC） | 文档质量 |
|---|---|---:|---|---|---|
| [earendil-works/pi](https://github.com/earendil-works/pi) | Aster 首阶段 Pi 宿主 | 90.6k | TypeScript | 2026-08-15 05:33 | 高：专门的 RPC、Skills、安全、设置文档；开发命令和供应链措施清楚 |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | Aster 首阶段 DSH 宿主 | 102.3k | TypeScript（含 Rust/Python） | 2026-08-13 11:38 | 高但不稳定：子系统文档非常细；仓库明确标记 Developer Preview 和 breaking changes |
| [agentskills/agentskills](https://github.com/agentskills/agentskills) | Agent Skills 基础规范 | 24.3k | Python | 2026-08-09 20:36 | 高：规范、参考校验器和 progressive disclosure 说明齐全 |
| [UCSB-NLP-Chang/Skill-Usage](https://github.com/UCSB-NLP-Chang/Skill-Usage) | 真实生态检索/使用实验 | 48 | Python | 2026-04-08 03:49 | 中：复现实验、34k 数据入口和配置完整；仓库历史很短 |
| [qualixar/skillfortify](https://github.com/qualixar/skillfortify) | Skill 静态与供应链扫描原型 | 29 | Python | 2026-08-05 07:46 | 中高：扫描器、benchmark、测试、wiki 齐全；研究结论仍需外部复现 |
| [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | Agent–Computer Interface 参考 | 20.1k | Python | 2026-07-16 15:21 | 高：配置、工具、测试、轨迹和论文复现资料齐全 |
| [ethz-spylab/agentdojo](https://github.com/ethz-spylab/agentdojo) | 不可信工具数据的动态安全基准 | 748 | Python | 2026-06-02 09:59 | 高：src、tests、examples、docs、runs 和数据卡齐全 |

### 1. earendil-works/pi

Pi 是 TypeScript monorepo，核心包把 agent loop、coding agent、TUI 和 telemetry 分开。对 Aster 最关键的是官方 [RPC 文档](https://pi.dev/docs/latest/rpc)：`pi --mode rpc` 通过 stdin/stdout 使用严格 JSONL，命令响应可用 `id` 关联，事件异步流出；`get_commands` 能返回当前加载的 Skill、来源位置和绝对路径。这提供了“目标已发现”的直接证据面，而不是靠 Aster 猜目录。

[Skills 文档](https://pi.dev/docs/latest/skills) 显示 Pi 支持 `~/.pi/agent/skills`、`~/.agents/skills`、项目 `.pi/skills`/`.agents/skills`、package、设置和显式路径；目录 bundle 递归发现，某些根目录还支持平面 `.md`。Pi 对多数规范问题只警告，且允许 name 与父目录不同。这正是不能用一个通用 `is_valid` 布尔值覆盖全部宿主的例子。

安全上，Pi 官方明确说明它默认继承启动用户权限，project trust 不是 sandbox。Aster 应透明展示这个事实，不在第一阶段伪造一层不完整的通用隔离。

**复用建议：** 不复制 Pi 源码；在 Rust Core 实现严格 JSONL framing、请求关联、事件状态机、进程退出恢复和版本探测，并以 `get_commands` 作为 Skill 发现观察点。

### 2. deepseek-ai/deepseek-harness

DSH 的代码结构直接支持“不要把两套形态统一掉”的判断。仓库把 session、skill、sandbox、extensions、web host/client、Typert gateway 等做成独立 capability family；根 README 明确“Everything is a Plugin”，同时警告 Developer Preview 会有兼容性破坏。

官方 [Skills 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md) 不是简单目录扫描器，而是 host+per-scope 分层 provider registry：provider 可来自本地、嵌入或远端；catalog snapshot 有 `complete` 字段；变更触发失效与重取；同名项按 scope、rank、provider order 解决。内置本地 provider 的根目录优先级为 project-dsh、project-agents、custom、user-dsh、user-agents、bundled。它支持 `<name>/SKILL.md` 与平面 `<name>.md`，但明确不支持嵌套递归 bundle。

DSH 还区分 `modelInvocable` 和 `userInvocable`，首个完整 catalog 注入会话，之后完整 snapshot 变化才替换；不完整观察保留 last-good catalog。这个设计说明“文件存在”与“本会话目录已生效”之间确实有运行时状态。

官方 [sandbox capability](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/README.md) 已定义会话级进程约束和平台 backend seam。Aster 首阶段应读取/呈现 DSH 自己的状态，不另造第二套策略。

**复用建议：** 初期复用 DSH Web UI；Aster 负责启动、端口/进程、工作区、恢复入口和宿主版本。连接器通过 DSH 的受控 API/事件面观察 catalog，不把 DSH provider 模型翻译成 Pi 模型。

### 3. agentskills/agentskills

规范仓库定义最小可移植包：目录、`SKILL.md`、至少 name/description，以及可选 scripts/references/assets。它的 progressive disclosure 分 Discovery→Activation→Execution 三阶段。这适合作为 Aster 的“原始 Skill 包”基线和通用结构检查。

但规范只定义互操作底座，不定义每个产品的路径、优先级、信任、上下文预算、会话热更新和调用证据。Aster 因而需要 `HostProfile` 覆盖静态宿主差异，而不是把基础规范误当成完整宿主协议。

### 4. UCSB-NLP-Chang/Skill-Usage

仓库包含 34,198 个真实 Skills 的下载入口、BM25/embedding 搜索服务、实验配置和 TerminalBench 2.0 适配。它证明未来可以把来源索引和全文索引做成独立模块，但第一阶段没必要复制其模型检索栈。

**可借鉴：** 原文与结构化元数据分索引、hybrid retrieval、检索轨迹可复现、Skill 选择与实际加载分别记证据。

### 5. qualixar/skillfortify

仓库包含 Python scanner、540 条 benchmark、tests、SBOM/lockfile 和 capability 分析。Aster 可以借鉴其规则分类、确定性 manifest 与扫描结果格式，但不能直接把该工具的 `SAFE` 标签当绝对安全证明：论文 benchmark 主要是合成数据，真实生态仍有召回缺口。

**可借鉴：** 路径穿越、网络下载、脚本/二进制、依赖固定、hash、供应链来源、quarantine；第一阶段可先实现保守静态规则，再为外部扫描器预留只读导入结果的接口。

### 6. SWE-agent/SWE-agent

代码将 actions、观察格式、历史策略和环境反馈视为 ACI。对 Aster 的含义是：可以统一窗口外壳、进程生命周期和审计字段，却不应统一 Pi/DSH 的动作语义和对话状态机。

### 7. ethz-spylab/agentdojo

仓库的 environment state、user goal、attacker goal 和 verifier 分离，适合作为 Aster 后续安全验证设计的参考。第一阶段可采用较小的思想：每个操作都保存“期望状态、观察状态、证据来源”，不要只保存成功布尔值。

## 官方宿主差异矩阵

“已确认”只表示官方文档/官方仓库在核查日明确陈述；它不等于对应版本运行时已经在用户机器上验证。

| 工具 | 官方静态事实可数据化 | 运行时连接深度（第一阶段） | 调研状态 |
|---|---|---|---|
| Pi | 多根目录、递归 bundle/部分平面文件、前置字段和 project trust 规则 | **完整连接器**：版本、严格 JSONL、进程、会话、`get_commands`、加载/调用证据 | 已确认 |
| DSH | 分层 provider、rank/scope、平面与直接 bundle、invocation policy、catalog completeness | **完整连接器**：版本、进程/Web UI、workspace、catalog snapshot/事件、会话恢复 | 已确认；Developer Preview |
| Cursor | 官方 2.4 已确认编辑器与 CLI 支持 Agent Skills、`SKILL.md`、自动/斜杠调用；具体路径/优先级仍需按安装版本探测 | profile + 安装路径探测；不承诺会话调用验证 | 部分确认 |
| Codex | 官方确认 Skills 可在 app/CLI/IDE 使用并可存入仓库；本机发现规则应按实际 Codex 版本与本地配置核验 | profile + 文件部署/本机探测；首阶段不接管其对话流 | 部分确认 |
| Claude Code | enterprise/personal/project/plugin 多 scope；`.claude/skills/<name>/SKILL.md`；live detection；父/嵌套目录发现；扩展 frontmatter | profile + 文件部署/重载提示 | 已确认 |
| Zed | `~/.agents/skills` 与 worktree `.agents/skills`；只支持直接子项；50KB catalog budget；trusted worktree；live reload | profile + 文件部署/结构检查 | 已确认 |
| Kimi Code | project/user/extra/built-in 四层；bundle 与平面；extra dirs；`type: flow` 与调用字段扩展 | profile + 文件部署/启动参数提示 | 已确认 |
| Qoder | user `~/.qoder/skills` 与 project `.qoder/skills`；文档声明同名时 user 覆盖 project | profile + 文件部署/重载提示 | 已确认；其优先级与多数工具相反，应专门测试 |
| Antigravity | Google 官方 codelab 确认 `.agents/skills`、`SKILL.md`、`/skills` 和按 description 发现 | profile + 文件部署/人工验证引导 | 部分确认；桌面/CLI scope 差异需版本探测 |
| Zcode | 未找到足以唯一识别产品及其官方 Skills 规范的一手资料 | 只允许用户绑定目录，状态保持 unknown/scan-only | 未确认 |
| Grok Build | 未找到足以证明本地 Skills 路径、格式、优先级的一手官方资料 | 只允许用户绑定目录，状态保持 unknown/scan-only | 未确认 |

## 对 Aster 的实现边界

### `HostProfile`：受限、版本化、不可执行的数据

允许描述：

- `host_id`、显示名、适用版本范围、profile schema version；
- Windows 路径模板与 scope（user/project/custom/catalog-only）；
- 发现形态（flat Markdown、direct bundle、recursive bundle）；
- 静态优先级、命名/frontmatter 约束、是否需要重启/重载的官方提示；
- 可执行的**结构检查声明**，但检查器代码必须由 Aster 内置并用枚举引用。

禁止描述：

- 任意 shell/PowerShell 命令、动态脚本、下载后执行；
- `verified: true`、`safe: true`、`callable: true` 等运行时结论；
- 宿主 token、凭据、对话内容或连接地址中的秘密；
- 任意第三方二进制适配器。

### `HostConnector`：内置的宿主专用运行时边界

连接器负责版本检测、启动/退出、协议 framing、会话恢复、宿主目录观察、重载/激活和可调用验证。Pi 与 DSH 必须是两个独立实现，也拥有两个独立工作区 UI；共享的仅是进程监管基础设施和 evidence 词汇。

### `EvidenceStore`：与 profile/connector 分离

每条证据至少记录：Skill snapshot、target host、target version、scope、实际路径、观察类型、时间、观察者版本、结果和原始摘要。建议状态顺序：

`discovered → downloaded → structurally_validated → configured → target_discovered → session_loaded → callable_verified`

失败、unsupported、unknown 是独立终态/旁路，不可用低级证据自动升级高级状态。

## 推荐代码模块

- `skill_catalog`：源仓库、子路径、Skill entry 和中文说明
- `source_resolver`：本地来源恢复、GitHub device flow、commit 定位
- `snapshot_store`：不可变 content-addressed 快照、manifest、rollback
- `security_scan`：结构、路径逃逸、脚本/二进制/网络风险
- `host_profiles`：schema、版本匹配、静态路径和约束
- `host_connectors/pi` 与 `host_connectors/dsh`：完全独立
- `deployment`：scope、ownership、事务式复制、外部修改检测
- `evidence`：状态和可追溯观察
- `translation`：原文之外的中文 Markdown 说明

## Phase 4 判断

代码调查支持原结构，但需要把“数据驱动工具描述 + 专用连接器”收紧为三个明确组件：`HostProfile + HostConnector + EvidenceStore`。如果只有前两个，静态声明与运行时事实很容易混在一起；加入独立证据层后，Aster 才能诚实表达“文件已放置但目标未加载”“目标发现但尚未验证调用”等现实状态。

