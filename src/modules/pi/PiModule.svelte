<script lang="ts">
  import PiSessionHeader from "./components/PiSessionHeader.svelte";
  import PiConversation from "./components/PiConversation.svelte";
  import PiComposer from "./components/PiComposer.svelte";
  import { piConsoleStore } from "./store";
  import { hostRuntimeStore, piLifecycleLabel } from "../../platform/runtimeStatus";
  import type { PiRuntime } from "../../types";

  export let piRuntimes: PiRuntime[] = [];
  export let onRefresh: () => Promise<void>;

  $: hasPi = piRuntimes.some((r) => r.version === "0.84.2");
  $: opening = $piConsoleStore.sessionStatus === "starting";
  $: emptyStatus = piLifecycleLabel(
    $piConsoleStore.sessionStatus,
    $hostRuntimeStore.pi?.lifecycle ?? $piConsoleStore.runtime?.lifecycle ?? null,
  );
</script>

{#if !$piConsoleStore.active}
  <section class="pi-empty" aria-busy={opening}>
    <span class="empty-state">{emptyStatus}</span>
    {#if opening}
      <h1>正在打开会话</h1>
      <p>正在启动 Pi 进程并恢复原生消息。窗口可以最小化或关闭。</p>
    {:else}
      <h1>选择或创建一个 Pi 会话</h1>
      <p>会话将绑定到左侧项目，并由 Pi 保存为原生 JSONL。</p>
      {#if !hasPi}
        <p class="faint">未检测到 Pi 0.84.2。可在下方安装，Aster 不会读取或保存模型凭据。</p>
      {/if}
      <PiComposer {hasPi} {onRefresh} />
    {/if}
  </section>
{:else}
  <section class="pi-session-workspace">
    <PiSessionHeader />
    <PiConversation />
    <PiComposer {hasPi} {onRefresh} />
  </section>
{/if}

<style>
  .pi-empty,
  .pi-session-workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .pi-empty {
    align-items: center;
    justify-content: center;
    padding: 40px 28px;
    text-align: center;
    gap: 8px;
  }
  .empty-state {
    font-size: 11.5px;
    color: var(--muted);
  }
  .pi-empty h1 {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
  }
  .pi-empty p {
    color: var(--muted);
    max-width: 520px;
  }
  .pi-empty :global(.pi-input) {
    width: min(720px, 100%);
    border-top: none;
  }
</style>
