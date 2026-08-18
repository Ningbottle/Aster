<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";

  import type {
    AppStatus,
    DiscoveredHost,
    DshRuntime,
    DshStatus,
    PiEvent,
    PiObservation,
    PiRuntime,
    SkillItem,
    ViewId,
  } from "./types";

  import TitleBar from "./components/TitleBar.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import HomeView from "./views/HomeView.svelte";
  import PiView from "./views/PiView.svelte";
  import DshView from "./views/DshView.svelte";
  import SkillsView from "./views/SkillsView.svelte";
  import AgentsView from "./views/AgentsView.svelte";
  import InfraView from "./views/InfraView.svelte";

  const ALL_TOOLS = [
    "Pi",
    "DSH",
    "Antigravity",
    "Cursor",
    "Claude Code",
    "Codex",
    "Zed",
    "Kimi Code",
    "Grok Build",
    "Qoder",
    "ZCode",
  ];

  let activeView: ViewId = "home";
  let openTabs: ("pi" | "dsh" | "skills")[] = ["pi", "dsh", "skills"];
  let activeTool = "all";

  // Backend state
  let status: AppStatus | null = null;
  let piRuntimes: PiRuntime[] = [];
  let dshRuntimes: DshRuntime[] = [];
  let dshStatus: DshStatus | null = null;
  let discoveredHosts: DiscoveredHost[] = [];
  let skillStatus: Record<string, unknown> | null = null;
  let skills: SkillItem[] = [];
  let observation: PiObservation | null = null;
  let events: PiEvent[] = [];
  let lastBackendError: string | null = null;

  let piViewRef: PiView;
  let dshViewRef: DshView;
  let skillsViewRef: SkillsView;
  let unlisten: (() => void) | null = null;

  $: skillCountsByTool = ALL_TOOLS.reduce<Record<string, number>>((acc, tool) => {
    acc[tool] = skills.filter((s) => s.tools.some((t) => t.toLowerCase() === tool.toLowerCase())).length;
    return acc;
  }, {});

  $: totalSkillsCount = skills.length;

  async function refreshData() {
    try {
      status = await invoke<AppStatus>("get_app_status");
      piRuntimes = await invoke<PiRuntime[]>("pi_discover");
      observation = await invoke<PiObservation>("pi_session_observation");
      skillStatus = await invoke("skill_status");
      dshRuntimes = await invoke<DshRuntime[]>("dsh_discover");
      dshStatus = await invoke<DshStatus | null>("dsh_status");
      discoveredHosts = await invoke<DiscoveredHost[]>("host_profiles_list", {});
      skills = await invoke<SkillItem[]>("skills_list");
      lastBackendError = null;
    } catch (err: any) {
      console.error("refreshData invoke error:", err);
      const isWebOnly = typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__;
      if (!isWebOnly) {
        lastBackendError = typeof err === "string" ? err : (err?.message || JSON.stringify(err));
      }
    }
  }

  onMount(async () => {
    // 读取持久化标签与视图
    try {
      const storedTabs = localStorage.getItem("aster.openTabs");
      if (storedTabs) {
        const parsed = JSON.parse(storedTabs);
        if (Array.isArray(parsed) && parsed.length) {
          openTabs = parsed.filter((id) => ["pi", "dsh", "skills"].includes(id));
        }
      }
      const storedView = localStorage.getItem("aster.activeView") as ViewId;
      if (storedView && ["home", "pi", "dsh", "skills", "agents", "infra"].includes(storedView)) {
        activeView = storedView;
      }
    } catch (e) {
      console.debug("Failed to restore stored view/tabs:", e);
    }

    try {
      unlisten = await listen<PiEvent>("pi-event", (e) => {
        // 直接派发给 PiView 组件处理事件，避免数组长度游标截断与事件丢失
        piViewRef?.handleIncomingEvent(e.payload);
        events = [...events.slice(-200), e.payload];
        if (["agent_end", "agent_settled", "tool_execution_end"].includes(e.payload.event_type)) {
          invoke("pi_session_observation")
            .then((o) => (observation = o as PiObservation))
            .catch((err) => console.debug("pi observation error:", err));
        }
      });
    } catch (e) {
      console.debug("pi-event listener setup fallback:", e);
    }

    await refreshData();
  });

  onDestroy(() => {
    unlisten?.();
  });

  function handleSelectView(id: ViewId) {
    if (["pi", "dsh", "skills"].includes(id) && !openTabs.includes(id as "pi" | "dsh" | "skills")) {
      openTabs = [...openTabs, id as "pi" | "dsh" | "skills"];
      try {
        localStorage.setItem("aster.openTabs", JSON.stringify(openTabs));
      } catch (e) {
        console.debug("Failed to store openTabs:", e);
      }
    }
    activeView = id;
    try {
      localStorage.setItem("aster.activeView", id);
    } catch (e) {
      console.debug("Failed to store activeView:", e);
    }

    if (id === "dsh") {
      dshViewRef?.startDshServer();
    }
  }

  function handleCloseTab(id: "pi" | "dsh" | "skills") {
    openTabs = openTabs.filter((x) => x !== id);
    if (id === "dsh") {
      dshViewRef?.stopDshServer();
    }
    try {
      localStorage.setItem("aster.openTabs", JSON.stringify(openTabs));
    } catch (e) {
      console.debug("Failed to store openTabs:", e);
    }
    if (activeView === id) {
      handleSelectView(openTabs.length ? (openTabs[openTabs.length - 1] as ViewId) : "home");
    }
  }

  function handleSelectTool(tool: string) {
    activeTool = tool;
  }

  function handleNewPiConversation() {
    piViewRef?.openCompose();
  }

  function handleOpenPiChat() {
    piViewRef?.openChat();
  }
</script>

<div class="window">
  <TitleBar
    {activeView}
    {openTabs}
    onSelectView={handleSelectView}
    onCloseTab={handleCloseTab}
  />

  <div class="shell">
    <Sidebar
      {activeView}
      {activeTool}
      tools={ALL_TOOLS}
      {skillCountsByTool}
      {totalSkillsCount}
      onSelectView={handleSelectView}
      onSelectTool={handleSelectTool}
      onNewPiConversation={handleNewPiConversation}
    />

    <main class="main">
      {#if lastBackendError}
        <div class="backend-error-bar" role="alert">
          <span class="err-icon">⚠️</span>
          <span class="err-text">后端服务通信异常：{lastBackendError}</span>
          <button type="button" class="btn-retry" on:click={refreshData}>重试</button>
        </div>
      {/if}

      <!-- 视图 1：Aster 首页 -->
      <section class="view" class:active={activeView === "home"}>
        <HomeView
          {piRuntimes}
          {dshStatus}
          {totalSkillsCount}
          onSelectView={handleSelectView}
          onOpenPiChat={handleOpenPiChat}
        />
      </section>

      <!-- 视图 2：Pi 工作台 -->
      <section class="view" class:active={activeView === "pi"}>
        <PiView
          bind:this={piViewRef}
          {piRuntimes}
          {observation}
          onRefresh={refreshData}
        />
      </section>

      <!-- 视图 3：DeepSeek Harness -->
      <section class="view" class:active={activeView === "dsh"}>
        <DshView
          bind:this={dshViewRef}
          {dshRuntimes}
          {dshStatus}
          onRefresh={refreshData}
        />
      </section>

      <!-- 视图 4：Skills-Hub -->
      <section class="view" class:active={activeView === "skills"}>
        <SkillsView
          bind:this={skillsViewRef}
          {activeTool}
          {discoveredHosts}
          {skills}
          onRefresh={refreshData}
        />
      </section>

      <!-- 视图 5：智能体与宿主 -->
      <section class="view" class:active={activeView === "agents"}>
        <AgentsView
          {piRuntimes}
          {dshStatus}
          {discoveredHosts}
          onSelectView={handleSelectView}
        />
      </section>

      <!-- 视图 6：基础设施与证据 -->
      <section class="view" class:active={activeView === "infra"}>
        <InfraView
          {status}
          {skillStatus}
        />
      </section>
    </main>
  </div>
</div>

<style>
  :global(:root) {
    --bg: oklch(0.972 0.003 95);
    --surface: oklch(0.996 0.001 95);
    --surface-2: oklch(0.955 0.004 95);
    --fg: oklch(0.25 0.012 265);
    --muted: oklch(0.44 0.012 265);
    --faint: oklch(0.46 0.01 265);
    --border: oklch(0.905 0.005 265);
    --border-strong: oklch(0.85 0.006 265);
    --accent: oklch(0.5 0.115 255);
    --accent-hover: oklch(0.44 0.115 255);
    --accent-soft: oklch(0.95 0.025 255);
    --success: oklch(0.6 0.13 152);
    --warn: oklch(0.64 0.12 78);
    --danger: oklch(0.5 0.16 27);
    --font-body: "Segoe UI Variable Text", "Segoe UI", system-ui, "Microsoft YaHei", sans-serif;
    --font-display: "Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", system-ui, "Microsoft YaHei", sans-serif;
    --font-mono: "Cascadia Code", "Cascadia Mono", Consolas, "JetBrains Mono", monospace;
    --r-sm: 6px;
    --r-md: 8px;
    --r-lg: 12px;
    --shadow-1: 0 1px 2px oklch(0.25 0.01 265 / 0.05);
    --shadow-2: 0 4px 16px oklch(0.25 0.01 265 / 0.1);
    --shadow-modal: 0 16px 48px oklch(0.25 0.01 265 / 0.22);
  }
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  :global(html),
  :global(body) {
    height: 100%;
  }
  :global(body) {
    font-family: var(--font-body);
    font-size: 13.5px;
    line-height: 1.65;
    color: var(--fg);
    background: var(--bg);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  :global(button) {
    font-family: inherit;
    font-size: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  :global(button:focus-visible),
  :global([tabindex]:focus-visible),
  :global(input:focus-visible),
  :global(textarea:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-radius: var(--r-sm);
  }
  :global(::selection) {
    background: var(--accent-soft);
  }

  /* 通用样式 */
  :global(.btn) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 13px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    font-weight: 550;
    letter-spacing: 0.02em;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--fg);
    transition: background 0.12s ease, border-color 0.12s ease;
    white-space: nowrap;
    cursor: pointer;
  }
  :global(.btn:hover) {
    background: var(--surface-2);
  }
  :global(.btn:active) {
    transform: translateY(1px);
  }
  :global(.btn.primary) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--surface);
  }
  :global(.btn.primary:hover) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  :global(.btn.danger-ghost) {
    color: var(--danger);
    border-color: var(--border-strong);
  }
  :global(.btn.danger-ghost:hover) {
    background: oklch(0.96 0.02 27);
  }
  :global(.btn.sm) {
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
  }
  :global(.btn:disabled) {
    opacity: 0.5;
    cursor: default;
    transform: none;
  }
  :global(.btn svg) {
    width: 13px;
    height: 13px;
  }

  :global(.chip) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12px;
    color: var(--muted);
    border: 1px solid var(--border);
    background: var(--surface);
    cursor: pointer;
  }
  :global(.chip:hover) {
    border-color: var(--border-strong);
    color: var(--fg);
  }
  :global(.chip.on) {
    background: var(--fg);
    border-color: var(--fg);
    color: var(--surface);
  }

  :global(.tag) {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 550;
    letter-spacing: 0.02em;
  }
  :global(.tag.ok) {
    background: oklch(0.94 0.04 152);
    color: oklch(0.42 0.11 152);
  }
  :global(.tag.warn) {
    background: oklch(0.95 0.05 78);
    color: oklch(0.45 0.1 70);
  }
  :global(.tag.err) {
    background: oklch(0.95 0.03 27);
    color: oklch(0.46 0.15 27);
  }
  :global(.tag.neutral) {
    background: var(--surface-2);
    color: var(--muted);
  }
  :global(.tag.info) {
    background: var(--accent-soft);
    color: var(--accent-hover);
  }

  :global(.card) {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
  }
  :global(.card-pad) {
    padding: 16px 18px;
  }
  :global(.mono) {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  :global(.muted) {
    color: var(--muted);
  }
  :global(.faint) {
    color: var(--faint);
  }

  :global(::-webkit-scrollbar) {
    width: 10px;
    height: 10px;
  }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--border-strong);
    border-radius: 6px;
    border: 2px solid var(--bg);
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--faint);
  }
  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  .window {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .shell {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .backend-error-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: oklch(0.96 0.05 25);
    border-bottom: 1px solid var(--danger);
    color: var(--danger);
    font-size: 12.5px;
    font-weight: 500;
  }
  .backend-error-bar .err-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .backend-error-bar .btn-retry {
    padding: 2px 8px;
    font-size: 11.5px;
    background: var(--surface);
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .backend-error-bar .btn-retry:hover {
    background: var(--danger);
    color: var(--surface);
  }
  .view {
    flex: 1;
    min-height: 0;
    display: none;
    flex-direction: column;
    overflow: hidden;
  }
  .view.active {
    display: flex;
    animation: viewIn 0.22s cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes viewIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
