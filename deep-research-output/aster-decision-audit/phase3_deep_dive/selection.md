# Phase 3 深读选择

日期：2026-08-16

本阶段选择八篇可获得全文的论文，覆盖从“需求是否问清楚”到“长期项目如何交付”的完整因果链。选择遵循三条原则：至少包含正式同行评审证据；对 2026 年新问题保留预印本但降低权重；每篇都必须能改变 `AGENTS.md`、`content.md` 或 Alpha 交付方式，而不是只提供背景知识。

| # | 论文 | 证据角色 | 选择理由 |
|---|---|---|---|
| 1 | Evaluating AGENTS.md | repository context 的因果评估 | 直接检验 context files 对成功率、成本和行为的影响 |
| 2 | When Instructions Multiply | 多约束遵循的同行评审实验 | 隔离“指令数量”变量，支持减少非必要硬规则 |
| 3 | SWE-RPG | 需求—计划—实现的阶段诊断 | 说明隐含需求恢复是独立瓶颈，但有效计划允许多种实现 |
| 4 | ClarifyCodeBench | 交互式需求澄清 | 同时惩罚漏问和多问，最适合审计本次长访谈 |
| 5 | Agent READMEs | context files 的生态实证 | 说明真实文件写什么、怎样增长，以及描述性研究的边界 |
| 6 | RoadmapBench | 长周期、多文件交付 | 反对一次性完成整个 Alpha，支持分里程碑和部分进度证据 |
| 7 | SWE-agent | Agent–Computer Interface | 证明 harness/interface 影响行为，支持 Pi/DSH 不做伪统一 |
| 8 | SkillsBench | Skills 效果与复杂度 | 最新修订直接支持按需使用少量聚焦 Skill，反对整套流程注入 |

## 覆盖矩阵

- 高价值澄清与无效追问：3、4
- 约束数量、上下文长度与维护：1、2、5、8
- 完整 Alpha 与分段交付：3、6
- Pi/DSH 宿主差异：7、8
- 可执行验收与 evidence：1、3、4、6、8
- 研究外推风险：全部八篇均记录局限

## 全文来源

- [Evaluating AGENTS.md](https://arxiv.org/html/2602.11988)
- [When Instructions Multiply](https://arxiv.org/html/2509.21051)
- [SWE-RPG](https://arxiv.org/html/2608.09072)
- [ClarifyCodeBench](https://arxiv.org/html/2607.00711)
- [Agent READMEs](https://arxiv.org/html/2511.12884)
- [RoadmapBench](https://arxiv.org/html/2605.15846)
- [SWE-agent](https://arxiv.org/html/2405.15793)
- [SkillsBench](https://arxiv.org/html/2602.12670)
