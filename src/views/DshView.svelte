<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type { DshRuntime, DshStatus } from "../types";

  export let dshRuntimes: DshRuntime[] = [];
  export let dshStatus: DshStatus | null = null;
  export let onRefresh: () => Promise<void>;

  let starting = false;
  let stopping = false;
  let installingDsh = false;
  let installMsg = "";
  let errorMsg = "";
  let iframeKey = 0;

  $: hasDsh = dshRuntimes.some((r) => r.version === "0.1.0-rc.6");
  $: targetUrl = dshStatus?.url || "http://127.0.0.1:38472";
  $: isRunning = !!dshStatus?.running;

  export async function installManagedDsh() {
    installingDsh = true;
    installMsg = "正在安装 DeepSeek Harness 0.1.0-rc.6 到 Aster 管理目录...";
    try {
      await invoke<DshRuntime>("dsh_install_managed", { version: "0.1.0-rc.6" });
      installMsg = "成功安装 Managed DSH 0.1.0-rc.6";
      await onRefresh();
      await startDshServer();
    } catch (e) {
      installMsg = `安装失败: ${e}`;
    } finally {
      installingDsh = false;
    }
  }

  export async function startDshServer() {
    if (isRunning || starting) return;
    starting = true;
    errorMsg = "";
    try {
      dshStatus = await invoke<DshStatus>("dsh_start", { port: 38472 });
      await onRefresh();
    } catch (e) {
      errorMsg = `启动 DSH 失败: ${e}`;
    } finally {
      starting = false;
    }
  }

  export async function stopDshServer() {
    if (!isRunning || stopping) return;
    stopping = true;
    try {
      await invoke("dsh_stop");
      dshStatus = null;
      await onRefresh();
    } catch (e) {
      errorMsg = `停止服务失败: ${e}`;
    } finally {
      stopping = false;
    }
  }

  async function openExternalWindow() {
    try {
      await invoke("dsh_open_window");
    } catch (e) {
      errorMsg = `打开独立窗口失败: ${e}`;
    }
  }

  function reloadIframe() {
    iframeKey += 1;
  }
</script>

<section class="view-dsh">
  <div class="dsh-bar">
    <div class="dsh-bar-left">
      <span class="dsh-title">DeepSeek Harness</span>
      {#if isRunning}
        <span class="tag ok">
          <span class="status-dot run"></span>
          运行中 · {dshStatus?.url}
        </span>
      {:else}
        <span class="tag neutral">已停止</span>
      {/if}
    </div>

    <div class="dsh-bar-right">
      {#if isRunning}
        <button type="button" class="btn sm" on:click={reloadIframe} title="重新加载网页">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 8a5.5 5.5 0 101.6-3.9L2 6.5M2 2.5v4h4" /></svg>
          刷新
        </button>
        <button type="button" class="btn sm" on:click={openExternalWindow} title="在原生独立窗口中查看">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M10 2h4v4M9 7l5-5" /></svg>
          独立窗口
        </button>
        <button type="button" class="btn sm danger-ghost" disabled={stopping} on:click={stopDshServer}>
          {stopping ? "停止中..." : "停止服务"}
        </button>
      {:else}
        <button
          type="button"
          class="btn primary sm"
          disabled={starting || installingDsh}
          on:click={startDshServer}
        >
          {starting ? "启动中..." : "启动服务"}
        </button>
      {/if}
    </div>
  </div>

  <div class="dsh-embed">
    {#if isRunning}
      {#key iframeKey}
        <iframe
          src={targetUrl}
          title="DeepSeek Harness 原生 Web UI"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      {/key}
    {:else}
      <div class="embed-fallback">
        <div class="ef-title">DeepSeek Harness 原生工作台</div>
        <p class="ef-sub">
          Aster 忠实保留 DSH 的原生 Web 界面、插件模型、自定义模式与原生会话持久化。
          {#if dshRuntimes.length > 0}
            <br><span class="faint" style="font-size: 11.5px;">已检测到版本：{dshRuntimes[0].version} ({dshRuntimes[0].managed ? "Aster 管理" : "外部 npm"})</span>
          {:else}
            <br><span class="faint" style="font-size: 11.5px;">未检测到 DSH 0.1.0-rc.6 运行时。</span>
          {/if}
        </p>

        {#if errorMsg}
          <div class="tag err" style="margin-top: 8px; max-width: 600px; word-break: break-word;">{errorMsg}</div>
        {/if}

        {#if installMsg}
          <div class="tag info" style="margin-top: 8px;">{installMsg}</div>
        {/if}

        <div style="display: flex; gap: 10px; margin-top: 14px;">
          {#if !hasDsh}
            <button
              type="button"
              class="btn primary"
              disabled={installingDsh}
              on:click={installManagedDsh}
            >
              {installingDsh ? "正在安装..." : "一键安装 DSH 0.1.0-rc.6"}
            </button>
          {:else}
            <button
              type="button"
              class="btn primary"
              disabled={starting}
              on:click={startDshServer}
            >
              {starting ? "正在启动本地服务..." : "启动 DSH Web 服务"}
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .view-dsh {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .dsh-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex: none;
    gap: 12px;
  }
  .dsh-bar-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .dsh-title {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--fg);
  }
  .dsh-bar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dsh-embed {
    flex: 1;
    position: relative;
    min-height: 0;
    background: var(--surface-2);
  }
  .dsh-embed iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: var(--surface);
  }
  .embed-fallback {
    position: absolute;
    inset: 0;
    z-index: 2;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
    padding: 24px;
  }
  .embed-fallback .ef-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--fg);
  }
  .embed-fallback .ef-sub {
    font-size: 12.5px;
    color: var(--muted);
    max-width: 480px;
    line-height: 1.7;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 4px;
  }
  .status-dot.run {
    background: var(--success);
  }
</style>

