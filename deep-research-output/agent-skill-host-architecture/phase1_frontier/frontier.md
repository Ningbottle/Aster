# 前沿扫描：跨平台 Agent Skills 宿主架构

日期：2026-08-15

研究问题：Aster 是否应采用“数据驱动工具描述 + Pi/DSH 专用连接器”，以及通用声明层与宿主专用代码的边界应放在哪里。

## 检索说明

- 检索范围：2025-2026 年 Agent Skills、工具检索、Agent 指令遵循、Skill 供应链与权限控制研究。
- 优先来源：正式会议论文；2026 年 Skill 专项研究尚未完成同行评审者明确标注为 preprint。
- 本地 Semantic Scholar 脚本遭遇公开 API 限流，因此按 Skill 允许的 WebSearch/WebFetch 回退路径，使用 arXiv、OpenReview、ACL Anthology、PMLR、NeurIPS 与 ICLR 官方页面。

## 前沿论文（14 篇）

1. **SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks**（2026，preprint，arXiv:2602.12670）——86 项任务、7 种 agent-model 配置；人工策划 Skills 平均提升明显，但不同领域差异极大且部分任务退化。
2. **How Well Do Agentic Skills Work in the Wild: Benchmarking LLM Skill Usage in Realistic Settings**（2026，preprint，arXiv:2604.04323）——把检索规模扩大到 34k 真实 Skills 后，收益随环境现实程度提高而衰减，说明“已安装”不能等同“有效可用”。
3. **SWE-Skills-Bench: Do Agent Skills Actually Help in Real-World Software Engineering?**（2026，preprint，arXiv:2603.15401）——49 个公开 SWE Skills 中大多数没有带来通过率提升，版本错配会直接降低效果。
4. **Agent Skills: A Data-Driven Analysis of Claude Skills for Extending Large Language Model Functionality**（2026，preprint，arXiv:2602.08004）——从生态数据分析 Skill 的触发、程序逻辑和工具交互结构，为跨宿主元数据建模提供经验基础。
5. **Harnessing Agent Skills: Architectural Patterns and a Reference Architecture for Skill-Mediated LLM Agents**（2026，preprint/SSRN）——将 Skill 从静态制品到实际使用拆成解析、绑定、权限、执行、证据和演化责任，是本研究最直接的架构参考。
6. **Agent Skills in the Wild: An Empirical Study of Security Vulnerabilities at Scale**（2026，preprint，arXiv:2601.10338）——大规模分析 31,132 个 Skills；发现脚本型 Skill 风险显著更高，支持不可变快照、静态扫描和明确部署边界。
7. **Formal Analysis and Supply Chain Security for Agentic AI Skills**（2026，preprint，arXiv:2603.00195）——提出 Skill 生命周期威胁模型、依赖图、锁文件语义和能力约束，为按提交固定版本与回滚提供依据。
8. **Agent Skill Security: Threat Models, Attacks, Defenses, and Evaluation**（2026，preprint，arXiv:2607.13987）——把风险扩展到仓库准入、语义检索、规划选择、执行和演化全过程。
9. **Organizing, Orchestrating, and Benchmarking Agent Skills at Ecosystem Scale**（2026，preprint，arXiv:2603.02176）——研究生态规模的 Skill 组织与编排，直接涉及集合、检索和评估分层。
10. **Retrieval Models Aren't Tool-Savvy: Benchmarking Tool Retrieval for Large Language Models**（Findings of ACL 2025）——ToolRet 含 7.6k 检索任务和 43k 工具，显示通用文本检索并不足以可靠完成工具选择。
11. **ToolGen: Unified Tool Retrieval and Calling via Generation**（ICLR 2025）——在 47k+ 工具规模上统一工具检索与调用，说明大目录必须采用渐进披露或检索，而非全量注入。
12. **AGENTIF: Benchmarking Large Language Models Instruction Following Ability in Agentic Scenarios**（NeurIPS 2025 Datasets & Benchmarks）——验证长指令与复杂约束会成为 agent 场景的独立失败来源。
13. **Agent Security Bench: Formalizing and Benchmarking Attacks and Defenses in LLM-Based Agents**（ICLR 2025）——覆盖系统提示、用户提示、工具和记忆等多个攻击面，支持将确定性安全策略置于模型外部。
14. **Progent: Programmable Privilege Control for LLM Agents**（2025，preprint）——以策略语言约束工具调用，支持把权限与运行时执行从 Skill 正文中分离。

## 前沿趋势

### 1. Skill 正从“提示词文件”变成有生命周期的软件制品

研究对象已经覆盖来源、发现、检索、激活、执行、验证、升级和供应链，而不再只讨论正文写法。这支持 Aster 把原始快照、宿主绑定、部署与运行证据分离。

### 2. 可移植格式不等于可移植行为

统一的 `SKILL.md` 只能提供最低公共语法。实际效果受到宿主目录、调用策略、工具集合、权限、模型和版本影响，故兼容性必须绑定到具体宿主版本。

### 3. 大规模目录需要渐进披露和宿主侧检索

ToolRet、ToolGen 与 2026 Skill 基准共同表明，全量目录会造成选择与上下文问题。工具描述适合声明化，但“当前会话真正可见什么”必须从宿主运行时观测。

### 4. 安全责任必须落在确定性边界

仅依赖 Skill 中的自然语言约束不足以抵御恶意脚本、权限升级和提示注入。下载、校验、部署所有权、权限提示和执行证据应由 Aster 与目标宿主的确定性机制承担。

### 5. 版本和来源是兼容性的组成部分

SWE-Skills-Bench 报告版本错配会造成负收益；供应链研究则要求精确来源、提交固定和可回滚。因此 Aster 的兼容主键不能只有“Skill × 工具”。

## Phase 1 初步判断

“数据驱动工具描述 + Pi/DSH 专用连接器”方向初步成立，但需要调整措辞：

- 声明层只负责可以静态描述和确定性校验的能力，如目录、作用域、发现语法、优先级、重载提示和支持字段。
- 连接器负责所有需要运行时事实的能力，如目标版本探测、会话目录、实际加载、调用证据、进程生命周期和宿主专属权限。
- 不能让一个自由编辑的数据文件声明自己已经“兼容”或“验证通过”；这些状态只能由证据产生。

下一阶段将扩大到 35-80 篇文献，并加入工具调用、agent 安全、软件演化与评估研究。
