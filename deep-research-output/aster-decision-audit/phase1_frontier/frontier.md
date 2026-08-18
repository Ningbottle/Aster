# Phase 1：Aster 决策与 Agent 约束的前沿审计

日期：2026-08-16

研究问题：刚才围绕 Aster 的访谈，哪些问题真正降低实现歧义，哪些问题反而制造过度约束、错误承诺或范围膨胀？最终 `AGENTS.md` 与 `content.md` 应分别保存什么？

## 检索范围

检索聚焦 2025–2026 年的 repository context files、编码 Agent 需求澄清、多约束遵循、长周期开发、规格漂移和 Agent Skills 评估。同行评审论文优先；尚未正式发表的 2026 年结果标为 preprint，不把单篇预印本的数字写成永久规律。

## 最新论文与材料（14 篇）

1. **SWE-RPG**（2026，preprint）把问题解决拆为需求澄清、计划与实现；其初步结果把隐含需求恢复识别为主要瓶颈。
2. **ClarifyCodeBench**（2026，preprint）显示代码生成能力不等于主动澄清能力，并指出歧义密度升高时澄清质量快速下降。
3. **How Do Developers Maintain and Evolve Their Agents' Instructions?**（2026，preprint）把 Agent Context Files 当作需要持续维护的配置制品，而不是一次性提示词。
4. **The Spec Growth Engine**（2026，preprint）提出规格—代码漂移门禁；有启发性，但属于架构提案，不能直接当实证结论。
5. **RoadmapBench**（2026，preprint）说明当前 Agent 对跨版本、长周期、多文件开发仍不稳定，反对把整个 Alpha 一次性交给 Agent。
6. **Evaluating AGENTS.md**（2026，preprint）报告冗余 repository context 可能降低成功率并增加成本，直接支持“只写最少稳定约束”。
7. **Agent READMEs**（2025，preprint）发现真实 context files 常写架构与实现命令，却较少写安全和性能边界。
8. **Developer-Provided Context for AI Coding Assistants**（2025，preprint）从 401 个仓库归纳规则类型，说明项目事实、约定、示例与 LLM 指令需要分开组织。
9. **When Instructions Multiply**（Findings of EMNLP 2025）显示多个同时约束会稳定降低遵循成功率，是本轮最强的同行评审证据之一。
10. **CFBench**（ACL 2025）系统评估多约束遵循，说明“每条看似合理”不代表组合起来仍可靠。
11. **Recovering from Misbehaviors in Coding Agents**（AIware 2026）把 specification drift 与推理失误区分，支持用可观察验收纠偏。
12. **Toward User Comprehension Supports for LLM Agent Skill Specifications**（AgentSkills 2026 Poster）指出 Skill 说明经常缺少边界与示例，支持中文说明面向理解而不是重新定义能力。
13. **SPECA**（ICLR 2026 workshop）强调从规范提取可验证清单，但也发现隐含假设仍是漏检来源。
14. **SkillsBench**（2026，preprint）显示策展 Skills 可能有益，但过多或不匹配的 Skills 会退化，和“禁用整套流程、按需使用个别 Skill”的方向一致。

## 前沿趋势

### 1. 从“多问问题”转向“问能改变结果的问题”

澄清有价值，但交互轮数本身不是质量。有效问题应改变产品边界、数据所有权、安全承诺或验收方法；纯实现偏好应延迟到有代码和 fixture 可验证时。

### 2. Repository instructions 应短、稳定、可执行

研究不支持把完整 PRD、每个平台知识和所有开发流程复制进 `AGENTS.md`。高价值内容是准确命令、不可违反的架构边界、数据安全边界和完成定义；动态路线图、估算与待验证假设属于产品文档。

### 3. 规格需要证据，但不应冻结未知实现

清晰验收测试比固定函数行数、目录层数或详细内部接口更可靠。规格应区分：已确认决策、研究支持的建议、待实验假设、明确不做事项。

### 4. 长周期任务必须拆成可运行纵向切片

“先做纯骨架”过小，无法验证产品价值；“一次完成整个 Alpha”又过大，容易让 Agent 在隐含需求上漂移。更合理的是在 Alpha 范围内分多个可运行里程碑，每个都产生用户可见能力和自动化证据。

## 对刚才访谈的初步纠偏

- 不合理：把阶段 0 描述成几乎只有假进程的空骨架。修正：第一里程碑应是真实 Pi 启动/RPC + 一个真实 Skill 快照部署的窄纵切。
- 不合理：询问大量不会改变产品方向的实现选择。修正：把可逆选择交给实现者和 ADR，只冻结高代价、跨模块边界。
- 不合理：曾把“模型账号”当成 Aster 概念。修正：Aster 没有账号域；只显示宿主配置缺失，不读取凭据。
- 不合理：先说不管理宿主更新，后又改为第一阶段核心。修正：文档明确这是经用户修订的当前决定，并把更新分成来源识别、并存安装、验证后切换三个责任。
- 有条件合理：版本并存与快速回退。它只适用于 Aster-managed 安装；不能承诺回退外部包管理器或宿主自身的不可逆数据迁移。
- 过度承诺：把 Aster、Pi、DSH 更新都表述成完全事务化。修正：单个 Aster-managed runtime 可原子切换活动版本；三者之间不是共同事务。

## Phase 1 结论

`AGENTS.md` 应是短小的工作契约，`content.md` 才是产品与架构主文档。首期 Alpha 可以保持较大产品范围，但必须拆成 4–6 个可验证纵向里程碑，不能成为一次性生成任务。
