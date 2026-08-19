<script lang="ts">
  import { renderMarkdown } from "../../../platform/markdown";
  import type {
    DiscoveredHost,
    DeploymentPlan,
    DeploymentTarget,
    SkillItem,
    SnapshotDiff,
    TranslationDoc,
  } from "../../../types";
  import { skillsApi } from "../api";
  import DeployPlan from "./DeployPlan.svelte";

  export let skill: SkillItem;
  export let discoveredHosts: DiscoveredHost[] = [];
  export let onBack: () => void;
  export let onRefresh: () => Promise<void>;

  let docLang: "zh" | "en" = "zh";
  let isPlanningDeploy = false;
  let deployPlan: DeploymentPlan | null = null;
  let deployResultMsg = "";
  let deployIsError = false;
  let applyingDeploy = false;
  let isDiffing = false;
  let diffData: SnapshotDiff | null = null;
  let diffMsg = "";
  let isEditingZh = false;
  let editZhBody = "";
  let isSavingZh = false;
  let saveZhMsg = "";
  let transError = "";
  let loadedFor = "";

  $: if (skill && skill.id + skill.snapshot_id !== loadedFor) {
    resetForSkill(skill);
  }

  function errText(e: unknown): string {
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
      return (e as { message: string }).message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

  async function resetForSkill(s: SkillItem) {
    loadedFor = s.id + s.snapshot_id;
    docLang = "zh";
    editZhBody = s.zh;
    isEditingZh = false;
    saveZhMsg = "";
    transError = "";
    diffData = null;
    diffMsg = "";
    deployPlan = null;
    deployResultMsg = "";
    try {
      const trans = await skillsApi.getTranslation(s.skill_name || s.id, s.snapshot_id || null);
      if (trans && trans.markdown_body) {
        s.zh = trans.markdown_body;
        editZhBody = trans.markdown_body;
      }
    } catch (err: unknown) {
      transError = `读取派生说明异常: ${errText(err)}`;
    }
  }

  async function handlePlanDeployment() {
    if (!skill.snapshot_id) {
      deployIsError = true;
      deployResultMsg = "当前技能快照 ID 缺失，无法生成部署计划。";
      return;
    }
    isPlanningDeploy = true;
    deployResultMsg = "";
    deployIsError = false;
    try {
      const availableHosts = discoveredHosts.filter(
        (h) => h.installed || h.discovered_scopes.some((sc) => sc.exists),
      );
      if (availableHosts.length === 0) {
        deployIsError = true;
        deployResultMsg = "当前未检测到任何已安装的宿主工具（如 Pi、Cursor、DSH 等）。请先确认宿主环境再生成计划。";
        return;
      }
      for (const h of availableHosts) {
        if (!h.profile.profile_version) {
          deployIsError = true;
          deployResultMsg = `宿主 ${h.profile.id} 缺少版本信息 (profile_version)，无法生成合规部署计划。`;
          return;
        }
      }
      const targets: DeploymentTarget[] = availableHosts.map((h) => ({
        host: h.profile.id,
        host_version: h.profile.profile_version,
        scope: "user",
        path: "",
      }));
      deployPlan = await skillsApi.batchDeployPlan(skill.snapshot_id, targets);
    } catch (e: unknown) {
      deployIsError = true;
      deployResultMsg = `生成部署计划失败: ${errText(e)}`;
    } finally {
      isPlanningDeploy = false;
    }
  }

  async function handleApplyDeployment() {
    if (!deployPlan) return;
    applyingDeploy = true;
    deployIsError = false;
    try {
      for (const it of deployPlan.items) {
        if (!it.host_version) {
          deployIsError = true;
          deployResultMsg = `部署计划项 ${it.host_id} 缺少宿主版本信息，无法执行部署。`;
          return;
        }
      }
      const targets: DeploymentTarget[] = deployPlan.items.map((it) => ({
        host: it.host_id,
        host_version: it.host_version!,
        scope: it.scope_kind,
        path: it.target_path,
      }));
      const res = await skillsApi.batchDeployApply(deployPlan.snapshot_id, targets);
      if (res.success) {
        deployResultMsg = `部署成功！已写入 ${res.deployed_count} 个目标工具目录并记录 Evidence 链。`;
      } else {
        deployIsError = true;
        deployResultMsg = `部署失败，已触发补偿回滚：${res.error}`;
      }
      await onRefresh();
    } catch (e: unknown) {
      deployIsError = true;
      deployResultMsg = `应用部署失败: ${errText(e)}`;
    } finally {
      applyingDeploy = false;
    }
  }

  async function handleGetDiff() {
    if (!skill.snapshot_id || isDiffing) return;
    if (!skill.previous_snapshot_id) {
      diffMsg = "当前为该技能初始快照，暂无更早历史版本可对比。";
      return;
    }
    isDiffing = true;
    diffMsg = "正在生成与上一历史快照的 Diff...";
    diffData = null;
    try {
      diffData = await skillsApi.getDiff(skill.previous_snapshot_id, skill.snapshot_id);
      diffMsg = `Diff 就绪：${diffData.added_files.length} 个新增，${diffData.modified_files.length} 个修改，${diffData.deleted_files.length} 个删除，${diffData.identical_files.length} 个一致。`;
    } catch (e: unknown) {
      diffMsg = `获取 Diff 失败: ${errText(e)}`;
    } finally {
      isDiffing = false;
    }
  }

  async function handleSaveZh() {
    isSavingZh = true;
    saveZhMsg = "";
    try {
      const doc: TranslationDoc = {
        skill_name: skill.id,
        snapshot_id: skill.snapshot_id || "default",
        purpose: skill.desc,
        applicable_tasks: "通用任务",
        target_tools: skill.tools,
        prerequisites: "无特殊前置依赖",
        risks: "标准权限",
        author: "workbench",
        updated_at: new Date().toISOString(),
        markdown_body: editZhBody,
        is_stale: false,
      };
      await skillsApi.saveTranslation(doc);
      skill.zh = editZhBody;
      isEditingZh = false;
      saveZhMsg = "已成功保存中文说明！";
    } catch (e: unknown) {
      saveZhMsg = `保存失败: ${errText(e)}`;
    } finally {
      isSavingZh = false;
    }
  }
</script>

<div class="skill-page">
  <div class="sp-top">
    <button type="button" class="sp-back" on:click={onBack}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M10 3L5 8l5 5" />
      </svg>
      <span>返回</span>
    </button>

    <div class="sp-title">
      <div class="sp-name">{skill.skill_name || skill.id}</div>
      <div class="sp-meta">
        {#if skill.tools && skill.tools.length > 0}
          可用于 {skill.tools.join("、")} ·
        {/if}
        快照 ID: <code>{skill.snapshot_id}</code>
      </div>
    </div>

    <div class="sp-actions">
      {#if skill.previous_snapshot_id}
        <button type="button" class="btn sm" disabled={isDiffing} on:click={handleGetDiff}>
          {isDiffing ? "Diff 计算中..." : "对比历史快照 Diff"}
        </button>
      {:else}
        <button type="button" class="btn sm" disabled title="当前为初始快照，暂无更早历史版本可对比">
          无历史快照 Diff
        </button>
      {/if}

      <button type="button" class="btn sm primary" disabled={isPlanningDeploy} on:click={handlePlanDeployment}>
        {isPlanningDeploy ? "计算计划中..." : "批量部署到宿主"}
      </button>

      <div class="seg">
        <button type="button" class:on={docLang === "zh"} on:click={() => { docLang = "zh"; isEditingZh = false; }}>
          中文说明
        </button>
        <button type="button" class:on={docLang === "en"} on:click={() => { docLang = "en"; isEditingZh = false; }}>
          原文
        </button>
      </div>
    </div>
  </div>

  {#if transError}
    <div class="banner"><div class="tag err">{transError}</div></div>
  {/if}
  {#if deployResultMsg}
    <div class="banner"><div class="tag {deployIsError ? 'err' : 'info'}">{deployResultMsg}</div></div>
  {/if}
  {#if diffMsg}
    <div class="banner"><div class="tag info">{diffMsg}</div></div>
  {/if}

  <div class="view-scroll">
    <div class="page-body sp-body">
      {#if deployPlan}
        <DeployPlan
          plan={deployPlan}
          applying={applyingDeploy}
          onClose={() => (deployPlan = null)}
          onApply={handleApplyDeployment}
        />
      {/if}

      {#if diffData}
        <section class="card sp-block">
          <div class="sp-block-h">
            <span>
              快照文件清单与差异 ({diffData.identical_files.length + diffData.added_files.length + diffData.modified_files.length} 个文件)
            </span>
            <button type="button" class="btn sm" on:click={() => (diffData = null)}>关闭 Diff</button>
          </div>
          <div class="diff-list">
            {#each diffData.identical_files as f (f)}
              <div class="diff-row muted">[=] {f}</div>
            {/each}
            {#each diffData.added_files as f (f)}
              <div class="diff-row added">[+] {f}</div>
            {/each}
            {#each diffData.modified_files as f (f)}
              <div class="diff-row modified">[~] {f}</div>
            {/each}
          </div>
        </section>
      {/if}

      <section class="card sp-block">
        <div class="sp-block-h">作用</div>
        <p class="sp-purpose-text">{skill.desc}</p>
        <div class="sp-chips">
          {#each skill.tools as tool}
            <span class="sc-tool">{tool}</span>
          {/each}
        </div>
      </section>

      {#if skill.flow && skill.flow.length > 0}
        <section class="card sp-block">
          <div class="sp-block-h">流程</div>
          <div class="flow">
            {#each skill.flow as step, i}
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
            <div class="zh-actions">
              {#if !isEditingZh}
                <button type="button" class="btn sm" on:click={() => (isEditingZh = true)}>编辑中文说明</button>
              {:else}
                <button type="button" class="btn sm" on:click={() => (isEditingZh = false)}>取消</button>
                <button type="button" class="btn sm primary" disabled={isSavingZh} on:click={handleSaveZh}>
                  {isSavingZh ? "保存中..." : "保存说明"}
                </button>
              {/if}
            </div>
          {/if}
        </div>

        {#if saveZhMsg}
          <div class="tag info save-msg">{saveZhMsg}</div>
        {/if}

        {#if isEditingZh && docLang === "zh"}
          <textarea class="zh-editor" bind:value={editZhBody} rows="14" aria-label="中文说明编辑"></textarea>
        {:else if docLang === "zh" && !skill.zh}
          <div class="no-zh">暂无派生中文说明。点击右上角“编辑中文说明”可为此技能创建专属中文说明。</div>
        {:else}
          <div class="md">
            {@html renderMarkdown(docLang === "zh" ? skill.zh : skill.original)}
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
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
  .sp-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .seg {
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
  .banner {
    padding: 10px 28px 0;
  }
  .view-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .page-body {
    padding: 16px 28px 32px;
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
  .zh-actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
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
  .sc-tool {
    font-size: 10.5px;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 4px;
    padding: 1px 6px;
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
  .diff-list {
    font-size: 12px;
    font-family: var(--font-mono);
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 240px;
    overflow-y: auto;
  }
  .diff-row {
    padding: 2px 6px;
    border-radius: var(--r-sm);
  }
  .diff-row.muted {
    color: var(--muted);
    background: var(--surface-2);
  }
  .diff-row.added {
    color: var(--success);
    background: oklch(0.96 0.05 152);
  }
  .diff-row.modified {
    color: var(--warn);
    background: oklch(0.96 0.05 78);
  }
  .save-msg {
    margin-bottom: 10px;
  }
  .no-zh {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    font-size: 12.5px;
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
