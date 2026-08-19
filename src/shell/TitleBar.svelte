<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import type { ServiceTab, ViewId } from "../types";

  export let activeView: ViewId = "home";
  export let openTabs: ("pi" | "dsh" | "skills")[] = ["pi", "dsh", "skills"];
  export let onSelectView: (id: ViewId) => void;
  export let onCloseTab: (id: "pi" | "dsh" | "skills") => void;

  const SERVICES: ServiceTab[] = [
    {
      id: "pi",
      label: "Pi",
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4"/></svg>',
    },
    {
      id: "dsh",
      label: "DeepSeek Harness",
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6h12"/></svg>',
    },
    {
      id: "skills",
      label: "Skills-Hub",
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 1.8l5.2 3v6.4L8 14.2 2.8 11.2V4.8L8 1.8z"/><path d="M8 5.2v5.6M5.4 6.6l5.2 3"/></svg>',
    },
  ];

  let showMenu = false;

  function toggleMenu(e: MouseEvent) {
    e.stopPropagation();
    showMenu = !showMenu;
  }

  function handleOpenService(id: "pi" | "dsh" | "skills") {
    showMenu = false;
    onSelectView(id);
  }

  async function minimize() {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.debug("Browser preview mode minimize fallback:", e);
    }
  }

  async function toggleMaximize() {
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (e) {
      console.debug("Browser preview mode toggleMaximize fallback:", e);
    }
  }

  async function close() {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      console.debug("Browser preview mode close fallback:", e);
    }
  }

  function handleWindowClick() {
    if (showMenu) showMenu = false;
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={(e) => e.key === "Escape" && (showMenu = false)} />

<header class="titlebar" data-tauri-drag-region>
  <button type="button" class="app-mark" title="回到首页" aria-label="回到首页" on:click={() => onSelectView("home")}>
    <span class="dot-logo">A</span>
    <span>Aster 工作台</span>
  </button>

  <nav class="menus">
    <button type="button" on:click={() => onSelectView("home")}>文件</button>
    <button type="button" on:click={() => onSelectView("agents")}>视图</button>
    <button type="button" on:click={() => onSelectView("infra")}>帮助</button>
  </nav>

  <div class="drag" data-tauri-drag-region>
    <div class="tb-tabs" role="tablist" aria-label="工作区">
      {#each openTabs as tabId (tabId)}
        {@const svc = SERVICES.find((s) => s.id === tabId)}
        {#if svc}
          <button
            type="button"
            class="tb-tab"
            class:active={activeView === tabId}
            role="tab"
            aria-selected={activeView === tabId}
            on:click={() => onSelectView(tabId)}
          >
            {@html svc.icon}
            <span class="tb-label">{svc.label}</span>
            <span
              class="tb-x"
              role="button"
              tabindex="0"
              aria-label="关闭 {svc.label}"
              title="关闭"
              on:click|stopPropagation={() => onCloseTab(tabId)}
              on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && onCloseTab(tabId)}
            >
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
              </svg>
            </span>
          </button>
        {/if}
      {/each}

      <button
        type="button"
        class="tb-add"
        aria-label="打开服务"
        title="打开服务"
        on:click={toggleMenu}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
    </div>

    {#if showMenu}
      <div class="tb-menu" role="menu" tabindex="-1">
        {#each SERVICES as svc (svc.id)}
          {@const isOpen = openTabs.includes(svc.id)}
          <button type="button" role="menuitem" on:click={() => handleOpenService(svc.id)}>
            {@html svc.icon}
            <span>{svc.label}</span>
            {#if isOpen}
              <span class="tb-menu-state">已打开</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="caption-btns">
    <button type="button" aria-label="最小化" on:click={minimize}>
      <svg viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" stroke-width="1" /></svg>
    </button>
    <button type="button" aria-label="最大化" on:click={toggleMaximize}>
      <svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" /></svg>
    </button>
    <button type="button" class="close" aria-label="关闭" on:click={close}>
      <svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1" /></svg>
    </button>
  </div>
</header>

<style>
  .titlebar {
    height: 40px;
    flex: none;
    display: flex;
    align-items: center;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding-left: 12px;
    user-select: none;
  }
  .app-mark {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 12.5px;
    letter-spacing: 0.02em;
    cursor: pointer;
    background: none;
    border: none;
    color: var(--fg);
    padding: 0;
  }
  .app-mark .dot-logo {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    background: var(--accent);
    display: grid;
    place-items: center;
    color: var(--surface);
    font-size: 10px;
    font-weight: 700;
  }
  .menus {
    display: flex;
    gap: 2px;
    margin-left: 20px;
  }
  .menus button {
    font-size: 12px;
    color: var(--muted);
    padding: 4px 10px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    cursor: pointer;
  }
  .menus button:hover {
    background: var(--border);
    color: var(--fg);
  }
  .drag {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    min-width: 0;
    padding: 0 8px;
  }
  .tb-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tb-tab {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 0 1 auto;
    font-size: 12px;
    color: var(--muted);
    padding: 4px 8px 4px 12px;
    border-radius: 7px;
    letter-spacing: 0.02em;
    border: 1px solid transparent;
    background: none;
    cursor: pointer;
  }
  .tb-tab :global(svg) {
    width: 13px;
    height: 13px;
    flex: none;
  }
  .tb-tab .tb-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .tb-tab:hover {
    background: var(--border);
    color: var(--fg);
  }
  .tb-tab.active {
    background: var(--surface);
    color: var(--fg);
    border-color: var(--border-strong);
    box-shadow: var(--shadow-1);
    font-weight: 550;
  }
  .tb-x {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    color: var(--faint);
    flex: none;
  }
  .tb-x svg {
    width: 9px;
    height: 9px;
  }
  .tb-x:hover {
    background: var(--border-strong);
    color: var(--fg);
  }
  .tb-tab:not(.active) .tb-x {
    opacity: 0;
  }
  .tb-tab:hover .tb-x,
  .tb-tab.active .tb-x {
    opacity: 1;
  }
  .tb-add {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    color: var(--muted);
    flex: none;
    background: none;
    border: none;
    cursor: pointer;
  }
  .tb-add:hover {
    background: var(--border);
    color: var(--fg);
  }
  .tb-add svg {
    width: 12px;
    height: 12px;
  }
  .tb-menu {
    position: absolute;
    top: 34px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-2);
    padding: 4px;
    min-width: 190px;
  }
  .tb-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    color: var(--fg);
    background: none;
    border: none;
    cursor: pointer;
  }
  .tb-menu button :global(svg) {
    width: 13px;
    height: 13px;
    color: var(--muted);
    flex: none;
  }
  .tb-menu button:hover {
    background: var(--surface-2);
  }
  .tb-menu .tb-menu-state {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--faint);
  }
  .caption-btns {
    display: flex;
    height: 100%;
  }
  .caption-btns button {
    width: 46px;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .caption-btns button:hover {
    background: var(--border);
    color: var(--fg);
  }
  .caption-btns button.close:hover {
    background: var(--danger);
    color: var(--surface);
  }
  .caption-btns svg {
    width: 10px;
    height: 10px;
  }
  @media (max-width: 880px) {
    .menus {
      display: none;
    }
  }
</style>
