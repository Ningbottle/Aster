# Aster 初始化前决策审计：研究报告

日期：2026-08-16  
范围：Windows x64 本地桌面 AI 工作台、Pi/DeepSeek Harness 双宿主、Skills 管理、项目约束与 Alpha 交付方式

## 摘要

Aster 的产品方向与总体技术结构合理，可以进入初始化。推荐结构仍是 Svelte 5 + TypeScript 负责桌面交互，Tauri 2 作为边界，Rust Core 负责进程、文件、下载、校验和 SQLite，Pi 与 DeepSeek Harness（DSH）作为两个独立子进程/宿主。需要修正的不是这条技术链，而是此前讨论中若干过度统一、过度承诺和粒度不当的表达。

第一，Pi 与 DSH 不应共享对话流、RPC 类型或宿主能力接口。二者只能共享进程监管、下载、日志、证据、快照等平台服务。Pi 仅按 RPC 接入；DSH 保留原生 Web UI、插件和自定义模式。研究表明 Agent–Computer Interface 会直接影响 Agent 表现，因此“保持宿主特色”是能力边界，不是 UI 偏好。

第二，Aster Alpha 可以覆盖 Pi、DSH、Skills、更新和恢复，但不能作为一个开发任务一次性交付。应拆成六个可运行里程碑。第一条用户可用纵向链路必须碰到真实风险：真实 Pi 启动、最小 RPC 会话、一个真实 GitHub Skill 快照、部署证据与回滚。纯假数据骨架不足以验证架构。

第三，`AGENTS.md` 应短而稳定，只保存高代价、非标准、长期有效的不变量；不能复制产品文档，也不能塞入整套 Superpowers 流程、固定 trait、固定组件结构或大量行数规则。研究显示额外 context 可能增加约 20%–23% 成本而不稳定改善成功率，多条兼容指令的联合满足率也会随数量增加而下降。质量目标应优先落入类型、schema、formatter、linter、测试和运行证据。

第四，Skills 管理的核心不是“安装成功”，而是来源、不可变快照、部署所有权与分级 evidence。GitHub 是可选更新来源，并非所有 Skill 的身份前提；本地下载和未知来源是一等状态。中文 Markdown 是独立说明，不修改上游。Pi/DSH 可做会话加载与真实调用的深验证，其余目标工具在 Alpha 只承诺文件级部署和静态证据。

第五，Aster、Pi、DSH 的更新在 UI 上可以集中，但底层是三个独立任务。每次应用进程首次进入时检查一次，网络失败不阻塞；安装必须再次确认，不静默更新。“全部更新”只是排队，不是跨产品原子事务。并排版本和活动指针只保证 Aster 管理的程序文件可切换，不能无条件回滚宿主数据迁移。

## 研究问题与方法

本次调研回答五个问题：Aster 的双宿主结构是否合理；不同平台的 Skills 是否真的不同；项目约束写得越多是否越好；完整 Alpha 应怎样拆分；此前访谈里哪些问题或结论不合理。

调研严格按六阶段完成。前沿检索收录 14 篇候选论文；广泛调查形成 43 条去重文献数据库；全文深读 8 篇最相关论文；代码阶段核验 8 个官方或复现仓库；随后综合证据、列出缺口并形成本文。证据优先级为同行评审论文与官方仓库，其次为最新预印本和可复现材料。对 2026 年快速变化的论文、版本、星标和上游产品状态都按时间快照处理，不把它们写成永久事实。

深读的核心证据包括 [Evaluating AGENTS.md](https://arxiv.org/html/2602.11988)、[When Instructions Multiply](https://aclanthology.org/2025.findings-emnlp.896/)、[SWE-RPG](https://arxiv.org/html/2608.09072)、[ClarifyCodeBench](https://arxiv.org/html/2607.00711)、[Agent READMEs](https://arxiv.org/html/2511.12884)、[RoadmapBench](https://arxiv.org/html/2605.15846)、[SWE-agent](https://arxiv.org/html/2405.15793) 和 [SkillsBench](https://arxiv.org/html/2602.12670)。代码核验覆盖 [Pi](https://github.com/earendil-works/pi)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[SkillsBench](https://github.com/benchflow-ai/skillsbench)、[RoadmapBench](https://github.com/UniPat-AI/RoadmapBench) 等仓库。

## 约束文件：为什么更少反而更可靠

Evaluating AGENTS.md 在 CTXbench 的 138 个真实任务中比较无 context、自动生成 context 和开发者 context。自动生成内容没有带来稳定显著提升，却增加约 20%–23% 的成本；开发者内容通常比自动生成内容好，但相对无 context 的平均提升也不显著。重要的是，Agent 并非没有阅读这些文件，它们确实改变了探索与测试行为，只是额外行为没有稳定转化为正确补丁。

When Instructions Multiply 通过 ManyIFEval 和 StyleMBPP 隔离了“指令数量”。即使附加要求彼此兼容、单独看都很简单，模型同时满足全部要求的概率仍持续下降。机械格式、命名和行长规则尤其不该反复写进自然语言上下文，因为它们更适合程序验证。Agent READMEs 又发现真实 context files 常以增加为主、删除很少，这会形成长期膨胀。

因此 Aster 的根 `AGENTS.md` 只需回答四件事：产品不可越过的边界是什么；数据和更新怎样保证不伤害用户；改动完成时要提供什么证据；哪些事实应去哪里查。它不承载路线图和估算，也不预定每个 Rust trait、SQLite 表或 Svelte 组件。函数超过约 60–80 行、手写文件超过约 400–600 行可以触发一次检查，但不自动失败；真正的判断依据是职责、耦合、嵌套、错误路径、测试难度和修改范围。

用户明确禁止把 Superpowers 整套流程作为默认工作流，这一决定得到 SkillsBench 的方向性支持。最新 v4 在 87 个任务、18 个 model–harness 配置上显示 Skills 平均带来 16.6 个百分点提升，但 13 个任务出现负向变化；1–3 个 Skill 的平均收益高于 4 个以上，综合型长文档的结果显著更弱。这不意味着禁用所有 Skills，而是说明应按任务选择少数聚焦 Skill，并让验证结果而不是流程名称决定完成度。

## 双宿主架构：哪里共享，哪里分开

SWE-agent 的 ablation 表明，编辑、查看窗口、历史组织与反馈形式都会改变 coding agent 成功率。这类 interface 不是中性传输层。Pi 与 DSH 即使都被称为 harness，也不能因此压缩为统一消息模型。

Aster 应有共享平台层：Windows 路径与权限处理、子进程监管、stdout/stderr 捕获、下载与哈希、SQLite 元数据、不可变文件快照、EvidenceStore、脱敏日志和更新任务调度。在此之上，`PiConnector` 与 `DshConnector` 独立演进。Pi 只使用严格 JSONL RPC，保留其会话与事件语义；DSH 以原生 Web UI、插件目录、模式和自身持久化为产品主体，Aster 只提供窗口、生命周期、目录/版本发现和可证明的外围管理。

官方仓库进一步强化了这点。Pi 仓库明确说明默认没有内建权限系统，按启动用户权限运行，因此 Aster Alpha 不能展示一个不存在的“已沙箱化”状态。它可以透明告知权限，未来允许用户选择外部隔离，但不自建通用 sandbox。DSH 仓库仍标为 Developer Preview，并提醒可能有破坏性变化。因此深层连接能力必须绑定宿主版本；遇到未知版本时，保留不会损坏数据的启动、停止和原生界面能力，暂停不兼容控制并明确显示“未验证”。

HostProfile 与 HostConnector 也要分责。HostProfile 是随 Aster 发行的版本化、只读、不可执行数据，描述安装发现、候选路径、作用域和静态能力。HostConnector 是内置 Rust 代码，负责运行时交互。Alpha 不远程下发可执行 connector，也不让第三方 profile 引入命令执行。动态、签名、数据型 profile 更新可在未来单独评估。

## Skills 管理：平台不同是真的，但不是完全不兼容

“不同平台的 Skills 是否不同”不能用一个布尔答案概括。上游 Markdown/说明内容可能相同，但各宿主的搜索路径、目录命名、项目/用户作用域、元数据格式、发现时机、上下文注入方式、可调用工具和会话生命周期不同。SkillsBench 也观察到同一模型在不同 harness 上效果不同。这意味着兼容性是经验属性，必须绑定 Skill 快照、目标宿主和宿主版本，而不是在目录扫描后永久打勾。

Aster 的原始快照应以仓库、子路径、commit SHA 和内容哈希确定身份。branch/tag 只用于展示，不作为不可变版本。快照永不原地修改；中文说明另存 Markdown，并标记作者、来源快照和更新时间。下载内容只做静态扫描与复制，Aster 不执行其中脚本。扫描需拒绝路径穿越和逃逸 symlink/reparse point，识别脚本、二进制和网络行为提示；扫描失败进入隔离，不因为用户曾信任同一仓库就隐藏新的可执行内容警告。

部署前创建明确计划：目标工具、作用域、精确文件、目标路径、现有所有者、预期哈希。默认复制，不用 symlink/junction；绝不覆盖未托管目录。托管目录若被外部修改，停止部署并展示 diff。批量部署跨越多个独立目录，无法承诺数据库式 ACID；应以逐步日志、原子文件替换、备份与补偿回滚提供可恢复性，每个目标独立报告成功或失败。

Evidence 模型至少需要以下阶段：discovered、downloaded、structurally_validated、configured、target_discovered、session_loaded、callable_verified。它们不可合并为“已安装/已兼容”。失败、未知、过期也是正式状态。当 snapshot、host version、scope 或 profile version 改变时，深证据必须失效。Pi/DSH 可以观察会话加载并做受控调用；其他目标在 Alpha 只给静态文件证据，尤其是缺少稳定官方资料的 Zcode、Grok Build 等目标必须显示 experimental/unknown。

## 更新、安装与回滚的真实边界

用户要求 Aster 同时管理 Pi 与 DSH 宿主程序的安装和升级，这应保留为 Alpha 核心。每次 Aster 进程首次进入应用时分别检查 Aster、Pi、DSH；检查使用缓存和节流，离线不会阻止打开工作台。发现新版本只显示来源、版本、变更摘要、校验状态和风险，安装仍需用户确认。

Aster 直接管理两类安装：自己创建的 managed install，以及能够高置信识别、且官方更新路径安全明确的安装。来源未知、外部包管理器或用户修改的安装不被覆盖，可引导迁移为 managed。Managed Pi/DSH 使用并排版本：下载到新版本目录，校验，完成最小健康检查，再切换活动指针，保留前一个可用程序版本。

这里必须收窄“回滚”的表述。Aster 能切回的是程序文件；宿主数据库、插件状态、配置格式或会话数据可能已被新版迁移，旧程序未必能够读取。更新前应显示 data compatibility 为 compatible、incompatible 或 unknown。若未知，回滚后不应自动启动旧程序读取新数据，除非有上游证据或用户确认。

“更新全部”同样不是共同事务。Aster、Pi、DSH 来自不同上游，没有联合提交协议。按钮只把三个独立任务排队；其中一个失败不应撤销另一个已经安装且通过验证的版本。UI 要显示各自检查、下载、验证、切换和恢复结果。

## 隐私与本地优先

Aster 不建立账号域，不读取、保存、迁移或同步 Pi/DSH 的模型/API 凭据。凭据缺失时只显示宿主返回的配置状态。GitHub 私有仓库若使用 Device Flow，令牌只能进入 Windows Credential Manager，不进 SQLite、日志、导出包或诊断包。

Alpha 不上传遥测或崩溃报告。日志保存在本机。诊断包只能由用户主动生成，导出前提供逐项预览；排除密钥、环境变量值、对话内容、工作区文件内容、模型配置和原始用户名。完全删除所有路径会降低诊断价值，因此可把路径片段稳定令牌化，例如把两个不同工作区显示为 `<workspace-1>` 与 `<workspace-2>`，保留冲突关系而不暴露真实绝对路径。

应用数据按已确认决定放入标准 `AppData\\Local\\Aster`，Alpha 不做 portable mode。因为 Local 不是天然备份，导出/导入必须覆盖 Skills 元数据、中文说明、来源、部署计划、非敏感设置和证据索引，但不包含宿主密钥。未来是否把用户创作内容迁到 Roaming 可以另行评估，不阻塞初始化。

## 对此前提问的纠错

此前最不合理的不是某一个答案，而是讨论没有及时从“高代价澄清”切换到“可验证实施”。ClarifyCodeBench 同时惩罚提前停止与无价值多问；当前产品身份、平台、宿主边界、更新责任、Skills、隐私和 Alpha 范围已足够清楚，再追问普通目录名、UI 装饰或 trait 形式只会增加上下文负担。

具体修订包括：不做纯 fake Stage 0，而做真实 Pi + Skill 纵切；不把完整 Alpha 当作一次实现；删除 Aster 账号和凭据管理；把 Pi/DSH 更新恢复为核心能力；把“完全回滚”收窄为 managed 程序位；把“全部更新”定义为独立队列；把每次进入检查定义为每进程一次并缓存；Alpha 的 HostProfile 随应用发行；11 个目标工具只有 Pi/DSH 深验证；GitHub 不是 Skill 必需身份；批量部署使用补偿回滚；诊断路径做令牌化；函数行数只作审查信号；Pi/DSH 不统一。

## Alpha 路线与验收

建议 M0 用 1–2 周建立 Svelte/Tauri/Rust/SQLite、数据目录、迁移、进程监管、Evidence 核心、脱敏日志和 fixture；M1 用 2–3 周完成真实 Pi RPC 与一个真实 Skill 的窄纵切；M2 用 2–4 周完成 DSH 原生界面和版本门控；M3 用 3–5 周扩展 Skills 来源、中文说明、GitHub、11 个目标 profile 和部署证据；M4 用 2–4 周完成三类独立更新、managed 版本切换、恢复、导入导出和诊断包；M5 用 2–4 周覆盖 Windows 10 22H2/11 x64、重解析点、文件锁、杀软竞态、安装器、签名、可访问性与文档。总计 12–22 周，置信度中低，不是交付承诺。

每个里程碑必须有用户可见的可运行链路和独立退出标准。M1 不是“页面看起来完成”，而是 Pi 真实启动、RPC 事件可观察、异常退出可恢复、一个快照可以部署和撤销且证据落盘。M2 必须证明 DSH 插件/模式没有因嵌入而失效。M3 的每个 profile 都必须带来源与置信度。M4 的更新测试要覆盖断网、校验失败、磁盘占用、切换失败和外部修改。M5 以正式 Windows x64 矩阵通过为 Alpha 出口。

## 仍需用实验解决的问题

初始化后立即需要锁定一个 Pi 版本，采集成功、取消、协议错误和子进程崩溃的 JSONL fixture；对 DSH 做端口、健康检查、退出和 WebView 嵌入 spike；核验 Pi/DSH 的 Windows 发布资产、哈希或签名；建立程序回滚与数据兼容矩阵；逐个核验目标工具路径与加载时机。Windows 还必须测试长路径、大小写、ACL、只读、文件锁、杀毒占用、junction/symlink/reparse point、ADS 和跨卷移动。

这些是工程证据缺口，不需要继续开放式访谈。只有当官方上游没有可验证的 Windows 安装方式、DSH 无法安全嵌入、某目标只能覆盖用户文件、隐私/账号/静默更新政策要改变，或工期扩大一倍以上时，才重新请求用户的产品决定。

## 最终建议

现在应结束访谈并初始化两个根文档。`AGENTS.md` 保持短、强、稳定，明确 Windows x64、双宿主分离、Pi RPC-only、凭据边界、不可变 Skills、证据与更新安全、完成定义以及“禁止默认采用完整 Superpowers 流程”。`content.md` 承担产品事实、系统边界、数据模型、更新与回滚语义、隐私、Alpha 里程碑、粗估、风险和验收。

随后搭建 M0，但不能把“空骨架能运行”当作第一个产品完成点。第一个完成点是 M1：真实 Pi 与真实 Skill 的窄纵切。这样既保留完整 Alpha 方向，又尽早验证最危险的边界，并为 DSH 和其余 Skills Manager 能力提供可复用的进程、快照和 evidence 基础。

## 结论置信度

- 高：双宿主应分离；Aster 无账号/模型凭据；不静默更新；unmanaged 不覆盖；原始 Skill 不执行；`AGENTS.md` 应避免规则膨胀。
- 中：Svelte/Tauri/Rust/SQLite 技术链；Pi-first 纵切；managed 并排版本；Evidence 分阶段；12–22 周区间。
- 低/待实验：具体 Pi RPC 恢复语义、DSH WebView 边界、全部目标工具路径、每个上游版本的 Windows 发布与数据回滚兼容。

