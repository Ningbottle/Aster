# Phase 3 全文深读笔记

## 1. [@gloaguen2026evaluating] Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?

**元数据**

- 作者：Thibaud Gloaguen、Niels Mündler、Mark Müller、Veselin Raychev、Martin Vechev
- 年份：2026；状态：preprint，v2
- 全文：https://arxiv.org/html/2602.11988

**问题**

仓库级 context file 是否真正提高 coding agent 解决真实 issue 的成功率，还是只改变行为并增加成本？

**主要贡献**

1. 构造 CTXbench：来自 12 个较小 Python 仓库的 138 个真实 bug/feature 任务，仓库本身包含开发者提交的 context files。
2. 同时比较无 context、LLM 自动生成 context、开发者 context 三种条件，并在 SWE-bench Lite 上补充热门仓库实验。
3. 不只看最终测试，还分析步骤数、推理成本和工具轨迹。

**方法**

从 5,694 个 PR 中筛选任务，生成标准化 issue 描述和回归测试；测试要求 base 失败、gold patch 通过，并人工检查避免过拟合。实验覆盖 Claude Code、Codex、Qwen Code，以及多种模型。context file 作为真实 `AGENTS.md`/`CLAUDE.md` 注入。主要指标是所有测试通过的成功率，辅以步骤和推理成本；统计比较使用 Cochran–Mantel–Haenszel 检验。

**实验与结果**

- CTXbench 共 138 个实例，平均 issue 约 212 词、context file 约 641 词、gold patch 约 119 行。
- LLM 生成 context 在 SWE-bench 与 CTXbench 上平均没有显著提升，部分设置下降；成本平均增加约 20%–23%。
- 开发者 context 比 LLM 自动生成者平均更好，但相对“无 context”的平均提升不显著；同样增加步骤与成本。
- 轨迹表明 Agent 会遵循其中的指令，并做更多探索与测试。失败不是“完全没读”，而是额外行为没有稳定转化为正确补丁。

**局限**

研究集中在 Python issue resolution；开发者文件不是随机分配，因果解释仍有限；自动生成任务说明和测试引入 LLM 参与；preprint 结论需要复现。论文也不意味着 context file 无用，而是反对未评估的通用概览和自动生成冗余内容。

**对 Aster 的连接**

`AGENTS.md` 不应复制 `content.md` 的产品背景，也不应由 Agent 扫描仓库后自动膨胀。它只保存 README 中没有、但每次开发都必须知道的非标准事实：架构不变量、准确命令、安全边界和验收要求。任何新规则都应能指出它防止的真实失败。

---

## 2. [@harada2025when] When Instructions Multiply: Measuring and Estimating LLM Capabilities of Multiple Instructions Following

**元数据**

- 作者：Keno Harada 等
- 年份：2025；Findings of EMNLP 2025，同行评审
- 全文：https://arxiv.org/html/2509.21051

**问题**

在保持核心任务不变时，只增加彼此兼容的附加指令，会怎样影响模型满足全部要求的能力？

**主要贡献**

1. ManyIFEval：216 个文本任务，每个组合 1–10 条可程序验证指令，共 2,160 样本。
2. StyleMBPP：500 个 Python 任务，每个组合 1–6 条代码风格指令，共 3,000 样本。
3. 用同一任务和非冲突指令隔离“数量”因素，并比较 prompt-level 与 instruction-level accuracy。
4. 用逻辑回归等方法估计未见组合上的多指令表现。

**方法**

ManyIFEval 从 IFEval 中保留 15 种可组合指令，并显式排除冲突组合。StyleMBPP 在功能测试之外用 Pylint/规则检查 license、缩进、docstring、比较符、行长和变量名。十个闭源/开源模型使用 zero-shot。全部指令需同时通过才算 prompt-level success，单条平均通过率另行报告。

**实验与结果**

- 所有模型的“同时满足全部要求”随指令数增加而持续下降，即使每条要求本身简单且无冲突。
- StyleMBPP 的核心功能正确率可保持相对稳定，但“功能 + 全部风格”成功率显著下降。
- 某些单独成功率接近 100% 的规则，与其他五条组合后会降到 20% 甚至 2%。
- LLM-as-a-judge 明显高估多约束成功：论文示例中十条指令的规则判定为 0.213，而 GPT-4o judge 为 0.657。
- 推理模型总体更好，但没有消除组合约束的容量问题。

**局限**

附加指令主要是机械、可验证的格式/风格规则，不能直接等同复杂软件架构约束；单轮实验不同于长期 coding agent；论文测量的是同时满足概率，不证明某个具体约束没有价值。

**对 Aster 的连接**

不能把“函数不超过 N 行、文件不超过 N 行、必须走某流程、必须使用某模式”等几十条低价值规则叠加。应把质量目标转成少数行为门禁：职责清晰、错误可追踪、写操作可恢复、相关测试通过。格式交给 formatter/linter，而不是自然语言指令。

---

## 3. [@zhou2026swerpg] SWE-RPG: A Unified Issue Resolution Benchmark for Requirement Clarification, Planning, and Code Generation for Coding Agents

**元数据**

- 作者：Xin Zhou 等
- 年份：2026；preprint
- 全文：https://arxiv.org/html/2608.09072

**问题**

Coding agent 失败时，偏差最早发生在隐含需求恢复、实施计划还是代码实现？

**主要贡献**

1. 为每个任务提供 Clarification GT、Plan GT、gold patch、功能测试和可复现环境。
2. 把澄清分为六类，把计划分为目标、位置、方法、约束和验证策略。
3. 以“最早偏离阶段”归因失败，而不是只看补丁 pass/fail。

**方法**

从 2,000+ issue–PR 对逐层筛选到 163 个 Python/Java 任务、31 个仓库。利用仓库、讨论、开发者补丁和测试综合并验证中间 ground truth。评估三个 agent、六个模型后，用保留关键轨迹的 judge 做信息点覆盖和失败阶段归因；50 个样本上与人工共识分别达到 92% 和 96% 一致率。

**实验与结果**

- 163 个任务包含 113 个 bug fix、50 个 feature；平均 gold patch 约 57 LOC。
- 所有配置平均 resolved rate 31.5%，最佳配对约 49.7%。
- 论文把隐含需求恢复识别为大量失败的早期来源；宿主/模型配对对成功率、成本和时间都有明显影响。
- 对计划的判定接受不同文件、符号、架构和步骤顺序，只要求实现责任等价。这一点对项目规范尤其重要：规格应约束责任和结果，而非冻结代码形状。

**局限**

刚发布的预印本；中间 GT 和失败归因都部分依赖强模型；任务来自可回溯 PR，真实新产品没有 gold patch；Ubuntu/Docker 实验不能直接代表 Windows/Tauri。

**对 Aster 的连接**

我们需要写清隐藏成本高的意图，例如“Pi/DSH 不统一”“凭据归宿主”“unmanaged 不覆盖”。但不应预先指定 trait 名、表结构或每个页面组件。`content.md` 应给验收责任和 evidence，开发 Agent 可选择等价实现并用 ADR 记录高代价偏离。

---

## 4. [@fang2026clarify] ClarifyCodeBench: Evaluating LLMs on Clarifying Ambiguous Requirements for Code Generation

**元数据**

- 作者：Zheng Fang 等
- 年份：2026；preprint
- 全文：https://arxiv.org/html/2607.00711

**问题**

模型能否识别不完整需求、提出关键问题、在合适轮数停止，并利用回答写出正确代码？

**主要贡献**

1. 基于 LiveCodeBench v6 用“只删除信息”的方式构造 1–3 个歧义点。
2. 建立十类歧义：术语、行为、边界、索引/区间、顺序/原子性、输出格式、比较规则、单位、集合语义、数值精度。
3. 提出 TKQR（越早问到关键问题越好）和 ORA（既惩罚提前停止，也惩罚不必要轮次）。

**方法**

两名博士生独立标注并交叉校验；每个歧义点有关键问题和从原文删除部分恢复出的答案。模型每轮只能问一个问题或提交代码，最多六轮；judge 三次匹配问题并多数投票。六个模型以 pass@1、TKQR、ORA 评估。

**实验与结果**

- 所有模型在模糊需求上的 pass@1 都比完整需求低 7.8–19.8 个百分点。
- 最佳 TKQR 约 0.30；多数模型过早写代码，询问轮数少于标注所需。
- 多歧义性能急剧下降：双歧义全部问中的最佳比例只有约 0.08，三歧义全部问中几乎为零。
- 单纯延长思考没有稳定改善提问能力；有的模型问得更多，但问题不聚焦，TKQR 仍低。

**局限**

歧义由完整算法题人工删除信息构造，不完全代表开放式产品发现；限定“一轮一个问题”是实验控制；judge 和六轮上限影响结果；模型版本很快变化。

**对 Aster 的连接**

本次逐题访谈的错误不是“问了问题”，而是没有尽早使用价值筛选。应只问能改变高代价结果的问题，并在信息足够后停止。用户已经确认范围，继续询问导航、具体目录或样式会成为 ORA 意义上的无效轮次。现在应进入文档和可验证实施。

---

## 5. [@chatlatanagulchai2025agent] Agent READMEs: An Empirical Study of Context Files for Agentic Coding

**元数据**

- 作者：Worawalan Chatlatanagulchai 等
- 年份：2025；preprint
- 全文：https://arxiv.org/html/2511.12884

**问题**

真实项目中的 Agent Context Files 长什么样、如何维护、包含哪些内容，能否自动分类？

**主要贡献**

1. 从 8,370 个候选仓库收集 2,303 个 context files，覆盖 Claude Code、Codex 和 GitHub Copilot。
2. 分析长度、可读性、Markdown 层级与演化方式。
3. 用 grounded-theory 方法形成 16 类指令 taxonomy，并做 332 文件、多标签人工编码。

**方法**

通过 GitHub API 按官方文件名扫描根目录，得到 922 个 CLAUDE.md、694 个 AGENTS.md、687 个 Copilot 文件。内容 taxonomy 经 open/axial/selective coding，两个标注者产生 2,227 次标签分配，80.3% 初始一致，分歧由第三人解决。另用两个仓库的缩进规则引入前后作探索性 case study。

**实验与结果**

- 文件通常较长、表层可读性较低，但多采用浅层 H1/H2/H3 结构。
- 更新以小规模新增为主，删除很少，说明规则具有单向膨胀倾向。
- 常见内容是架构、实现、构建运行、开发流程；安全和性能等非功能边界较少。
- 两个缩进案例在加入明确规则后违规率下降，但作者明确说两个案例不能建立因果。
- 自动分类对具体主题较好，对抽象维护类主题较弱。

**局限**

这是描述性研究，不能证明常见做法有效；只覆盖三种工具和根文件；Flesch Reading Ease 不适合直接衡量技术文本的可操作性；topic 出现频率不代表写作深度。

**对 Aster 的连接**

要主动防止 `AGENTS.md` 只增不减。文档应有维护规则：新增永久指令必须替换/合并旧规则，产品路线和估算不进入该文件。安全边界虽不需冗长，但必须出现，因为真实生态最容易遗漏它。

---

## 6. [@xu2026roadmapbench] RoadmapBench: Evaluating Long-Horizon Agentic Software Development Across Version Upgrades

**元数据**

- 作者：Xinbo Xu 等
- 年份：2026；preprint
- 全文：https://arxiv.org/html/2605.15846

**问题**

当前 coding agents 能否完成真实版本升级级别的、多目标、跨文件长期开发？

**主要贡献**

1. 构造 115 个真实开源版本升级任务，覆盖 17 仓库、5 种语言。
2. 每个任务平均约五个目标，oracle patch 中位数约 3,714 行、51 个文件。
3. 同时报告“全部完成”的 resolved rate 和按子目标加权的 Completion Score。

**方法**

从持续发布且文档较好的仓库选择连续版本，将 release narrative 与 diff 对齐生成只描述“做什么”的 roadmap。测试从上游适配，并经静态说明—测试对齐检查和 rollout 质量控制。13 个模型在 OpenHands 中各运行一次，部分模型在 Terminus 2 做 scaffold 对照；每任务两小时、固定 Docker 源版本、屏蔽目标代码。

**实验与结果**

- 最佳模型 resolved rate 39.1%，其余最低到 5.2%；Completion Score 普遍高于 resolved rate，说明常见模式是“做完一部分后在集成或正确性上失败”。
- 组件创建与 feature addition 比 bug fix 难；失败包含实现错误、构建错误、缺失实现、接口不匹配与 Agent 中止。
- 相似步数不保证相似成功率，增加预算在约 200 步后多数模型收益趋缓。
- scaffold 会改变表现；少数模型在不同交互格式下反而更好。

**局限**

每模型单次 rollout，方差未知；任务选择偏向高 star、良好 release notes 的项目；完整版本升级远大于常规 feature；模型/脚手架版本属于 2026 特定快照。

**对 Aster 的连接**

“第一阶段 Alpha”可以是完整产品范围，但不能作为一个实现任务。`content.md` 应拆成可运行里程碑，并保存子目标 evidence。第一个里程碑必须是真实纵切而非空骨架；每个后续里程碑都要在前一条可运行链路上扩展。

---

## 7. [@yang2024sweagent] SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering

**元数据**

- 作者：John Yang、Carlos E. Jimenez 等
- 年份：2024；NeurIPS 2024，同行评审
- 全文：https://arxiv.org/html/2405.15793

**问题**

在基础模型不变时，Agent 与计算机之间的动作、反馈和上下文接口会怎样影响软件工程表现？

**主要贡献**

1. 明确提出 Agent–Computer Interface（ACI）：工具动作、文档、环境反馈和历史组织共同构成能力边界。
2. 提供面向模型的文件查看、搜索、编辑和提交动作，以及 lint guardrail。
3. 通过 SWE-bench 和多个 interface ablation 检验具体设计。

**方法**

在 development cases 上观察失败并做配置搜索；SWE-bench Lite 上比较专用 ACI、shell-only 和 RAG。指标为测试全通过率与成功任务平均成本。Ablation 分别替换 editor、search、view window 和 history 策略。

**实验与结果**

- GPT-4 Turbo 的 SWE-agent 在完整 SWE-bench 解决 12.47%，Lite 18%；shell-only Lite 为 11%。
- 取消专用 edit 从 18% 降至 10.3%；full-file viewer 降至 12.7%；保留 full history 降至 15%。
- 100 行窗口优于 30 行和整文件；简洁但信息充分的反馈与 guardrail 能减少级联错误。
- 同一接口迁移到 Claude 后仍有效，但数值不同，说明 interface 与模型相互作用。

**局限**

模型和基准较早；部分设计来自人工观察与有限配置搜索；结果不能证明某接口对所有模型都最优；Linux shell 环境不同于 Windows 桌面应用。

**对 Aster 的连接**

Pi 与 DSH 不是可互换后端。它们的协议、工具目录、插件、会话与反馈方式属于各自 harness。Aster 共享的是窗口、进程、快照、部署和证据基础设施，而不是把两者压成共同消息状态机。保持宿主特色不是装饰偏好，而是能力设计。

---

## 8. [@li2026skillsbench] SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks

**元数据**

- 作者：Xiangyi Li 等
- 年份：2026；preprint，v4（2026-06-14）
- 全文：https://arxiv.org/html/2602.12670

**问题**

策展 Skills 是否在不同模型和 harness 下稳定提高任务成功率，以及数量、长度和调用行为怎样影响效果？

**主要贡献**

1. 最新版本包含 87 个容器化任务、8 个领域、确定性 verifier。
2. 在 no-Skills 与 curated-Skills 匹配条件下评估 18 个 model–harness 配置，每任务三次。
3. 公开任务、harness、轨迹，并做 Skill 数量、复杂度与负面案例审计。

**方法**

从 400 个提交中经自动门禁和人工 review 选出 87 任务。Skill 需提供一类任务的程序性知识，不能泄漏具体答案；任务不告诉 Agent 应用哪个 Skill，由 harness 发现。最新汇总使用 87×3 固定 trial frame，对 18 配置报告 pass rate、绝对提升和 normalized gain。

**实验与结果**

- 最新 v4 平均 pass rate 从 33.9% 升至 50.5%，即 +16.6pp；配置提升从 +4.1 到 +25.7pp，差异明显。
- 同一模型在不同 harness 中表现不同，说明 Skill 效果是具体 Agent 栈的经验属性。
- 87 个任务中 13 个出现负 delta；常见原因是重流程挤占简单策略、Skill 取代更强的原生策略、指定了 Agent 无法调试的脆弱框架。
- 1 个 Skill +18.0pp，2–3 个 +19.0pp，4 个以上只有 +10.1pp。
- compact/standard 文档分别约 +19.0/+21.5pp，comprehensive 只有 +0.7pp。
- 高调用率不保证解决任务，调用与有效性必须分开。

**局限**

2026 preprint 且 benchmark 持续更新，任务由贡献者策展；确定性容器与真实桌面环境不同；“平均提升”不能外推到任意 GitHub Skill；结果随模型、harness 和版本变化。

**对 Aster 的连接**

禁止把整个 Superpowers 流程设为项目默认门禁是合理的；适用、被用户点名的单个 Skill 仍可使用。Skills Manager 必须区分安装、发现、加载、调用和验证，并将兼容证据绑定 `Skill snapshot × host × host version`。中文说明应突出适用边界与快速路径，而不是追求全面重写。

## Phase 3 跨论文结论

八篇全文共同支持五点：

1. 必要澄清应聚焦高代价歧义，并以“是否改变结果”筛选；多问本身不是质量。
2. `AGENTS.md` 的价值来自少量非标准事实与可执行门禁，不能复制产品文档。
3. 约束责任、结果和证据，比约束函数形状、固定行数和统一流程可靠。
4. Alpha 应定义完整边界，但实现必须拆成真实纵向切片；纯 fake 骨架和一次性交付都不理想。
5. Pi/DSH、Skills 兼容和宿主更新都必须以具体 runtime evidence 表述，不能写成永久静态保证。
