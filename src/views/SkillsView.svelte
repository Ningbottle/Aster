<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { renderMarkdown } from "../lib/markdown";
  import type {
    DiscoveredHost,
    DiscoveredSkillSummary,
    SkillItem,
    SkillRepoGroup,
    TranslationDoc,
    SnapshotDiff,
    DeploymentPlan,
    BatchDeployResult,
    DeploymentTarget,
  } from "../types";

  export let activeTool: string = "all";
  export let discoveredHosts: DiscoveredHost[] = [];
  export let skills: SkillItem[] = [];
  export let onRefresh: () => Promise<void>;

  let currentSkill: SkillItem | null = null;
  let docLang: "zh" | "en" = "zh";

  // 仓库扫描状态
  let scanRepoPath = "";
  let isScanningRepo = false;
  let scanMsg = "";
  let scanError = false;

  // 部署计划状态
  let isPlanningDeploy = false;
  let deployPlan: DeploymentPlan | null = null;
  let deployResultMsg = "";
  let deployIsError = false;
  let applyingDeploy = false;

  // Diff 状态
  let isDiffing = false;
  let diffData: SnapshotDiff | null = null;
  let diffMsg = "";

  // 回滚与 M1 流水线状态
  let isRollingBack = false;
  let rollbackMsg = "";
  let isRunningPipeline = false;
  let pipelineMsg = "";

  // 派生中文说明编辑
  let isEditingZh = false;
  let editZhBody = "";
  let isSavingZh = false;
  let saveZhMsg = "";

  let transError = "";

  $: filteredSkills =
    activeTool === "all"
      ? skills
      : skills.filter((s) => s.tools.some((t) => t.toLowerCase() === activeTool.toLowerCase()));

  export async function openSkillById(id: string) {
    const s = skills.find((x) => x.id === id);
    if (s) {
      currentSkill = s;
      docLang = "zh";
      editZhBody = s.zh;
      isEditingZh = false;
      saveZhMsg = "";
      transError = "";
      diffData = null;
      diffMsg = "";
      deployPlan = null;
      deployResultMsg = "";

      // 从 Rust 读取该 skill 的真实派生翻译
      try {
        const trans = await invoke<TranslationDoc | null>("skill_get_translation", {
          skillName: s.skill_name || s.id,
          currentSnapshotId: s.snapshot_id || null,
        });
        if (trans && trans.markdown_body) {
          s.zh = trans.markdown_body;
          editZhBody = trans.markdown_body;
        }
      } catch (err: any) {
        transError = `读取派生说明异常: ${typeof err === "string" ? err : (err?.message || JSON.stringify(err))}`;
      }
    }
  }

  function handleBackToBrowser() {
    currentSkill = null;
    deployPlan = null;
    deployResultMsg = "";
    diffData = null;
    transError = "";
  }

  async function handleScanRepo() {
    if (isScanningRepo) return;
    isScanningRepo = true;
    scanError = false;
    scanMsg = "正在扫描仓库技能...";
    try {
      const group = await invoke<SkillRepoGroup>("skills_scan_repo", {
        repoPath: scanRepoPath.trim() ? scanRepoPath.trim() : null,
        repoName: null,
      });

      if (group && group.skills) {
        scanMsg = `扫描完成：在 ${group.repo_name} 中发现 ${group.skills.length} 个 Skill 并已存入快照！`;
        await onRefresh();
      }
    } catch (e: any) {
      scanError = true;
      scanMsg = `扫描失败: ${typeof e === "string" ? e : (e?.message || JSON.stringify(e))}`;
    } finally {
      isScanningRepo = false;
    }
  }

  async function handlePlanDeployment() {
    if (!currentSkill || !currentSkill.snapshot_id) {
      deployIsError = true;
      deployResultMsg = "当前技能快照 ID 缺失，无法生成部署计划。";
      return;
    }
    isPlanningDeploy = true;
    deployResultMsg = "";
    deployIsError = false;
    try {
      // 仅根据本地已发现且真实存在的宿主生成目标，不编造不存在的宿主
      const availableHosts = discoveredHosts.filter(
        (h) => h.installed || h.discovered_scopes.some((sc) => sc.exists)
      );

      if (availableHosts.length === 0) {
        deployIsError = true;
        deployResultMsg = "当前未检测到任何已安装的宿主工具（如 Pi、Cursor、DSH 等）。请先确认宿主环境再生成计划。";
        isPlanningDeploy = false;
        return;
      }

      const targets: DeploymentTarget[] = availableHosts.map((h) => ({
        host: h.profile.id,
        host_version: h.profile.profile_version || "1.0.0",
        scope: "user",
        path: "",
      }));

      const plan = await invoke<DeploymentPlan>("skill_batch_deploy_plan", {
        snapshotId: currentSkill.snapshot_id,
        targets,
      });
      deployPlan = plan;
    } catch (e: any) {
      deployIsError = true;
      deployResultMsg = `生成部署计划失败: ${typeof e === "string" ? e : (e?.message || JSON.stringify(e))}`;
    } finally {
      isPlanningDeploy = false;
    }
  }

  async function handleApplyDeployment() {
    if (!deployPlan || !currentSkill) return;
    applyingDeploy = true;
    deployIsError = false;
    try {
      // 严格透传 plan 阶段确定的 host_version 与 target_path，保证 Evidence 链键值准确无误
      const targets: DeploymentTarget[] = deployPlan.items.map((it) => ({
        host: it.host_id,
        host_version: it.host_version || "1.0.0",
        scope: it.scope_kind,
        path: it.target_path,
      }));

      const res = await invoke<BatchDeployResult>("skill_batch_deploy_apply", {
        snapshotId: deployPlan.snapshot_id,
        targets,
      });
      if (res.success) {
        deployResultMsg = `部署成功！已写入 ${res.deployed_count} 个目标工具目录并记录 Evidence 链。`;
      } else {
        deployIsError = true;
        deployResultMsg = `部署失败，已触发补偿回滚：${res.error}`;
      }
      await onRefresh();
    } catch (e: any) {
      deployIsError = true;
      deployResultMsg = `应用部署失败: ${typeof e === "string" ? e : (e?.message || JSON.stringify(e))}`;
    } finally {
      applyingDeploy = false;
    }
  }

  async function handleGetDiff() {
    if (!currentSkill || !currentSkill.snapshot_id || isDiffing) return;
    if (!currentSkill.previous_snapshot_id) {
      diffMsg = "当前为该技能初始快照，暂无更早历史版本可对比。";
      return;
    }
    isDiffing = true;
    diffMsg = "正在生成与上一历史快照的 Diff...";
    diffData = null;
    try {
      diffData = await invoke<SnapshotDiff>("skill_get_diff", {
        baseSnapshotId: currentSkill.previous_snapshot_id,
        headSnapshotId: currentSkill.snapshot_id,
      });
      diffMsg = `Diff 就绪：${diffData.added_files.length} 个新增，${diffData.modified_files.length} 个修改，${diffData.deleted_files.length} 个删除，${diffData.identical_files.length} 个一致。`;
    } catch (e: any) {
      diffMsg = `获取 Diff 失败: ${typeof e === "string" ? e : (e?.message || JSON.stringify(e))}`;
    } finally {
      isDiffing = false;
    }
  }

  async function handleRollbackLatest() {
    if (isRollingBack) return;
    isRollingBack = true;
    rollbackMsg = "正在执行最新单次部署回滚...";
    try {
      const res = await invoke<{ rolled_back: string[] }>("skill_rollback_latest");
      if (res.rolled_back.length > 0) {
        rollbackMsg = `回滚成功！已清理最新部署目录：${res.rolled_back.join("、")}`;
      } else {
        rollbackMsg = "当前暂无处于 deployed 状态的活跃部署可供回滚。";
      }
      await onRefresh();
    } catch (e: any) {
      rollbackMsg = `回滚失败: ${typeof e === "string" ? e : (e?.message || JSON.stringify(e))}`;
    } finally {
      isRollingBack = false;
    }
  }

  async function handleRunM1Pipeline() {
    if (isRunningPipeline) return;
    isRunningPipeline = true;
    pipelineMsg = "正在运行 M1 示例流水线 (下载 -> 快照 -> 静态检查 -> 部署 -> 验证)...";
    try {
      const res: any = await invoke("skill_m1_pipeline");
      pipelineMsg = `M1 流水线执行成功！快照: ${res.snapshot_id}，已完成 ${res.stages.length} 个阶段。`;
      await onRefresh();
    } catch (e: any) {
      pipelineMsg = `M1 流水线失败: ${typeof e === "string" ? e : (e?.message || JSON.stringify(e))}`;
    } finally {
      isRunningPipeline = false;
    }
  }

  async function handleSaveZh() {
    if (!currentSkill) return;
    isSavingZh = true;
    saveZhMsg = "";
    try {
      const doc: TranslationDoc = {
        skill_name: currentSkill.id,
        snapshot_id: currentSkill.snapshot_id || "default",
        purpose: currentSkill.desc,
        applicable_tasks: "通用任务",
        target_tools: currentSkill.tools,
        prerequisites: "无特殊前置依赖",
        risks: "标准权限",
        author: "workbench",
        updated_at: new Date().toISOString(),
        markdown_body: editZhBody,
        is_stale: false,
      };
      await invoke("skill_save_translation", { doc });
      currentSkill.zh = editZhBody;
      isEditingZh = false;
      saveZhMsg = "已成功保存中文说明！";
    } catch (e: any) {
      saveZhMsg = `保存失败: ${typeof e === "string" ? e : (e?.message || JSON.stringify(e))}`;
    } finally {
      isSavingZh = false;
    }
  }
</script>

<div class="view-skills-wrap">
  {#if !currentSkill}
    <!-- 浏览态：Skill 卡片网格 + 仓库扫描与操作栏 -->
    <div class="view-scroll">
      <div class="page-head">
        <div>
          <h1>Skills-Hub</h1>
          <p class="desc">各个 AI 工具里安装的 skill，点左侧工具名筛选，点卡片查看详情与批量部署</p>
        </div>

        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <!-- 扫描本地 Skills 仓库 -->
          <div class="scan-bar">
            <input
              type="text"
              class="scan-input"
              placeholder="本地仓库路径（留空扫描 staging/repo）"
              bind:value={scanRepoPath}
            />
            <button
              type="button"
              class="btn primary sm"
              disabled={isScanningRepo}
              on:click={handleScanRepo}
            >
              {isScanningRepo ? "扫描中..." : "扫描本地仓库"}
            </button>
          </div>

          <button
            type="button"
            class="btn sm"
            disabled={isRunningPipeline}
            on:click={handleRunM1Pipeline}
            title="执行 M1 测试流水线（下载、快照、静态检查、部署与验证）"
          >
            {isRunningPipeline ? "运行中..." : "运行 M1 示例流水线"}
          </button>

          <button
            type="button"
            class="btn sm"
            disabled={isRollingBack}
            on:click={handleRollbackLatest}
            title="撤销最近的部署"
          >
            {isRollingBack ? "回滚中..." : "回滚最新部署"}
          </button>
        </div>
      </div>

      {#if scanMsg}
        <div style="padding: 10px 28px 0;">
          <div class="tag {scanError ? 'err' : 'info'}">{scanMsg}</div>
        </div>
      {/if}

      {#if pipelineMsg}
        <div style="padding: 10px 28px 0;">
          <div class="tag info">{pipelineMsg}</div>
        </div>
      {/if}

      {#if rollbackMsg}
        <div style="padding: 10px 28px 0;">
          <div class="tag info">{rollbackMsg}</div>
        </div>
      {/if}

      <div class="page-body">
        <div class="skills-grid">
          {#if filteredSkills.length === 0}
            <div class="skills-empty" style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: var(--r-md);">
              <div style="font-size: 15px; font-weight: 550; margin-bottom: 6px; color: var(--fg);">暂无已快照的技能</div>
              <p style="font-size: 12.5px; max-width: 480px; margin: 0 auto 16px;">
                当前 SQLite 中未记录任何技能快照。可在上方输入本地仓库路径并点击“扫描本地仓库”，或点击“运行 M1 示例流水线”生成第一个真实快照与部署。
              </p>
            </div>
          {:else}
            {#each filteredSkills as s, i (s.id)}
              <button
                type="button"
                class="skill-card"
                style="animation-delay: {Math.min(i, 5) * 30}ms;"
                on:click={() => openSkillById(s.id)}
              >
                <span class="sc-name">{s.skill_name || s.id}</span>
                <span class="sc-desc">{s.desc}</span>
                <span class="sc-foot">
                  {#each s.tools as tool}
                    <span class="sc-tool">{tool}</span>
                  {/each}
                  <span class="sc-date">{s.updated}</span>
                </span>
              </button>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <!-- 详情态：作用 + 批量部署计划 + Diff + 流程 + 原文/译文 (Markdown 渲染) -->
    <div class="skill-page">
      <div class="sp-top">
        <button type="button" class="sp-back" on:click={handleBackToBrowser}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M10 3L5 8l5 5" />
          </svg>
          <span>返回</span>
        </button>

        <div class="sp-title">
          <div class="sp-name">{currentSkill.skill_name || currentSkill.id}</div>
          <div class="sp-meta">
            {#if currentSkill.tools && currentSkill.tools.length > 0}
              可用于 {currentSkill.tools.join("、")} ·
            {/if}
            快照 ID: <code>{currentSkill.snapshot_id}</code>
          </div>
        </div>

        <div style="margin-left: auto; display: flex; gap: 8px; align-items: center;">
          {#if currentSkill.previous_snapshot_id}
            <button
              type="button"
              class="btn sm"
              disabled={isDiffing}
              on:click={handleGetDiff}
            >
              {isDiffing ? "Diff 计算中..." : "对比历史快照 Diff"}
            </button>
          {:else}
            <button
              type="button"
              class="btn sm"
              disabled
              title="当前为初始快照，暂无更早历史版本可对比"
            >
              无历史快照 Diff
            </button>
          {/if}

          <button
            type="button"
            class="btn sm primary"
            disabled={isPlanningDeploy}
            on:click={handlePlanDeployment}
          >
            {isPlanningDeploy ? "计算计划中..." : "批量部署到宿主"}
          </button>

          <div class="seg">
            <button
              type="button"
              class:on={docLang === "zh"}
              on:click={() => { docLang = "zh"; isEditingZh = false; }}
            >
              中文说明
            </button>
            <button
              type="button"
              class:on={docLang === "en"}
              on:click={() => { docLang = "en"; isEditingZh = false; }}
            >
              原文
            </button>
          </div>
        </div>
      </div>

      {#if transError}
        <div style="padding: 10px 28px 0;">
          <div class="tag err">{transError}</div>
        </div>
      {/if}

      {#if deployResultMsg}
        <div style="padding: 10px 28px 0;">
          <div class="tag {deployIsError ? 'err' : 'info'}">{deployResultMsg}</div>
        </div>
      {/if}

      {#if diffMsg}
        <div style="padding: 10px 28px 0;">
          <div class="tag info">{diffMsg}</div>
        </div>
      {/if}

      <div class="view-scroll">
        <div class="page-body sp-body">
          <!-- 批量部署计划卡片 -->
          {#if deployPlan}
            <section class="card sp-block" style="border-color: var(--accent);">
              <div class="sp-block-h" style="color: var(--accent);">
                <span>批量部署计划 (Batch Deployment Plan)</span>
                <span class="hint">共 {deployPlan.total_targets} 个目标，{deployPlan.ready_targets} 个就绪</span>
              </div>
              <div class="deploy-plan-list">
                {#each deployPlan.items as item}
                  <div class="deploy-plan-item" class:blocked={item.status !== "ready"}>
                    <div>
                      <strong>{item.host_display_name || item.host_id}</strong>
                      <span class="tag neutral sm" style="margin-left: 6px;">{item.scope_kind}</span>
                      <div class="faint" style="font-size: 11px; margin-top: 2px;">{item.target_path}</div>
                    </div>
                    <div style="text-align: right;">
                      {#if item.status === "ready"}
                        <span class="tag ok sm">就绪 (复制)</span>
                      {:else if item.status === "already_deployed_by_aster"}
                        <span class="tag info sm">已由 Aster 部署</span>
                      {:else if item.status === "blocked_unmanaged_conflict"}
                        <span class="tag warn sm" title={item.reason || "目录存在外部文件"}>存在外部文件 (保护跳过)</span>
                      {:else}
                        <span class="tag err sm">{item.status}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
              <div style="margin-top: 14px; display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" class="btn sm" on:click={() => (deployPlan = null)}>关闭计划</button>
                <button
                  type="button"
                  class="btn sm primary"
                  disabled={!deployPlan.can_apply || applyingDeploy}
                  on:click={handleApplyDeployment}
                >
                  {applyingDeploy ? "正在写入与记录证据..." : "确认应用批量部署"}
                </button>
              </div>
            </section>
          {/if}

          <!-- 快照 Diff 查看卡片 -->
          {#if diffData}
            <section class="card sp-block" style="border-color: var(--border-strong);">
              <div class="sp-block-h">
                <span>快照文件清单与差异 ({diffData.identical_files.length + diffData.added_files.length + diffData.modified_files.length} 个文件)</span>
                <button type="button" class="btn sm" on:click={() => (diffData = null)}>关闭 Diff</button>
              </div>
              <div style="font-size: 12px; font-family: var(--font-mono); display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto;">
                {#each diffData.identical_files as f}
                  <div style="color: var(--muted); padding: 2px 6px; background: var(--surface-2); border-radius: var(--r-sm);">
                    [=] {f}
                  </div>
                {/each}
                {#each diffData.added_files as f}
                  <div style="color: var(--success); padding: 2px 6px; background: oklch(0.96 0.05 152); border-radius: var(--r-sm);">
                    [+] {f}
                  </div>
                {/each}
                {#each diffData.modified_files as f}
                  <div style="color: var(--warn); padding: 2px 6px; background: oklch(0.96 0.05 78); border-radius: var(--r-sm);">
                    [~] {f}
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          <section class="card sp-block">
            <div class="sp-block-h">作用</div>
            <p class="sp-purpose-text">{currentSkill.desc}</p>
            <div class="sp-chips">
              {#each currentSkill.tools as tool}
                <span class="sc-tool">{tool}</span>
              {/each}
            </div>
          </section>

          {#if currentSkill.flow && currentSkill.flow.length > 0}
            <section class="card sp-block">
              <div class="sp-block-h">流程</div>
              <div class="flow">
                {#each currentSkill.flow as step, i}
                  {#if i > 0}
                    <span class="flow-arrow">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
                        <path d="M6 3l5 5-5 5" />
                      </svg>
                    </span>
                  {/if}
                  <span class="flow-node">
                    <span class="fn">{i + 1}</span>
                    <span>{step}</span>
                  </span>
                {/each}
              </div>
            </section>
          {/if}

          <section class="card sp-block">
            <div class="sp-block-h">
              <span>{docLang === "zh" ? "中文说明" : "原文"}</span>
              <span class="hint">
                {docLang === "zh" ? "独立 Markdown · 派生元数据" : "只读快照 · 英文原始内容"}
              </span>

              {#if docLang === "zh"}
                <div style="margin-left: auto;">
                  {#if !isEditingZh}
                    <button type="button" class="btn sm" on:click={() => (isEditingZh = true)}>
                      编辑中文说明
                    </button>
                  {:else}
                    <button type="button" class="btn sm" on:click={() => (isEditingZh = false)} style="margin-right: 6px;">
                      取消
                    </button>
                    <button type="button" class="btn sm primary" disabled={isSavingZh} on:click={handleSaveZh}>
                      {isSavingZh ? "保存中..." : "保存说明"}
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            {#if saveZhMsg}
              <div class="tag info" style="margin-bottom: 10px;">{saveZhMsg}</div>
            {/if}

            {#if isEditingZh && docLang === "zh"}
              <textarea
                class="zh-editor"
                bind:value={editZhBody}
                rows="14"
                aria-label="中文说明编辑"
              ></textarea>
            {:else}
              {#if docLang === "zh" && !currentSkill.zh}
                <div style="padding: 24px; text-align: center; color: var(--muted); font-size: 12.5px;">
                  暂无派生中文说明。点击右上角“编辑中文说明”可为此技能创建专属中文说明。
                </div>
              {:else}
                <div class="md">
                  {@html renderMarkdown(docLang === "zh" ? currentSkill.zh : currentSkill.original)}
                </div>
              {/if}
            {/if}
          </section>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .view-skills-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .view-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .page-head {
    flex: none;
    padding: 18px 28px 0;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
  }
  .page-head h1 {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--fg);
  }
  .page-head .desc {
    font-size: 12.5px;
    color: var(--muted);
    margin-top: 2px;
  }
  .page-body {
    padding: 16px 28px 32px;
  }
  .skills-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }
  .skill-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
    padding: 14px 16px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.12s ease, box-shadow 0.16s ease;
    cursor: pointer;
    animation: cardIn 0.17s cubic-bezier(0.2, 0, 0, 1) both;
  }
  .skill-card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-2);
  }
  .skill-card .sc-name {
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fg);
  }
  .skill-card .sc-desc {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.6;
  }
  .skill-card .sc-foot {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .skill-card .sc-tool,
  .sc-tool {
    font-size: 10.5px;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .skill-card .sc-date {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--faint);
  }
  .skills-empty {
    grid-column: 1 / -1;
    text-align: center;
    padding: 48px 24px;
    color: var(--faint);
    font-size: 12.5px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-lg);
  }

  /* 详情页 */
  .skill-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    animation: pageIn 0.2s cubic-bezier(0.2, 0, 0, 1);
  }
  .sp-top {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
    padding: 12px 28px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .sp-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--muted);
    border-radius: var(--r-md);
    background: none;
    border: none;
    cursor: pointer;
  }
  .sp-back:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .sp-back svg {
    width: 12px;
    height: 12px;
  }
  .sp-title {
    min-width: 0;
  }
  .sp-name {
    font-family: var(--font-mono);
    font-size: 14.5px;
    font-weight: 600;
    color: var(--fg);
    word-break: break-all;
  }
  .sp-meta {
    font-size: 11.5px;
    color: var(--faint);
    margin-top: 2px;
  }
  .seg {
    margin-left: auto;
    flex: none;
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .seg button {
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 11.5px;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--fg);
  }
  .seg button.on {
    background: var(--surface);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-1);
    font-weight: 550;
  }
  .sp-body {
    max-width: 880px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .sp-block {
    padding: 18px 20px;
  }
  .sp-block-h {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--faint);
    margin-bottom: 10px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .sp-block-h .hint {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .sp-purpose-text {
    font-size: 13.5px;
    line-height: 1.75;
    color: var(--fg);
    margin-bottom: 12px;
    max-width: 65ch;
  }
  .sp-chips {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }
  .flow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    row-gap: 10px;
  }
  .flow-node {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    font-size: 12px;
    color: var(--fg);
  }
  .flow-node .fn {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
    display: grid;
    place-items: center;
    background: var(--fg);
    color: var(--surface);
    font-size: 10.5px;
    font-weight: 600;
  }
  .flow-arrow {
    width: 22px;
    flex: none;
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .flow-arrow svg {
    width: 12px;
    height: 12px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
  }

  /* Markdown Styles */
  .md {
    font-size: 13.5px;
    line-height: 1.75;
    color: var(--fg);
    max-width: 72ch;
  }
  .md :global(h1) {
    font-size: 19px;
    font-weight: 650;
    line-height: 1.35;
    margin: 20px 0 10px;
  }
  .md :global(h1:first-child) {
    margin-top: 0;
  }
  .md :global(h2) {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    margin: 18px 0 8px;
  }
  .md :global(h3) {
    font-size: 13.5px;
    font-weight: 600;
    margin: 14px 0 6px;
  }
  .md :global(p) {
    margin: 8px 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 8px 0;
    padding-left: 22px;
  }
  .md :global(li) {
    margin: 4px 0;
  }
  .md :global(strong) {
    font-weight: 600;
  }
  .md :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .md :global(pre) {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 12px 14px;
    margin: 10px 0;
    overflow-x: auto;
  }
  .md :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    line-height: 1.6;
  }
  .md :global(blockquote) {
    margin: 10px 0;
    padding: 2px 0 2px 12px;
    border-left: 2px solid var(--border-strong);
    color: var(--muted);
  }
  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 16px 0;
  }

  /* Scan bar & Deploy Plan & Translation Editor */
  .scan-bar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .scan-input {
    width: 280px;
    padding: 5px 10px;
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--fg);
  }
  .scan-input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .deploy-plan-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  .deploy-plan-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-size: 12.5px;
  }
  .deploy-plan-item.blocked {
    border-color: var(--warn);
    background: oklch(0.97 0.02 80);
  }
  .zh-editor {
    width: 100%;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    padding: 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface-2);
    color: var(--fg);
    resize: vertical;
  }
  .zh-editor:focus {
    border-color: var(--accent);
    outline: none;
  }

  @keyframes cardIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes pageIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
