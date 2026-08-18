# Phase 3 深读选择

本阶段选择 8 篇可获得全文、能够共同覆盖 Aster 核心决策的论文。选择标准不是“都直接讨论 Skills”，而是覆盖完整因果链：Skill 是否有效、检索与上下文是否可靠、宿主接口是否影响执行、安全边界应放在哪里。

| # | 论文 | 选择理由 | 证据角色 |
|---|---|---|---|
| 1 | SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks | 目前最系统的跨任务、跨 harness Skills 效果实验 | Skills 有效性、数量与写法、harness 差异 |
| 2 | How Well Do Agentic Skills Work in the Wild? | 从真实 Skills 生态检索，而非理想化配对 | 发现、检索、干扰项与运行时加载 |
| 3 | SWE-Skills-Bench | 专门检验软件工程 Skills 的真实增益和版本失配 | 兼容性不能靠名称或结构推断 |
| 4 | Agent Skills in the Wild: An Empirical Study of Security Vulnerabilities at Scale | 大规模真实 Skill 安全测量 | 安装前扫描、脚本风险、证据措辞 |
| 5 | Formal Analysis and Supply Chain Security for Agentic AI Skills | 提供供应链生命周期、锁定和能力分析框架 | 快照、哈希、锁文件、生命周期分层 |
| 6 | Retrieval Models Aren't Tool-Savvy: Benchmarking Tool Retrieval for Large Language Models | 经同行评审的大规模工具检索基准 | 不能把“已登记”当作“模型能找到” |
| 7 | SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering | 证明同一模型因宿主接口不同而显著变化 | Pi/DSH 不应被抹平成统一对话流 |
| 8 | AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents | 动态、有状态、不可信数据下的安全基准 | 运行时证据、最小工具暴露与隔离边界 |

覆盖矩阵：

- Skills 效果与负效应：1、2、3
- 检索、上下文预算和干扰：1、2、6
- 宿主/harness 专属性：1、2、7
- 供应链和运行时安全：4、5、8
- 版本化、可恢复部署：3、5
- Aster 架构边界：全部八篇共同支撑

