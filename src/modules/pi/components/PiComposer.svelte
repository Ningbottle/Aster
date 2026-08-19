<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { piConsoleStore } from "../store";

  export let hasPi = false;
  export let onRefresh: () => Promise<void>;

  let draft = "";
  let installing = false;
  let installMsg = "";

  $: active = $piConsoleStore.active;
  $: status = $piConsoleStore.sessionStatus;
  $: running = status === "streaming" || status === "compacting";
  $: canSend = !!active && status === "idle" && !!draft.trim();
  $: needsSetup = !hasPi;

  async function send() {
    const text = draft.trim();
    if (!text || !active || running) return;
    try {
      await piConsoleStore.prompt(text);
      draft = "";
    } catch {
      // store rolled back the optimistic row; keep the draft for retry
    }
  }

  async function cancel() {
    try {
      await piConsoleStore.abort();
    } catch {
      // error visible in store
    }
  }

  async function installManagedPi() {
    installing = true;
    installMsg = "正在安装 Pi 0.84.2 到 Aster 管理目录...";
    try {
      await invoke("pi_install_managed", { version: "0.84.2" });
      installMsg = "成功安装 Managed Pi 0.84.2";
      await onRefresh();
    } catch (e) {
      installMsg = `安装失败: ${e}`;
    } finally {
      installing = false;
    }
  }
</script>

{#if $piConsoleStore.busyOffer}
  <div class="busy" role="alertdialog">
    <p>当前会话正在运行或压缩，不能切换。取消当前运行，或保持当前会话。</p>
    <div class="busy-actions">
      <button type="button" class="btn sm danger-ghost" on:click={cancel}>取消当前运行</button>
      <button type="button" class="btn sm" on:click={() => piConsoleStore.dismissBusy()}>保持当前会话</button>
    </div>
  </div>
{/if}

{#if needsSetup}
  <div class="setup">
    <strong>Needs setup</strong>
    <p>未检测到锁定版本 Pi (0.84.2)。Aster 不读取或保存模型凭据。</p>
    <div class="faint">{installMsg}</div>
    <button type="button" class="btn primary sm" disabled={installing} on:click={installManagedPi}>
      {installing ? "安装中..." : "一键安装 Pi 0.84.2"}
    </button>
  </div>
{/if}

<div class="pi-input">
  <div class="pi-input-inner">
    <textarea
      placeholder={active ? "发送 prompt 到当前 Pi 会话…（Enter 发送，Shift+Enter 换行）" : "先选择或创建一个会话"}
      aria-label="Pi prompt 输入"
      bind:value={draft}
      disabled={!active || running}
      on:keydown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      }}
    ></textarea>
    {#if running}
      <button type="button" class="btn danger-ghost" on:click={cancel}>取消</button>
    {:else}
      <button type="button" class="btn primary" disabled={!canSend} on:click={send}>发送</button>
    {/if}
  </div>
</div>

<style>
  .busy,
  .setup {
    margin: 8px 24px;
    padding: 10px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    font-size: 12.5px;
  }
  .busy-actions,
  .setup {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .pi-input {
    flex: none;
    border-top: 1px solid var(--border);
    padding: 12px 24px;
    background: var(--surface);
    display: flex;
    justify-content: center;
  }
  .pi-input-inner {
    flex: 1;
    max-width: 724px;
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }
  textarea {
    flex: 1;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    padding: 9px 12px;
    font-family: inherit;
    font-size: 13px;
    resize: none;
    min-height: 42px;
    max-height: 140px;
    background: var(--surface);
    color: var(--fg);
  }
</style>
