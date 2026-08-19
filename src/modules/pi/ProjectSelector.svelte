<script lang="ts">
  import { invoke } from "../../platform/ipc";
  import { onMount, createEventDispatcher } from "svelte";
  import type { RecentProject } from "../../types";

  export let activeProjectPath: string | null = null;

  const dispatch = createEventDispatcher<{
    change: { path: string | null };
  }>();

  let recentList: RecentProject[] = [];
  let showDropdown = false;
  let errorMsg: string | null = null;
  let loading = false;

  async function loadProjects() {
    try {
      loading = true;
      errorMsg = null;
      activeProjectPath = await invoke<string | null>("project_get_active");
      recentList = await invoke<RecentProject[]>("project_recent_list");
    } catch (err: unknown) {
      errorMsg = String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadProjects();
  });

  async function handlePickDirectory() {
    try {
      errorMsg = null;
      const picked = await invoke<string | null>("project_pick_directory");
      if (picked && picked.trim()) {
        await invoke<RecentProject>("project_choose", { path: picked.trim() });
        await loadProjects();
        dispatch("change", { path: picked.trim() });
      }
    } catch (err: unknown) {
      errorMsg = `选择目录失败: ${String(err)}`;
    }
  }

  async function handleSelectRecent(proj: RecentProject) {
    try {
      errorMsg = null;
      await invoke("project_set_active", { path: proj.path });
      showDropdown = false;
      await loadProjects();
      dispatch("change", { path: proj.path });
    } catch (err: unknown) {
      errorMsg = `切换项目失败: ${String(err)}`;
    }
  }

  async function handleRemoveRecent(e: MouseEvent, proj: RecentProject) {
    e.stopPropagation();
    try {
      errorMsg = null;
      await invoke("project_remove", { path: proj.path });
      await loadProjects();
      if (activeProjectPath === proj.path) {
        dispatch("change", { path: null });
      }
    } catch (err: unknown) {
      errorMsg = `移除项目失败: ${String(err)}`;
    }
  }

  async function handleClearActive() {
    try {
      errorMsg = null;
      if (activeProjectPath) {
        await invoke("project_remove", { path: activeProjectPath });
        showDropdown = false;
        await loadProjects();
        dispatch("change", { path: null });
      }
    } catch (err: unknown) {
      errorMsg = `清除活动项目失败: ${String(err)}`;
    }
  }

  function toggleDropdown() {
    showDropdown = !showDropdown;
  }
</script>

<div class="project-selector">
  <div class="selector-bar">
    <div class="project-info" on:click={toggleDropdown} title="点击切换最近项目">
      <svg class="icon-folder" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M1.5 3.5A1.5 1.5 0 013 2h3.586a1 1 0 01.707.293L8.707 3.7a1 1 0 00.707.293H13A1.5 1.5 0 0114.5 5.5v7A1.5 1.5 0 0113 14H3a1.5 1.5 0 01-1.5-1.5v-9z" />
      </svg>
      <div class="project-text">
        <span class="label">当前工作目录:</span>
        <span class="path" title={activeProjectPath || "使用宿主默认工作区"}>
          {activeProjectPath ? activeProjectPath : "默认工作目录 (未指定)"}
        </span>
      </div>
      <svg class="icon-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>

    <button type="button" class="btn sm pick-btn" on:click={handlePickDirectory} title="选择本地文件夹">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M3 8h10M8 3v10" />
      </svg>
      选择目录
    </button>
  </div>

  {#if showDropdown}
    <div class="dropdown-overlay" on:click={() => showDropdown = false}></div>
    <div class="project-dropdown">
      <div class="dropdown-header">
        <span>最近打开的工作目录 ({recentList.length})</span>
        {#if activeProjectPath}
          <button type="button" class="btn text-btn sm" on:click={handleClearActive}>清除选定</button>
        {/if}
      </div>

      {#if recentList.length === 0}
        <div class="dropdown-empty">暂无历史工作目录，点击「选择目录」开始。</div>
      {:else}
        <div class="dropdown-list">
          {#each recentList as proj}
            <div
              class="dropdown-item"
              class:active={proj.path === activeProjectPath}
              on:click={() => handleSelectRecent(proj)}
            >
              <div class="item-main">
                <span class="item-name">{proj.display_name}</span>
                <span class="item-path" title={proj.path}>{proj.path}</span>
              </div>
              <button
                type="button"
                class="item-del"
                title="从历史记录移除"
                on:click={(e) => handleRemoveRecent(e, proj)}
              >
                ×
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if errorMsg}
    <div class="tag err" style="margin-top: 4px; font-size: 11px;">{errorMsg}</div>
  {/if}
</div>

<style>
  .project-selector {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    z-index: 50;
  }
  .selector-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-card, #1e1e24);
    border: 1px solid var(--border-subtle, #33333d);
    border-radius: 6px;
    padding: 3px 6px 3px 10px;
  }
  .project-info {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    user-select: none;
    max-width: 380px;
  }
  .icon-folder {
    width: 14px;
    height: 14px;
    color: var(--accent, #6366f1);
    flex-shrink: 0;
  }
  .icon-chevron {
    width: 12px;
    height: 12px;
    color: var(--text-faint, #888);
    flex-shrink: 0;
    margin-left: 2px;
  }
  .project-text {
    display: flex;
    align-items: baseline;
    gap: 6px;
    overflow: hidden;
  }
  .label {
    font-size: 11.5px;
    color: var(--text-faint, #8e8e99);
    white-space: nowrap;
  }
  .path {
    font-size: 12px;
    font-family: var(--font-mono, monospace);
    color: var(--text-normal, #e4e4e7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .pick-btn {
    padding: 3px 8px;
    font-size: 11.5px;
    height: 24px;
  }
  .dropdown-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 55;
  }
  .project-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 420px;
    background: var(--bg-surface, #18181b);
    border: 1px solid var(--border-normal, #3f3f46);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 60;
    overflow: hidden;
  }
  .dropdown-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle, #27272a);
    font-size: 11.5px;
    color: var(--text-muted, #a1a1aa);
  }
  .text-btn {
    background: transparent;
    border: none;
    color: var(--danger, #ef4444);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 11px;
  }
  .dropdown-empty {
    padding: 16px 12px;
    font-size: 12px;
    color: var(--text-faint, #71717a);
    text-align: center;
  }
  .dropdown-list {
    max-height: 240px;
    overflow-y: auto;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--border-subtle, #27272a);
    transition: background 0.15s;
  }
  .dropdown-item:last-child {
    border-bottom: none;
  }
  .dropdown-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .dropdown-item.active {
    background: rgba(99, 102, 241, 0.15);
    border-left: 3px solid var(--accent, #6366f1);
  }
  .item-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
    flex: 1;
  }
  .item-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-normal, #fafafa);
  }
  .item-path {
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    color: var(--text-faint, #71717a);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-del {
    background: transparent;
    border: none;
    color: var(--text-faint, #71717a);
    font-size: 14px;
    padding: 2px 6px;
    cursor: pointer;
    border-radius: 4px;
  }
  .item-del:hover {
    color: var(--danger, #ef4444);
    background: rgba(239, 68, 68, 0.1);
  }
</style>
