# Phase 5 综合：Aster 的 Skill–Host 架构

## 结论先行

Aster 的总体结构合理，可以进入项目规范和骨架阶段，但“受限数据驱动工具描述 + Pi/DSH 专用连接器”应正式改写为：

> **版本化 `HostProfile` + 内置 `HostConnector` + 独立 `EvidenceStore`**

这不是多加一层形式主义，而是把三类性质不同的事实分开：

- `HostProfile`：官方或实测得到的静态规则；
- `HostConnector`：某个宿主当前进程/会话的动作与观察；
- `EvidenceStore`：在某个时间、某个版本、某个路径上究竟观察到了什么。

首阶段只有 Pi 和 DSH 获得完整连接器。其他工具只做版本化 profile、目录发现、部署和结构检查；无法从宿主运行时观察时，最高只到 `configured` 或 `target_discovered`，不得显示“已验证可用”。Pi 与 DSH 的工作区、对话流、恢复语义和 UI 不统一，只共享底层进程监管、快照、部署和 evidence 词汇。

## 研究主题一：Skill 是有效但脆弱的条件性干预

SkillsBench 在理想化策展条件下报告平均约 +16.2pp，但同一研究中 16/84 任务负收益，软件工程子集增益较小；真实生态研究显示，加入干扰项或只能检索到近似 Skill 时，收益快速接近无 Skill 基线；SWE-Skills-Bench 则发现 49 个 SWE Skills 中 39 个没有通过率提升，版本失配还会造成约 9–10pp 下降。

综合含义：

1. `installed` 不是质量判断，`loaded` 也不是效果判断。
2. 兼容性必须绑定 Skill snapshot、宿主和宿主版本，不能是 Skill 的永久属性。
3. 更新默认需要用户确认、diff 和回滚；“上游更晚”不代表“当前项目更好”。
4. Aster 的中文说明用于帮助人理解，不替换原始内容，也不形成兼容性证明。

## 研究主题二：发现、加载、调用和有效是四个问题

ToolRet 证明大工具库中的检索不是普通文档检索：强通用 retrieval 模型的 Completeness@10 仍可低于 45%，检索误差会直接拉低下游通过率。真实 Skill 研究进一步显示，某些 harness 更常加载 Skill，却不一定更成功。

因此 Aster 的状态应至少拆为：

| 状态 | 能证明什么 | 不能证明什么 |
|---|---|---|
| `discovered` | Aster 找到本地条目 | 来源、结构或目标支持 |
| `downloaded` | 不可变快照已保存 | 安全、目标发现 |
| `structurally_validated` | 符合某 profile 的静态规则 | 宿主确实加载 |
| `configured` | 已按计划部署/配置 | 宿主当前能看到 |
| `target_discovered` | 宿主目录/命令目录观察到条目 | 本会话已载入正文 |
| `session_loaded` | 当前会话已加载 | 工作流一定有效 |
| `callable_verified` | 受控验证调用成功 | 对所有任务都有收益 |

状态不能自动跨级推导。例如路径扫描只能产生 `configured` 或静态发现证据；只有 Pi/DSH 连接器可以产生其各自的会话级证据。

## 研究主题三：Harness 不是可忽略的包装层

SWE-agent 的 ACI 消融表明，在模型不变时，动作集合、反馈格式、上下文窗口和历史管理就能显著改变结果。SkillsBench 和真实生态研究也观察到 harness 对注意、读取和调用行为的系统差异。

这支持用户已经作出的产品判断：

- Pi 是 Aster 中独立的 RPC 工作区；严格 JSONL、请求关联、事件流、会话和命令目录保持 Pi 语义。
- DSH 是独立工作区；首阶段复用其 Web UI 和插件化能力，Aster 只做宿主启动、恢复入口、窗口组织和 Skills/evidence 外壳。
- 不设计共同对话对象、不做共同消息状态机、不把 DSH provider registry 强行投影成 Pi command catalog。
- 可以共享 `ManagedProcess`、`SnapshotId`、`DeploymentRecord`、`EvidenceRecord` 等技术基础类型，但共享类型不能携带宿主专有行为。

## 研究主题四：Agent Skills 规范是底座，不是宿主协议

Agent Skills 规范定义目录包、`SKILL.md`、基本元数据与 progressive disclosure，适合作为 Aster 原始快照和基础 parser 的共同入口。但官方工具文档证明平台差异是真实且重要的：

- Pi 多根目录、递归 bundle、部分平面 Markdown，且校验较宽松；
- DSH 使用分层 provider registry、catalog completeness、独立 invocation policy，不递归发现嵌套 bundle；
- Zed 只认直接子项，有 catalog 预算和 worktree trust；
- Claude Code、Kimi Code、Qoder 在 scope、优先级、扩展字段和热更新方面各不相同；
- Cursor、Codex、Antigravity 的部分规则需要按安装版本再探测；
- Zcode、Grok Build 缺乏足够一手证据，应保持 unknown。

所以跨平台复用的正确单位是**原始 Skill snapshot**，不是一份声称对所有宿主都成立的“通用安装结果”。同一 snapshot 可以有多个 deployment 和多条 compatibility evidence。

## 研究主题五：供应链安全应在执行前完成，而不是依赖宿主补救

真实市场研究发现相当比例 Skills 会触发外传、权限、供应链或提示注入模式，脚本型 Skill 被标记概率显著更高。形式化工作强调 Install→Load→Configure→Execute→Persist 的风险传播；AgentDojo 显示仅靠 tool filtering 无法覆盖正常任务与攻击共享工具的情况。

Aster 第一阶段的合理安全边界是：

- 下载与解析，但永不执行 Skill 自带脚本；
- 规范化并验证归档路径，拒绝路径穿越和逃逸 symlink；
- 对脚本、二进制、网络下载、凭据读取、未固定依赖分别提示；
- 原始快照 content-addressed 且不可变，记录 repo、subpath、commit SHA、文件 hash；
- 部署使用精确副本和 ownership manifest，不默认用 symlink；
- 扫描失败进入 quarantine；信任仓库不压掉新可执行内容警告；
- 运行时权限继续由 Pi/DSH 自己治理，Aster 只透明展示，不在首阶段另做通用 sandbox。

## 架构分类法

### 1. Source plane

负责 GitHub 公有/私有来源、device flow、来源恢复、仓库分组、subpath、commit 和批量更新。凭据只存 Windows Credential Manager；SQLite 只存 credential reference。

### 2. Artifact plane

负责不可变 snapshot、结构 parser、中文 Markdown 说明、安全扫描、diff、license 和 content hash。一个仓库 commit 可包含多个 Skill entries。

### 3. Host knowledge plane

`HostProfile` 是只读数据：schema version、host id、适用版本范围、scope/path template、discovery grammar、静态 precedence、frontmatter/命名规则和重载提示。profile 只能引用 Aster 内置 validator 枚举，不得携带命令或脚本。

### 4. Deployment plane

负责目标、scope、实际路径、ownership、事务复制、外部修改检测和 rollback。若目录不受 Aster 管理，绝不覆盖；若受管理但被外部修改，停止并展示 diff。

### 5. Runtime plane

`HostConnector` 是编译进 Aster 的 Rust 实现。Pi/DSH 完全独立；负责版本、进程、协议、会话、catalog 观察、激活和受控验证。第三方可执行连接器不进入第一阶段。

### 6. Evidence plane

单独存储带时间和版本的 observation。任何 UI 徽标都从 evidence 计算，不从 profile 静态布尔值计算。compatibility evidence 建议使用：`upstream_declared`、`structurally_inferred`、`aster_verified`、`load_failed`、`unsupported`、`unknown`。

## 推荐组件关系

```text
GitHub / local source
        ↓
SourceResolver ──→ immutable SnapshotStore ──→ SecurityScan
                         │
                         ├──→ Translation (separate Markdown)
                         └──→ SkillCatalog
                                  │
HostProfile ──→ DeploymentPlanner ├──→ Deployment + Ownership
                                  │              │
PiConnector / DshConnector ───────┴──────────────┤
                                                 ↓
                                           EvidenceStore
                                                 ↓
                                            Svelte UI
```

## 方案比较

| 方案 | 优点 | 主要失败模式 | 结论 |
|---|---|---|---|
| 单一通用 Host Adapter | 表面代码少、UI 统一 | 抹平 harness 语义，运行时状态造假 | 拒绝 |
| 任意第三方可执行 adapter | 扩展快 | 管理器成为供应链执行入口，版本/权限不可控 | 第一阶段拒绝 |
| 只有 profile + connector | 静态与运行时大体分离 | 无处诚实保存观察层级、时间和失败 | 不足 |
| profile + connector + evidence | 可审计、可降级、支持未知、保留宿主特色 | 模型略多，需要严格状态语义 | **推荐** |
| 每个工具全量深连接 | 验证强 | 第一阶段范围爆炸，官方协议不稳定或不存在 | 仅 Pi/DSH |

## 演化时间线

- **2024：** ACI 和 AgentDojo 等工作把接口设计与动态安全提升为 agent 系统的一等问题。
- **2025：** ToolRet 等研究表明，大工具库的发现质量会限制端到端 agent；开放 Skills 规范形成可移植底座。
- **2026 上半年：** SkillsBench、真实生态研究、SWE-Skills-Bench 和供应链研究同时出现，结论从“Skills 能扩展能力”转向“收益依赖检索、版本、harness 和安全边界”。
- **2026 当前：** Pi、DSH、Claude Code、Zed、Kimi、Qoder、Cursor 等均形成自己的扩展语义；共享格式增加，但宿主差异没有消失。
- **Aster 第一阶段：** 用统一 artifact/deployment/evidence 管理差异，用专用 connector 保留 Pi/DSH，而不是追求共同 agent 内核。

## 第一阶段验收性架构判据

1. 删除任何一个 profile 文件不会破坏快照或 evidence，可回退为 unknown。
2. profile 不能执行代码，也不能直接把状态提升为 verified。
3. Pi/DSH 任一升级导致连接器不兼容时，Aster 可检测版本、停止高风险写操作并降级显示，而不是猜测继续。
4. 同一 Skill snapshot 可同时部署给多个宿主，每个 deployment 和 evidence 独立。
5. 更新失败时，仓库内多 Skill 的批量部署可事务回滚。
6. unmanaged 路径永不覆盖；managed 但外部修改时必须停下。
7. 原始 Skill、中文说明、目标部署副本三者身份清楚，中文说明绝不覆盖原文。
8. UI 能准确显示“未知”，而不是为了完整性伪造兼容状态。

## 最终判断

这个结构不仅“能做”，而且已经有足够证据支持进入规范与骨架阶段。真正需要控制的不是函数行数，而是边界：静态 profile 不越权、连接器不互相抽象、evidence 不被布尔值简化、来源快照不可变、部署可恢复。只要这些作为架构不变量写进项目文档，AI 后续写代码不会因为约束过多而僵化，反而能在明确边界内自由选择具体实现。

