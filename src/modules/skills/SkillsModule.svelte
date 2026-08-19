<script lang="ts">
  import { onMount } from "svelte";
  import type { DiscoveredHost, GithubAuthStatus, QuarantineItem, SkillItem } from "../../types";
  import { skillsApi } from "./api";
  import GithubAuthModal from "./components/GithubAuthModal.svelte";
  import SkillList from "./components/SkillList.svelte";
  import SkillDetail from "./components/SkillDetail.svelte";
  import QuarantinePanel from "./components/QuarantinePanel.svelte";

  export let activeTool: string = "all";
  export let discoveredHosts: DiscoveredHost[] = [];
  export let skills: SkillItem[] = [];
  export let onRefresh: () => Promise<void>;

  let currentSkill: SkillItem | null = null;
  let sourceTab: "local" | "github" | "quarantine" = "local";

  let scanRepoPath = "";
  let isScanningRepo = false;
  let scanMsg = "";
  let scanError = false;

  let githubRepo = "anthropics/skills";
  let githubRef = "HEAD";
  let githubSubpath = "";
  let isScanningGithub = false;
  let githubMsg = "";
  let githubError = false;
  let showGithubModal = false;
  let authStatus: GithubAuthStatus = { has_token: false, source: "" };

  let quarantineItems: QuarantineItem[] = [];
  let isLoadingQuarantine = false;
  let quarantineMsg = "";
  let quarantineError = false;

  $: filteredSkills =
    activeTool === "all"
      ? skills
      : skills.filter((s) => s.tools.some((t) => t.toLowerCase() === activeTool.toLowerCase()));

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

  async function checkGithubAuth() {
    try {
      authStatus = await skillsApi.githubTokenStatus();
    } catch {
      authStatus = { has_token: false, source: "" };
    }
  }

  async function loadQuarantine() {
    try {
      isLoadingQuarantine = true;
      quarantineError = false;
      quarantineMsg = "";
      quarantineItems = await skillsApi.quarantineList();
    } catch (e: unknown) {
      quarantineError = true;
      quarantineMsg = `读取隔离区失败: ${errText(e)}`;
    } finally {
      isLoadingQuarantine = false;
    }
  }

  onMount(() => {
    checkGithubAuth();
    if (sourceTab === "quarantine") {
      loadQuarantine();
    }
  });

  $: if (sourceTab === "quarantine") {
    loadQuarantine();
  }

  export async function openSkillById(id: string) {
    const s = skills.find((x) => x.id === id);
    if (s) currentSkill = s;
  }

  async function handleScanRepo() {
    if (isScanningRepo) return;
    isScanningRepo = true;
    scanError = false;
    scanMsg = "正在扫描本地仓库技能...";
    try {
      const group = await skillsApi.scanRepo(scanRepoPath.trim() ? scanRepoPath.trim() : null, null);
      if (group && group.skills) {
        scanMsg = `扫描完成：在 ${group.repo_name} 中发现 ${group.skills.length} 个 Skill 并已存入快照！`;
        await onRefresh();
      }
    } catch (e: unknown) {
      scanError = true;
      scanMsg = `扫描失败: ${errText(e)}`;
    } finally {
      isScanningRepo = false;
    }
  }

  async function handleScanGithub() {
    if (isScanningGithub) return;
    if (!githubRepo.trim()) {
      githubError = true;
      githubMsg = "请输入有效的 GitHub 仓库 (例如 anthropics/skills)";
      return;
    }
    isScanningGithub = true;
    githubError = false;
    githubMsg = `正在从 GitHub 下载并扫描 ${githubRepo.trim()}...`;
    try {
      const group = await skillsApi.scanGithub(
        githubRepo.trim(),
        githubRef.trim() ? githubRef.trim() : null,
        githubSubpath.trim() ? githubSubpath.trim() : null,
      );
      if (group && group.skills) {
        githubMsg = `GitHub 扫描成功：在 ${group.repo_name} 中提取并快照了 ${group.skills.length} 个 Skill！`;
        await onRefresh();
      }
    } catch (e: unknown) {
      githubError = true;
      githubMsg = `GitHub 扫描失败: ${errText(e)}`;
    } finally {
      isScanningGithub = false;
    }
  }

  async function handleDeleteQuarantine(quarantineId: string) {
    if (!confirm(`确定彻底删除隔离记录 ${quarantineId} 及其磁盘文件吗？该操作不可撤销。`)) {
      return;
    }
    try {
      quarantineError = false;
      await skillsApi.quarantineDelete(quarantineId);
      quarantineMsg = `已永久删除隔离项: ${quarantineId}`;
      await loadQuarantine();
    } catch (e: unknown) {
      quarantineError = true;
      quarantineMsg = `删除失败: ${errText(e)}`;
    }
  }
</script>

<div class="view-skills-wrap">
  {#if !currentSkill}
    <div class="view-scroll">
      <div class="page-head">
        <div>
          <h1>Skills-Hub</h1>
          <p class="desc">各个 AI 工具里安装的 skill，点左侧工具名筛选，点卡片查看详情与批量部署</p>
        </div>
        <div class="seg">
          <button type="button" class:on={sourceTab === "local"} on:click={() => (sourceTab = "local")}>
            本地目录
          </button>
          <button type="button" class:on={sourceTab === "github"} on:click={() => (sourceTab = "github")}>
            GitHub 仓库
          </button>
          <button type="button" class:on={sourceTab === "quarantine"} on:click={() => (sourceTab = "quarantine")}>
            安全隔离区 ({quarantineItems.length})
          </button>
        </div>
      </div>

      <div class="source-panel">
        {#if sourceTab === "local"}
          <div class="panel-row">
            <div class="scan-bar">
              <input
                type="text"
                class="scan-input"
                placeholder="本地仓库绝对路径（留空使用 staging/repo）"
                bind:value={scanRepoPath}
              />
              <button type="button" class="btn primary sm" disabled={isScanningRepo} on:click={handleScanRepo}>
                {isScanningRepo ? "扫描中..." : "扫描本地仓库"}
              </button>
            </div>
          </div>
        {:else if sourceTab === "github"}
          <div class="panel-row github-row">
            <div class="gh-inputs">
              <input
                type="text"
                class="scan-input gh-repo"
                placeholder="GitHub 仓库 (例如: anthropics/skills)"
                bind:value={githubRepo}
              />
              <input
                type="text"
                class="scan-input gh-ref"
                placeholder="分支/Commit (默认 HEAD)"
                bind:value={githubRef}
              />
              <input
                type="text"
                class="scan-input gh-subpath"
                placeholder="子路径 (可选)"
                bind:value={githubSubpath}
              />
              <button type="button" class="btn primary sm" disabled={isScanningGithub} on:click={handleScanGithub}>
                {isScanningGithub ? "下载并扫描中..." : "扫描 GitHub 仓库"}
              </button>
            </div>
            <div class="gh-auth-bar">
              {#if authStatus.has_token}
                <span class="tag ok sm" title="已配置 Windows 凭据管理器授权">GitHub 已授权</span>
              {:else}
                <span class="tag neutral sm" title="未连接时仅支持公开仓库">未授权 (仅公开)</span>
              {/if}
              <button type="button" class="btn sm" on:click={() => (showGithubModal = true)}>
                {authStatus.has_token ? "凭据管理" : "连接 GitHub (私有库)"}
              </button>
            </div>
          </div>
        {/if}
      </div>

      {#if scanMsg && sourceTab === "local"}
        <div class="banner"><div class="tag {scanError ? 'err' : 'info'}">{scanMsg}</div></div>
      {/if}
      {#if githubMsg && sourceTab === "github"}
        <div class="banner"><div class="tag {githubError ? 'err' : 'info'}">{githubMsg}</div></div>
      {/if}

      <div class="page-body">
        {#if sourceTab === "quarantine"}
          <QuarantinePanel
            items={quarantineItems}
            loading={isLoadingQuarantine}
            message={quarantineMsg}
            isError={quarantineError}
            onRefresh={loadQuarantine}
            onDelete={handleDeleteQuarantine}
          />
        {:else}
          <SkillList skills={filteredSkills} onOpen={openSkillById} />
        {/if}
      </div>
    </div>
  {:else}
    <SkillDetail
      skill={currentSkill}
      {discoveredHosts}
      onBack={() => (currentSkill = null)}
      {onRefresh}
    />
  {/if}

  <GithubAuthModal
    bind:show={showGithubModal}
    on:close={() => (showGithubModal = false)}
    on:authenticated={checkGithubAuth}
  />
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
  .banner {
    padding: 10px 28px 0;
  }
  .seg {
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
  .source-panel {
    padding: 12px 28px 0;
  }
  .panel-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .github-row {
    justify-content: space-between;
  }
  .scan-bar,
  .gh-inputs,
  .gh-auth-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
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
  .gh-repo {
    width: 220px;
  }
  .gh-ref {
    width: 140px;
  }
  .gh-subpath {
    width: 120px;
  }
</style>
