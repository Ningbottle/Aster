<script lang="ts">
  import { hostRuntimeStore, piLifecycleLabel } from "../../../platform/runtimeStatus";
  import { piConsoleStore } from "../store";
  import { contextUsageView } from "../sessionReducer";

  const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

  let renaming = false;
  let nameDraft = "";
  let stopping = false;
  let recovering = false;

  $: active = $piConsoleStore.active;
  $: models = $piConsoleStore.availableModels;
  $: crashed = $piConsoleStore.sessionStatus === "crashed";
  $: busy = !!(active && (active.isStreaming || active.isCompacting)) && !crashed;
  $: statusLabel = piLifecycleLabel(
    $piConsoleStore.sessionStatus,
    $hostRuntimeStore.pi?.lifecycle ?? $piConsoleStore.runtime?.lifecycle ?? null,
  );

  async function stopSession() {
    if (stopping) return;
    stopping = true;
    try {
      await piConsoleStore.stop();
    } catch {
      // error is visible via store; do not clear the session on failure
    } finally {
      stopping = false;
    }
  }

  async function recoverSession() {
    if (recovering || !active) return;
    recovering = true;
    try {
      await piConsoleStore.recoverSession();
    } catch {
      // error is visible via store
    } finally {
      recovering = false;
    }
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
    const view = contextUsageView(active?.contextUsage ?? null);
    if (view.kind === "percent") return `上下文 ${Number(view.percent.toFixed(1))}%`;
    if (view.kind === "tokens") return `上下文 ${view.tokens}/${view.windowSize}`;
    return "上下文不可用";
  }
</script>

{#if active}
  <header class="session-header">
    <div class="row">
      <div class="identity">
        <div class="project" title={active.projectPath}>{active.projectDisplayName}</div>
        <div class="cwd" title={active.projectPath}>{active.projectPath}</div>
      </div>
      <span class="state" class:crashed>{statusLabel}</span>
      <div class="lifecycle">
        {#if crashed}
          <button
            type="button"
            class="btn sm"
            disabled={recovering || stopping}
            on:click={recoverSession}
          >
            {recovering ? "正在重新打开…" : "重新打开"}
          </button>
        {/if}
        <button
          type="button"
          class="btn sm danger-ghost"
          disabled={stopping || recovering}
          on:click={stopSession}
        >
          {stopping ? "正在停止…" : crashed ? "关闭槽位" : "停止 Session"}
        </button>
      </div>
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
        <button type="button" class="title" disabled={crashed} on:click={startRename}>
          {active.sessionName || "未命名会话"}
        </button>
      {/if}

      {#if models.length > 0}
        <select
          class="model"
          aria-label="选择模型"
          disabled={busy || crashed}
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
        disabled={busy || crashed}
        value={active.thinkingLevel || "medium"}
        on:change={onThinkingChange}
      >
        {#each THINKING_LEVELS as level}
          <option value={level}>{level}</option>
        {/each}
      </select>

      <span class="ctx">{contextLabel()}</span>
    </div>

    {#if $piConsoleStore.error}
      <div class="err" role="alert">{$piConsoleStore.error}</div>
    {/if}
    {#if $piConsoleStore.modelsError}
      <div class="err" role="alert">{$piConsoleStore.modelsError}</div>
    {/if}

    <details class="perm">
      <summary>权限</summary>
      <p>
        {active.permissionSummary
          ? active.permissionSummary
          : "权限状态不可用"}
      </p>
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
  .state.crashed {
    color: var(--danger);
    font-weight: 600;
  }
  .lifecycle {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
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
