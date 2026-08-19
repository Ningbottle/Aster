<script lang="ts">
  import { piConsoleStore } from "../store";

  const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

  let renaming = false;
  let nameDraft = "";

  $: active = $piConsoleStore.active;
  $: models = $piConsoleStore.availableModels;
  $: busy = !!(active && (active.isStreaming || active.isCompacting));
  $: statusLabel = statusText(
    $piConsoleStore.sessionStatus,
    $piConsoleStore.runtime?.lifecycle ?? null,
  );

  function statusText(status: string, lifecycle: string | null): string {
    if (status === "starting" || lifecycle === "starting") return "Starting";
    if (status === "streaming" || lifecycle === "busy") return "Running";
    if (status === "compacting") return "Compacting";
    if (status === "error") return "Error";
    if (lifecycle === "crashed") return "Error";
    if (lifecycle === "stopping") return "Stopping";
    if (lifecycle === "needsSetup") return "Needs setup";
    if (status === "idle" || lifecycle === "ready") return "Ready";
    if (lifecycle === "unknown") return "Unknown";
    if (status === "closed" || lifecycle === "closed") return "Ready";
    return "Unknown";
  }

  async function onModelChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    const model = models.find((m) => m.id === id);
    if (!model || !model.provider) return;
    try {
      await piConsoleStore.setModel(model.provider, model.id);
    } catch {
      // store keeps previous snapshot and surfaces error
    }
  }

  async function onThinkingChange(e: Event) {
    const level = (e.target as HTMLSelectElement).value;
    try {
      await piConsoleStore.setThinkingLevel(level);
    } catch {
      // keep previous thinking level from last snapshot
    }
  }

  function startRename() {
    if (!active) return;
    nameDraft = active.sessionName || "";
    renaming = true;
  }

  async function commitRename() {
    const name = nameDraft.trim();
    renaming = false;
    if (!name || !active) return;
    try {
      await piConsoleStore.setName(name);
    } catch {
      // error is visible via store
    }
  }

  function contextLabel(): string {
    const usage = active?.contextUsage;
    if (!usage) return "";
    const percent = usage.percent;
    const tokens = usage.tokens;
    const windowSize = usage.contextWindow;
    if (typeof percent === "number") return `上下文 ${percent}%`;
    if (typeof tokens === "number" && typeof windowSize === "number") {
      return `上下文 ${tokens}/${windowSize}`;
    }
    return "";
  }
</script>

{#if active}
  <header class="session-header">
    <div class="row">
      <div class="identity">
        <div class="project" title={active.projectPath}>{active.projectDisplayName}</div>
        <div class="cwd" title={active.projectPath}>{active.projectPath}</div>
      </div>
      <span class="state">{statusLabel}</span>
    </div>

    <div class="row">
      {#if renaming}
        <input
          class="rename"
          bind:value={nameDraft}
          aria-label="会话名称"
          on:keydown={(e) => e.key === "Enter" && commitRename()}
          on:blur={commitRename}
        />
      {:else}
        <button type="button" class="title" on:click={startRename}>
          {active.sessionName || "未命名会话"}
        </button>
      {/if}

      {#if models.length > 0}
        <select
          class="model"
          aria-label="选择模型"
          disabled={busy}
          value={active.model?.id || ""}
          on:change={onModelChange}
        >
          {#each models as m (m.id)}
            <option value={m.id}>{m.name || m.id} ({m.provider})</option>
          {/each}
        </select>
      {:else}
        <span class="unavailable">模型不可用</span>
      {/if}

      <select
        class="thinking"
        aria-label="思考级别"
        disabled={busy}
        value={active.thinkingLevel || "medium"}
        on:change={onThinkingChange}
      >
        {#each THINKING_LEVELS as level}
          <option value={level}>{level}</option>
        {/each}
      </select>

      {#if contextLabel()}
        <span class="ctx">{contextLabel()}</span>
      {/if}
    </div>

    {#if $piConsoleStore.error}
      <div class="err" role="alert">{$piConsoleStore.error}</div>
    {/if}
    {#if $piConsoleStore.modelsError}
      <div class="err" role="alert">{$piConsoleStore.modelsError}</div>
    {/if}

    <details class="perm">
      <summary>权限</summary>
      <p>Windows 用户权限（未沙箱化）</p>
    </details>
  </header>
{/if}

<style>
  .session-header {
    padding: 10px 24px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .identity {
    min-width: 0;
    flex: 1;
  }
  .project {
    font-weight: 600;
    font-size: 13px;
  }
  .cwd {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    font-size: 11.5px;
    color: var(--muted);
  }
  .title {
    font-size: 13.5px;
    font-weight: 550;
    padding: 2px 6px;
    border-radius: var(--r-sm);
  }
  .title:hover {
    background: var(--surface-2);
  }
  .rename,
  .model,
  .thinking {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--r-sm);
    padding: 4px 8px;
    font: inherit;
    font-size: 12px;
  }
  .unavailable,
  .ctx {
    font-size: 12px;
    color: var(--muted);
  }
  .err {
    color: var(--danger);
    font-size: 12px;
  }
  .perm {
    font-size: 12px;
    color: var(--muted);
  }
  .perm p {
    margin-top: 4px;
  }
</style>
