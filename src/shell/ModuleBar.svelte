<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "../platform/ipc";
  import type { ViewId } from "../types";
  import PiProjectTree from "../modules/pi/components/PiProjectTree.svelte";
  import { piConsoleStore } from "../modules/pi/store";
  import {
    getHostRuntimeFacts,
    piProjectBlocksChange,
  } from "../platform/runtimeStatus";
  import {
    clampSidebarWidth,
    clampSkillsSidebarWidth,
    isEditableTarget,
    isSidebarVisible,
    loadPiSidebarHidden,
    loadPiSidebarWidth,
    loadSkillsSidebarHidden,
    loadSkillsSidebarWidth,
    PI_SIDEBAR_DEFAULT,
    PI_SIDEBAR_MAX,
    PI_SIDEBAR_MIN,
    savePiSidebarHidden,
    savePiSidebarWidth,
    saveSkillsSidebarHidden,
    saveSkillsSidebarWidth,
    SKILLS_SIDEBAR_DEFAULT,
    SKILLS_SIDEBAR_MAX,
    SKILLS_SIDEBAR_MIN,
  } from "./sidebarPreferences";

  export let activeView: ViewId = "pi";
  export let activeTool: string = "all";
  export let tools: string[] = [];
  export let skillCountsByTool: Record<string, number> = {};
  export let totalSkillsCount: number = 0;
  export let onSelectTool: (tool: string) => void;
  export let onProjectChange: (() => Promise<void>) | undefined = undefined;

  let isDragging = false;
  let sidebarEl: HTMLElement;
  let piWidth = PI_SIDEBAR_DEFAULT;
  let skillsWidth = SKILLS_SIDEBAR_DEFAULT;
  let piHidden = false;
  let skillsHidden = false;

  $: isSkills = activeView === "skills";
  $: isPi = activeView === "pi";
  $: noSidebar = !isSidebarVisible(activeView, piHidden, skillsHidden);
  $: currentWidth = isPi ? piWidth : skillsWidth;

  onMount(() => {
    piWidth = loadPiSidebarWidth();
    skillsWidth = loadSkillsSidebarWidth();
    piHidden = loadPiSidebarHidden();
    skillsHidden = loadSkillsSidebarHidden();
    if (isPi) {
      piConsoleStore.refreshTree().catch((err) => {
        console.debug("Pi tree refresh failed:", err);
      });
    }
  });

  function handleResizeStart(e: PointerEvent) {
    e.preventDefault();
    isDragging = true;
    const startX = e.clientX;
    const startW = currentWidth;
    const min = isPi ? PI_SIDEBAR_MIN : SKILLS_SIDEBAR_MIN;
    const max = isPi ? PI_SIDEBAR_MAX : SKILLS_SIDEBAR_MAX;

    function onMove(ev: PointerEvent) {
      const w = Math.min(max, Math.max(min, startW + ev.clientX - startX));
      if (isPi) {
        piWidth = clampSidebarWidth(w);
      } else {
        skillsWidth = clampSkillsSidebarWidth(w);
      }
    }

    function onUp() {
      isDragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (isPi) {
        piWidth = savePiSidebarWidth(piWidth);
      } else {
        skillsWidth = saveSkillsSidebarWidth(skillsWidth);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function adjustWidth(delta: number) {
    if (isPi) {
      piWidth = savePiSidebarWidth(piWidth + delta);
      return;
    }
    skillsWidth = saveSkillsSidebarWidth(skillsWidth + delta);
  }

  function restoreSidebar() {
    if (isPi) {
      piHidden = savePiSidebarHidden(false);
    } else if (isSkills) {
      skillsHidden = saveSkillsSidebarHidden(false);
    }
  }

  function handleGlobalKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b") return;
    if (isEditableTarget(e.target)) return;
    if (isPi) {
      e.preventDefault();
      piHidden = savePiSidebarHidden(!piHidden);
    } else if (isSkills) {
      e.preventDefault();
      skillsHidden = saveSkillsSidebarHidden(!skillsHidden);
    }
    // dsh: 无 Sidebar，Ctrl+B 不消费事件，也不写任何 preference。
  }

  async function openProjectPicker() {
    let next = "";
    try {
      const picked = await invoke<string | null>("project_pick_directory");
      if (!picked?.trim()) return;
      next = picked.trim();
      await piConsoleStore.refreshRuntime();
      const blocked = piProjectBlocksChange(getHostRuntimeFacts(), next);
      if (blocked) {
        piConsoleStore.offerProjectBlock(next, blocked);
        return;
      }
      await invoke("project_choose", { path: next });
      await piConsoleStore.refreshTree();
      await piConsoleStore.refreshRuntime();
      await onProjectChange?.();
    } catch (err) {
      piConsoleStore.reportProjectChooseError(err, next);
    }
  }
</script>

<svelte:window on:keydown={handleGlobalKey} />

{#if !noSidebar}
  <aside
    class="sidebar"
    class:slim={isSkills}
    style="width: {currentWidth}px;"
    bind:this={sidebarEl}
  >
    <div class="side-scroll">
      {#if isPi}
        <PiProjectTree
          projects={$piConsoleStore.tree}
          error={$piConsoleStore.error}
          treeStatus={$piConsoleStore.treeStatus}
          openProjectPicker={openProjectPicker}
          createSession={(path) => piConsoleStore.createSession(path)}
          openSession={(path, id) => piConsoleStore.openSession(path, id)}
          removeFromIndex={(id) => piConsoleStore.removeIndexedSession(id)}
          archiveSession={(id, archived) =>
            piConsoleStore.archiveSession(id, archived)
          }
          removeProject={(path) => piConsoleStore.removeProject(path)}
          activeProjectPath={$piConsoleStore.active?.projectPath ?? null}
        />
      {:else if isSkills}
        <div id="side-tools">
          <div class="side-section">工具</div>
          <div class="nav-group">
            <button
              type="button"
              class="tool-item"
              class:on={activeTool === "all"}
              on:click={() => onSelectTool("all")}
            >
              <span class="t-name">全部工具</span>
              <span class="count">{totalSkillsCount}</span>
            </button>
            {#each tools as tool (tool)}
              {@const cnt = skillCountsByTool[tool] || 0}
              <button
                type="button"
                class="tool-item"
                class:on={activeTool === tool}
                on:click={() => onSelectTool(tool)}
              >
                <span class="t-name">{tool}</span>
                <span class="count">{cnt || ""}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </aside>

  <button
    type="button"
    class="side-resize"
    class:dragging={isDragging}
    title="拖拽或用方向键调整侧边栏宽度"
    aria-label="调整侧边栏宽度"
    on:pointerdown={handleResizeStart}
    on:keydown={(e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        adjustWidth(-10);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        adjustWidth(10);
      }
    }}
  ></button>
{:else if isPi || isSkills}
  <button
    type="button"
    class="sidebar-restore"
    aria-label="显示侧栏"
    title="显示侧栏（Ctrl+B）"
    on:click={restoreSidebar}
  >
    显示侧栏
  </button>
{/if}

<style>
  .sidebar {
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--surface-2);
    border-right: 1px solid var(--border);
    padding: 8px;
    user-select: none;
    min-height: 0;
    overflow-x: hidden;
  }
  .sidebar.slim {
    padding: 8px 6px;
  }
  .sidebar.slim .side-section {
    padding: 0 8px 4px;
  }
  .sidebar.slim .tool-item {
    padding: 6px 8px;
    font-size: 12px;
  }
  .nav-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .side-section {
    margin-top: 18px;
    padding: 0 10px 4px;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--faint);
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tool-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    color: var(--muted);
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
  }
  .tool-item:hover {
    background: var(--border);
    color: var(--fg);
  }
  .tool-item.on {
    background: var(--surface);
    color: var(--fg);
    box-shadow: var(--shadow-1);
    font-weight: 550;
  }
  .tool-item .count {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--faint);
  }
  .tool-item .t-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }
  .side-resize {
    width: 6px;
    flex: none;
    cursor: col-resize;
    margin-left: -3px;
    position: relative;
    z-index: 6;
    touch-action: none;
  }
  .side-resize::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: transparent;
    transition: background 0.12s ease;
  }
  .side-resize:hover::after,
  .side-resize.dragging::after,
  .side-resize:focus-visible::after {
    background: var(--faint);
  }
  .sidebar-restore {
    flex: none;
    width: 28px;
    min-height: 0;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--muted);
    background: var(--surface-2);
    border-right: 1px solid var(--border);
    padding: 10px 4px;
    cursor: pointer;
  }
  .sidebar-restore:hover {
    color: var(--fg);
    background: var(--border);
  }
</style>
