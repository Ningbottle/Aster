# Phase 4 — 代码与官方仓库核验

检索日期：2026-08-16。星标、提交数等活跃度指标只作为当日快照，不作为架构承诺。仓库用途分为“产品上游”“研究复现”“设计参考”三类；Aster 不因仓库公开就自动引入依赖或执行其中代码。

## 结论先行

1. Pi 与 DSH 都是快速变化、规模较大的独立宿主，且产品形态不同。Aster 应维持两个连接器、两个会话模型、两个更新任务，不建立伪统一抽象。
2. Pi 官方仓库明确说明默认没有内建权限系统，按启动者权限运行。Aster Alpha 不能暗示自己提供了通用沙箱；只能如实显示隔离状态，并允许用户自行采用容器等外部隔离方式。
3. DSH 仍标注为 Developer Preview，并提醒可能有破坏性变化。连接器必须按宿主版本启用能力，不兼容时降级为启动、停止、原生界面和“未验证”状态。
4. SkillsBench 支持 Skills 能提高任务表现，但其代码结构适合借鉴测试夹具和证据记录，不适合作为桌面产品运行时框架直接引入。
5. SWE-RPG 的公开基准仓库当前为空，因此只能引用论文结论，不能把其未发布实现视作 Aster 的可复用基础。

## 仓库清单

| 仓库 | 当日状态与许可 | 对 Aster 的用途 | 明确不做什么 |
|---|---|---|---|
| [earendil-works/pi](https://github.com/earendil-works/pi) | 约 90.9k stars、11.3k forks、5,685 commits；MIT；JavaScript/TypeScript monorepo | Pi 的唯一上游事实来源之一；核验启动、RPC、版本、发布产物、校验和与自更新行为。Aster 管理的安装应优先使用官方发布信息和可用的校验和。 | 不复制 Pi 的会话模型；不声称为 Pi 增加了默认沙箱；不覆盖无法确认来源的手工安装。 |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | 约 116.6k stars、11.4k forks、12,293 commits；MIT；Developer Preview | DSH 的 Web UI、插件、自定义模式、版本与进程启动的事实来源。官方示例使用 `npx @deepseek-ai/dsh web`，本机默认监听 `127.0.0.1:3080`。 | 不把 DSH 塞入 Pi RPC；不把插件/模式重新实现成 Aster 的统一协议；不保证跨破坏性版本的深层兼容。 |
| [benchflow-ai/skillsbench](https://github.com/benchflow-ai/skillsbench) | 约 1.7k stars、355 forks、456 commits；Apache-2.0；87 个原生任务 | 借鉴 `task/environment/oracle/verifier` 分层、固定输入和可复现证据；用于设计 Aster 的 Skill 夹具、结构验证和目标宿主验证。 | 不导入整套 benchmark 运行时；不执行下载 Skill 中的脚本；不把 benchmark 分数当作每个 Skill 的兼容证明。 |
| [UniPat-AI/RoadmapBench](https://github.com/UniPat-AI/RoadmapBench) | 约 14 stars、0 forks、34 commits；MIT；115 个任务、17 个仓库、5 种语言 | 借鉴“目标级”而非只有整任务成败的进度度量。Aster Alpha 应拆成可运行里程碑，每个里程碑有独立退出标准。 | 不引入 Harbor 作为产品依赖；不把路线图 benchmark 的环境假设直接套到 Windows 桌面应用。 |
| [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | 约 20.1k stars、2.2k forks、2,182 commits；MIT；仓库现推荐 mini-swe-agent | 作为 Agent-Computer Interface 设计的历史实例：工具表面与宿主交互协议会实质影响效果，支持 Pi/DSH 独立连接。 | 不作为 Aster 的 Agent 内核；不因历史论文表现而冻结其当前接口；不复制其 Linux/容器假设。 |
| [woraamy/Agent-Context-File-Analysis](https://github.com/woraamy/Agent-Context-File-Analysis) | 约 4 stars、1 fork、15 commits；Python；含数据、分析脚本和测试 | 复核 Agent README/AGENTS 类文件如何随项目增长；可用于以后审计项目约束是否只增不减。 | 不在 Aster 运行时调用；不要求开发必须提供 GitHub/OpenAI 密钥来维护文档。 |
| [kenoharada/Multiple-Instructions-Following](https://github.com/kenoharada/Multiple-Instructions-Following) | 0 stars、0 forks、单次公开提交；Python；ManyIFEval/StyleMBPP 数据与代码 | 作为多约束退化论文的复现材料，支持把格式、长度和机械规则交给 formatter/linter/test，而不是堆进 `AGENTS.md`。 | 不把低活跃度仓库当作生产依赖；不把单一评测的结论扩大成“所有约束都无用”。 |
| [Xin-Zhou-smu/SWE-RPG-Bench](https://github.com/Xin-Zhou-smu/SWE-RPG-Bench) | 当前公开但为空；0 stars、0 forks | 记录代码可用性缺口。论文仍可作为计划评估证据，但结论置信度须与可复现实现分开。 | 不宣称已有可运行代码；不依赖未发布 fixture、grader 或任务数据。 |

## 对实现边界的直接影响

### 宿主连接与更新

- `PiConnector` 与 `DshConnector` 是独立 Rust 边界；可共享进程监管、下载、日志和证据基础设施，但不共享 RPC 类型、会话状态机或 UI 流程。
- 每次 Aster 进程首次进入应用时，可以分别检查 Aster、Pi、DSH 更新；检查应缓存/节流，网络失败不阻塞使用，安装必须再次由用户确认。
- “全部更新”只是把三个独立任务排入队列，不是原子事务。一个失败不应撤销另一个已经成功且通过验证的更新。
- 并排版本与活动指针只承诺用于 Aster 管理的 Pi/DSH 程序文件。宿主自身生成的数据、插件状态或数据库迁移不能被 Aster 无条件回滚。
- 外部包管理器安装或来源不明的手工安装只做检测与引导；除非迁移成 Aster 管理安装，否则不覆盖。

### Skills 与证据

- GitHub 是可更新来源，不是 Skill 身份的强制前提；本地目录、未知来源和离线导入必须是一等来源状态。
- 原始快照只读且不可执行；中文说明是独立 Markdown 派生物，通过内容哈希关联。
- 证据键至少包含 `skill_snapshot × target_host × host_version × deployment_scope`。静态发现、结构验证、配置、宿主加载和真实调用不能折叠成一个“已兼容”。
- Pi/DSH 可做深验证；其他目标在 Alpha 只提供文件部署与静态证据，并明确显示未知项。

### 研发约束

- 研究仓库只提供可验证的设计线索。生产依赖必须另行记录 ADR、版本、许可证、更新策略和退出方案。
- 可复现测试优先使用 Aster 自己维护的小型 fixture；不让 CI 依赖上游仓库实时状态。
- 代码规模不能用固定函数行数代替设计判断。长函数/长文件只触发检查，真正标准是职责、耦合、嵌套、错误路径、测试难度和修改范围。

## Phase 4 Gate

- 已核验仓库：8（要求 ≥3）。
- 其中产品上游：2；研究/复现仓库：6。
- 每个仓库均记录用途与“不采用”的边界。
- 已记录一个关键代码可用性缺口：SWE-RPG-Bench 公开仓库为空。

