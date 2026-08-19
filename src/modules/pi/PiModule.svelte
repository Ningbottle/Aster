<script lang="ts">
  import PiSessionHeader from "./components/PiSessionHeader.svelte";
  import PiConversation from "./components/PiConversation.svelte";
  import PiComposer from "./components/PiComposer.svelte";
  import { piConsoleStore } from "./store";
  import type { PiRuntime } from "../../types";

  export let piRuntimes: PiRuntime[] = [];
  export let onRefresh: () => Promise<void>;

  $: hasPi = piRuntimes.some((r) => r.version === "0.84.2");
</script>

{#if !$piConsoleStore.active}
  <section class="pi-empty">
    <h1>选择或创建一个 Pi 会话</h1>
    <p>会话将绑定到左侧项目，并由 Pi 保存为原生 JSONL。</p>
    {#if !hasPi}
      <p class="faint">未检测到 Pi 0.84.2。可在下方安装，Aster 不会读取或保存模型凭据。</p>
    {/if}
    <PiComposer {hasPi} {onRefresh} />
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
