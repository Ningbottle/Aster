# Phase 3 全文深读笔记

## 1. SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks

**来源**：[arXiv 2602.12670](https://arxiv.org/abs/2602.12670)；全文：[ar5iv HTML](https://ar5iv.labs.arxiv.org/html/2602.12670)

**问题。** 论文研究以 Markdown/资源包形式提供的 Agent Skills 是否在不同任务和不同 agent harness 中稳定提高成功率，以及 Skill 的数量、详细程度和加载行为如何影响结果。

**主要贡献。** 作者构建跨 11 个领域的 84 个可执行任务（摘要中的 86 与正文最终评测数存在口径差异），提供确定性 verifier、oracle solution 和任务配对的专家 Skill；在无 Skill、策展 Skill、自生成 Skill三种条件下评估 7 个 agent–model 配置，共收集 7,308 条轨迹，每任务多次运行。

**方法与结果。** 环境使用 Docker 隔离并由 verifier 判分。平均通过率由无 Skill 的 24.3% 提升至策展 Skill 的 40.6%，即约 +16.2 个百分点；自生成 Skill 平均没有带来正收益。结果高度依赖 harness：不同 harness 对 Skill 的注意、读取和执行行为不同。2–3 个 Skill 的平均提升约 +18.6pp，而 4 个以上仅 +5.9pp；详细或紧凑指令通常有益，过度“全面”的 Skill 平均反而为负。84 个任务中有 16 个出现负效应，软件工程子集平均增益仅约 +4.5pp。

**局限。** 任务和 Skill 是理想化配对，难以代表用户面对数万真实 Skills 的发现问题；许多结论来自预印本而非长期复现；具体模型和 harness 版本会快速变化。论文也明确承认 harness 是中介变量，因此不能将某个 Skill 的效果永久登记为宿主无关事实。

**与 Aster 的连接。** Aster 可以存储 Skill 包的静态结构和来源，但不能仅因“已复制到正确目录”就标为有效。兼容性必须包含目标工具及版本，并以运行时 evidence 区分“结构推断、已加载、已验证可调用”。UI 还应避免默认一次暴露过多 Skills。

**代码/资源。** [SkillsBench 项目站](https://www.skillsbench.ai/)

## 2. How Well Do Agentic Skills Work in the Wild?

**来源**：[arXiv 2604.04323](https://arxiv.org/abs/2604.04323)；[全文 HTML](https://arxiv.org/html/2604.04323)

**问题。** 当 agent 不是获得人工指定的正确 Skill，而要从真实公开生态中检索和自主加载时，Skills 还能否提升表现？检索质量、干扰项和 harness 的加载策略各自有多大影响？

**主要贡献。** 论文从公开聚合站收集并去重 34,198 个许可清晰、元数据有效的 Skills，同时索引元数据和全文；比较直接语义检索与由 agent 生成检索词的关键词、语义、混合检索；再把检索结果接入多种模型/harness，区分强制策展、自主策展、策展加干扰、检索含策展、检索不含策展、无 Skill 等条件。

**方法与结果。** Qwen3 embeddings 与 BM25 用于索引。直接语义检索 Recall@3 为 38.1，agentic 语义检索为 56.8，混合检索约 57，说明查询改写有效但离稳定发现仍很远。Claude 的无 Skill 基线约 35.4；强制策展为 55.4，自主策展 51.2，加入干扰降至 43.5，检索含策展约 40.1，不含策展约 38.4。对 Kimi 和 Qwen，缺少策展 Skill 的检索甚至可能低于基线。Kimi 更常加载 Skill，但没有因此得到更高收益，直接说明“加载了”不等于“有效”。在 TerminalBench 2.0 上，Claude 从 57.7 基线提高到 61.4，查询专用精炼后为 65.5。

**局限。** 这是 2026 年的新预印本；只覆盖许可允许收集的公开 Skills；以 SkillsBench 的策展 Skill 作为部分检索真值，可能偏向原基准；具体结论会随生态和 harness 更新变化。

**与 Aster 的连接。** Skills 管理器需要把“发现、部署、目标发现、会话加载、验证可调用”拆成不同状态。翻译 Markdown 有利于人理解，却不能证明模型会选择它。Aster 初期应提供分组、搜索和按会话选择，而不是把全部技能塞进上下文。Pi 与 DSH 的加载证据必须由各自专用连接器观察。

**代码/资源。** [UCSB-NLP-Chang/Skill-Usage](https://github.com/UCSB-NLP-Chang/Skill-Usage)

## 3. SWE-Skills-Bench: Do Agent Skills Improve Software Engineering?

**来源**：[arXiv 2603.15401](https://arxiv.org/abs/2603.15401)；[全文 HTML](https://arxiv.org/html/2603.15401)

**问题。** 公开软件工程 Skills 是否能在真实代码仓库、可执行验收条件和固定版本环境下提升 coding agent；收益是否足以抵消额外 token 和错误指导。

**主要贡献。** 作者从 84,192 个候选中通过质量、许可和可评测性过滤出 49 个 SWE Skills，分为六类；针对固定 commit 的真实 GitHub 项目生成约 565 个需求驱动任务，并把自然语言验收条件转换为确定性 pytest。

**方法与结果。** 实验在 Ubuntu 24.04 Docker 环境中使用 Claude Code 与 Haiku 4.5，对每个任务做有/无 Skill 配对；Skill 放在项目根目录并让 harness 自主发现。49 个 Skill 中 39 个对通过率没有提升，平均仅 +1.2%。少数专门化 Skill 增益明显，例如 risk metrics 最高约 +30pp；但 Spring Boot、Linkerd、Django 等 Skill 因版本或做法失配可下降约 9–10pp。Token 变化从 -78% 到 +451%，平均开销约 +10.5%，且额外 token 与正确性不呈稳定关系。

**局限。** 只使用一个主要 agent–model 组合；任务由需求生成而非自然 issue；固定仓库和类别不能代表所有编码活动；仍是预印本。尽管如此，成对执行和确定性测试使“版本失配会伤害”的方向性证据很强。

**与 Aster 的连接。** 兼容性主键必须是 `Skill 版本 × 目标工具 × 目标工具版本`，必要时还要记录工作区/依赖环境。结构校验只能形成“推断”，不能形成“验证”。升级 UI 必须展示 diff、目标版本风险并允许回滚，不应自动把最新版推广到全部工具。

**代码/资源。** [GeniusHTX/SWE-Skills-Bench](https://github.com/GeniusHTX/SWE-Skills-Bench)

## 4. Agent Skills in the Wild: An Empirical Study of Security Vulnerabilities at Scale

**来源**：[arXiv 2601.10338](https://arxiv.org/abs/2601.10338)；[全文 HTML](https://arxiv.org/html/2601.10338)

**问题。** 真实 Skill 市场中存在哪些安全模式，风险比例多大，脚本型 Skills 是否显著更危险，以及静态和 LLM 辅助扫描能否规模化使用。

**主要贡献。** 作者在 2025 年 12 月从两个市场抓取 42,447 个条目，经仓库 URL、内容 SHA-256、语言、内容长度和可访问性过滤后得到 31,132 个唯一 Skills，其中 3,574 个带脚本。SkillScan 将规则式静态分析与 LLM 分类结合，并用人工样本验证。

**方法与结果。** 200 个样本上的精确率约 86.7%、召回率 82.5%；重加权估计约 84.5%/83.8%。26.1% 条目至少触发一种风险模式，但作者强调“触发”不等于恶意：高风险约 5.2%、中风险 8.1%、低风险 12.8%；数据外传模式约 13.3%、权限提升 11.8%、供应链 7.4%、提示注入 0.7%。带脚本的 Skill 被标记概率约为其他 Skills 的 2.12 倍。对 25 个高置信案例的动态核验确认率为 72%。

**局限。** 早期市场快照、只含英语、排除已删除项目带来幸存者偏差；模式识别会把危险能力和恶意意图混在一起；LLM 分类存在非确定性；动态验证样本小。因此结果适合做风险提示和隔离决策，不适合作为“安全/恶意”的最终裁决。

**与 Aster 的连接。** Aster 应下载后只做静态解析，不执行 Skill 脚本；记录来源、commit、文件清单与哈希；脚本、二进制、网络下载、路径逃逸分别提示。扫描失败应隔离为 quarantine，而不是偷偷安装，也不能因用户曾信任仓库就压掉新可执行内容警告。

**代码/资源。** 论文开放分析制品，但对恶意仓库做匿名处理以避免传播。

## 5. Formal Analysis and Supply Chain Security for Agentic AI Skills

**来源**：[arXiv 2603.00195](https://arxiv.org/abs/2603.00195)；[全文 HTML](https://arxiv.org/html/2603.00195)

**问题。** 如何把 Agent Skill 从一段提示文本视为完整软件供应链制品，形式化其权限、依赖、生命周期传播和可复现安装。

**主要贡献。** SkillFortify 提出 DY-Skill 威胁模型、抽象解释式静态分析、能力格、SAT 依赖解析、确定性锁文件和信任代数。论文把生命周期拆为 Install→Load→Configure→Execute→Persist，并指出前序污染会传播到后序阶段。

**方法与结果。** 基准包含 540 个受控 Skills，恶意/良性各 270，覆盖 Claude、MCP 配置和 OpenClaw 三种格式、13 类攻击。报告 F1 96.15%、precision 100%、recall 92.59%，540 个条目扫描约 0.293 秒；1,000 依赖解析约 0.027 秒，并生成确定性 lockfile。

**局限。** 基准是作者控制的合成语料，0 false positive 不能外推到真实 GitHub 生态；20 个 false negative 仍然重要；论文自己的增强信息流分析没有增加覆盖，7 个目标仅完成 6 个。属于新预印本，形式化模型与真实宿主的动态行为仍有距离。

**与 Aster 的连接。** 最有价值的不是直接复制其复杂形式系统，而是采用生命周期与可复现性原则：仓库/子路径/commit/content hash 构成版本定位；内部快照不可变；部署生成 manifest/lock；更新先 diff 再确认；安装、加载、执行状态分离。第一阶段不应引入可执行第三方 host adapter，否则管理器本身变成新的供应链入口。

**代码/资源。** [qualixar/skillfortify](https://github.com/qualixar/skillfortify)

## 6. Retrieval Models Aren't Tool-Savvy: Benchmarking Tool Retrieval for Large Language Models

**来源**：[ACL Anthology 2025.findings-acl.1258](https://aclanthology.org/2025.findings-acl.1258/)；[PDF](https://aclanthology.org/2025.findings-acl.1258.pdf)

**问题。** 当工具库大到不能全部放进上下文时，传统信息检索模型能否根据用户任务找全并排好真正需要的工具，以及检索误差如何传导到端到端 agent 成功率。

**主要贡献。** ToolRet 汇聚 30 多个 2023–2024 工具使用数据源，构建约 7.6k 个检索任务和 43k 工具语料，包含 Web API、代码函数和自定义工具；比较稀疏、单任务 dense、多任务 embedding、指令模型和 reranker，并发布超过 200k 条工具检索训练数据。

**方法与结果。** 使用 NDCG、Recall、Precision 和“所有目标工具是否都进入 top-k”的 Completeness。许多在 MTEB 等传统 IR 基准上很强的模型在 ToolRet 表现差，部分 dense 模型甚至低于 BM25；7B NV-Embed 的 Completeness@10 仍低于 45%。作者认为原因包括任务意图与工具文档词面重叠低、传统检索训练分布与工具检索发生 domain shift。把 oracle 工具集替换为检索结果会显著降低端到端通过率；例如 ToolBench-G1 中 GPT-3.5 使用 bge-large 检索工具时为 50.6，比 oracle 低 11.4pp。专用训练后，模型 NDCG 和下游通过率提高约 10–20%。

**局限。** 仅英语、仅文本；提示措辞敏感性研究不足；只测“先检索一次、再调用”的流程，不覆盖会话中的交错检索；把不同数据集拼接后存在多个功能相近工具却只有一个标注真值的问题。

**与 Aster 的连接。** Aster 的 Skills 目录不能简单等于会话上下文。需要层次化展示、按仓库/类别/工具筛选，并让 Pi/DSH 连接器报告本会话实际目录或加载结果。首阶段不必训练检索器，但数据模型应保留未来的会话选择和检索证据，不能把“已下载”误标为“可用”。

**代码/资源。** 论文在 ACL Anthology 发布数据与代码链接，并列出全部组成数据集来源。

## 7. SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering

**来源**：[arXiv 2405.15793](https://arxiv.org/abs/2405.15793)；[全文 HTML](https://arxiv.org/html/2405.15793)

**问题。** 当底层语言模型不变时，面向 agent 设计的计算机接口（ACI）是否显著改变其软件工程能力；什么样的动作与反馈格式更适合模型。

**主要贡献。** 论文把 agent 能调用的命令、命令文档、状态反馈、历史管理统一定义为 ACI，并实现专用文件查看、编辑、搜索与导航命令。设计通过人工轨迹观察与配置网格搜索迭代，而不是只换提示词。

**方法与结果。** 在 SWE-bench 与 HumanEvalFix 上评估，并在 SWE-bench Lite 对编辑、搜索、文件窗口、历史等界面选择做消融。GPT-4 Turbo 版本在完整 SWE-bench 解决 286/2,294，约 12.47%；Lite 为 18%。与只使用默认 shell 的 agent 相比，相对提升约 64%，论文摘要按开发对比描述为多解决 10.7 个百分点。全文件展示、完整历史等看似“信息更多”的设计反而下降，说明紧凑、明确反馈更重要。Claude 3 Opus 上也观察到可迁移收益，但绝对性能不同。

**局限。** 工具集小，主要聚焦程序化软件工程；ACI 设计大量依赖人工观察；基础模型和 2024 年 benchmark 已快速演化；成本明显高于非交互 RAG。论文不能证明某一 ACI 对所有模型和领域都最佳。

**与 Aster 的连接。** Pi 和 DSH 的交互形态、状态反馈、命令与上下文管理本身就是能力的一部分。Aster 不应为了 UI 一致性而把二者抹平成一个共同对话流。可以统一进程监管、日志外壳和证据词汇，但上层工作区与连接器应各自保留宿主语义。

**代码/资源。** [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent)，论文同时开放轨迹和评测制品。

## 8. AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents

**来源**：[arXiv 2406.13352](https://arxiv.org/abs/2406.13352)；[全文 HTML](https://arxiv.org/html/2406.13352)

**问题。** 连接不可信外部数据的工具调用 agent 如何在有状态、多步任务中同时保持效用与安全；提示注入防御是否会损害正常任务。

**主要贡献。** AgentDojo 是可扩展动态环境，而非静态问答集；包含 Workspace、Slack、Travel Agency、e-banking 四个状态环境，97 个真实任务与 629 个安全测试用例。用户目标和攻击者目标都有可执行状态判定，并报告 benign utility、utility under attack、targeted ASR。

**方法与结果。** 论文评估多种闭源和开源 tool-calling 模型及攻击/防御。更能完成正常工具任务的模型有时也更能完成攻击者目标，显示效用与攻击面共同增长。二级攻击检测可把攻击成功率降到约 8%；简单 tool filtering 降到 7.5%，但所有防御在攻击下仍损失约 15–20% utility。过滤在 17% 的测试中失效，因为正常任务与攻击需要相同工具；动态计划、跨任务上下文和“只修改结果不额外调用工具”的攻击也超出简单过滤能力。

**局限。** 环境是模拟应用，攻击者与任务集合有限；模型版本快速变化；结果不能直接等同本地 coding agent 的文件/进程权限风险。它测的是提示注入与工具权限交互，而不是完整 OS sandbox。

**与 Aster 的连接。** 静态 profile 不应宣称运行时安全。Aster 应展示宿主自己的权限/隔离状态，且首阶段不替宿主实现新的通用 sandbox。Skills 内容始终按不可信供应链输入处理；只有 Pi/DSH 专用连接器能观察会话中实际暴露的能力和调用结果。失败、未观察和不支持必须是不同 evidence 状态。

**代码/资源。** [ethz-spylab/agentdojo](https://github.com/ethz-spylab/agentdojo)；[文档与榜单](https://agentdojo.spylab.ai/)

## 跨论文即时结论

八篇全文共同否定了两种简化：一是“格式兼容即可视为可用”，二是“把所有宿主塞进一个统一抽象即可获得一致行为”。更稳妥的边界是：

1. `HostProfile` 只保存版本化、可审计的静态事实，例如目录、发现形态、优先级和声明字段。
2. `HostConnector` 保存宿主专用运行时动作和观察，Pi/DSH 各自实现，不能由 profile 中的布尔值替代。
3. `EvidenceStore` 独立保存发现、部署、目标发现、会话加载、验证调用和失败记录，全部带时间与版本。
4. 不可变来源快照、content hash、diff、显式升级确认和回滚属于核心，而非后期增强。
5. 第一阶段不开放任意可执行第三方连接器；否则 Skills 管理器会扩大自身供应链攻击面。

