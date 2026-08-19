<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { ViewId } from "../types";
  import ProjectSelector from "./ProjectSelector.svelte";
  import PiProjectTree from "./pi/PiProjectTree.svelte";
  import { piConsoleStore } from "../lib/pi/piConsoleStore";
  import {
    clampSidebarWidth,
    isEditableTarget,
    loadPiSidebarHidden,
    loadPiSidebarWidth,
    PI_SIDEBAR_DEFAULT,
    PI_SIDEBAR_MAX,
    PI_SIDEBAR_MIN,
    savePiSidebarHidden,
    savePiSidebarWidth,
  } from "../lib/layout/sidebarPreferences";

  export let activeView: ViewId = "home";
  export let activeTool: string = "all";
  export let tools: string[] = [];
  export let skillCountsByTool: Record<string, number> = {};
  export let totalSkillsCount: number = 0;
  export let onSelectView: (id: ViewId) => void;
  export let onSelectTool: (tool: string) => void;
  export let onProjectChange: (() => Promise<void>) | undefined = undefined;

  let sideWidths = { full: 248, slim: 176 };
  let isDragging = false;
  let sidebarEl: HTMLElement;
  let piWidth = PI_SIDEBAR_DEFAULT;
  let piHidden = false;

  $: isSkills = activeView === "skills";
  $: isPi = activeView === "pi";
  $: noSidebar = activeView === "dsh" || activeView === "home" || (isPi && piHidden);
  $: currentWidth = isPi ? piWidth : isSkills ? sideWidths.slim : sideWidths.full;

  onMount(() => {
    try {
      const rawW = localStorage.getItem("aster.sideWidths");
      if (rawW) {
        const pw = JSON.parse(rawW);
        if (pw && typeof pw === "object") {
          if (pw.full) sideWidths.full = pw.full;
          if (pw.slim) sideWidths.slim = pw.slim;
        }
      }
    } catch (e) {
      console.debug("Failed to read stored sideWidths:", e);
    }
    piWidth = loadPiSidebarWidth();
    piHidden = loadPiSidebarHidden();
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
    const min = isPi ? PI_SIDEBAR_MIN : isSkills ? 140 : 200;
    const max = isPi ? PI_SIDEBAR_MAX : isSkills ? 300 : 420;
    const mode = isSkills ? "slim" : "full";

    function onMove(ev: PointerEvent) {
      const w = Math.min(max, Math.max(min, startW + ev.clientX - startX));
      if (isPi) {
        piWidth = clampSidebarWidth(w);
      } else {
        sideWidths[mode] = Math.round(w);
      }
    }

    function onUp() {
      isDragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (isPi) {
        piWidth = savePiSidebarWidth(piWidth);
      } else {
        try {
          localStorage.setItem("aster.sideWidths", JSON.stringify(sideWidths));
        } catch (err) {
          console.debug("Failed to save sideWidths:", err);
        }
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
    const mode = isSkills ? "slim" : "full";
    const min = isSkills ? 140 : 200;
    const max = isSkills ? 300 : 420;
    sideWidths[mode] = Math.min(max, Math.max(min, sideWidths[mode] + delta));
    try {
      localStorage.setItem("aster.sideWidths", JSON.stringify(sideWidths));
    } catch (err) {
      console.debug("Failed to save sideWidths:", err);
    }
  }

  function handleGlobalKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b") return;
    if (!isPi) return;
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    piHidden = savePiSidebarHidden(!piHidden);
  }

  async function openProjectPicker() {
    try {
      const picked = await invoke<string | null>("project_pick_directory");
      if (picked && picked.trim()) {
        await invoke("project_choose", { path: picked.trim() });
        await piConsoleStore.refreshTree();
        await onProjectChange?.();
      }
    } catch (err) {
      piConsoleStore.reportError(err);
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
        />
      {:else if !isSkills}
        <div class="nav-group" id="side-nav">
          <button type="button" class="nav-item" class:active={activeView === "pi"} on:click={() => onSelectView("pi")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4" />
            </svg>
            <span>Pi 工作台</span>
          </button>

          <button
            type="button"
            class="nav-item"
            class:active={activeView === "agents"}
            on:click={() => onSelectView("agents")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <circle cx="8" cy="5" r="2.6" />
              <path d="M2.8 13.5c.6-2.6 2.7-4 5.2-4s4.6 1.4 5.2 4" />
            </svg>
            <span>智能体与宿主</span>
          </button>

          <button
            type="button"
            class="nav-item"
            class:active={activeView === "infra"}
            on:click={() => onSelectView("infra")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M2.5 12.5h11M4 12.5v-7M8 12.5v-4M12 12.5V3.5" />
            </svg>
            <span>基础设施与证据</span>
          </button>
        </div>

        <div id="side-default">
          <div class="side-section">工作目录</div>
          <div style="padding: 2px 2px 6px;">
            <ProjectSelector on:change={() => onProjectChange?.()} />
          </div>

          <div class="side-section">工作区</div>
          <div class="nav-group">
            <button type="button" class="proj-item current" on:click={() => onSelectView("home")}>
              <svg class="folder-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
                <path d="M2 4.5A1.5 1.5 0 013.5 3h2L7 4.5h5.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" />
              </svg>
              <span>工作台主页</span>
            </button>
          </div>
        </div>
      {:else}
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

    {#if !isPi}
      <div class="side-foot">
        <button type="button" class="settings-btn" aria-label="设置" on:click={() => onSelectView("infra")}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.7 3.7l1.3 1.3M11 11l1.3 1.3M12.3 3.7L11 5M5 11l-1.3 1.3" />
          </svg>
        </button>
      </div>
    {/if}
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
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    font-size: 13px;
    color: var(--fg);
    text-align: left;
    width: 100%;
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
  }
  .nav-item svg {
    width: 15px;
    height: 15px;
    flex: none;
    color: var(--muted);
  }
  .nav-item:hover {
    background: var(--border);
  }
  .nav-item.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    font-weight: 550;
  }
  .nav-item.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 2.5px;
    border-radius: 2px;
    background: var(--fg);
  }
  .nav-item.active svg {
    color: var(--fg);
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
  .proj-item {
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
  .proj-item:hover {
    background: var(--border);
    color: var(--fg);
  }
  .proj-item.current {
    color: var(--fg);
    font-weight: 550;
  }
  .proj-item .folder-ic {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--faint);
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
  .side-foot {
    flex: none;
    border-top: 1px solid var(--border);
    padding: 8px 4px 2px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .side-foot .settings-btn {
    margin-left: auto;
    color: var(--muted);
    padding: 5px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    cursor: pointer;
  }
  .side-foot .settings-btn:hover {
    background: var(--border);
    color: var(--fg);
  }
  .side-foot .settings-btn svg {
    width: 15px;
    height: 15px;
    display: block;
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
</style>
