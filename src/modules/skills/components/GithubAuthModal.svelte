<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, createEventDispatcher, onDestroy } from "svelte";
  import type { DeviceCodeResponse, DevicePollResult, GithubAuthStatus } from "../../../types";

  export let show = false;

  const dispatch = createEventDispatcher<{
    close: void;
    authenticated: void;
  }>();

  let activeTab: "device" | "pat" = "device";
  let authStatus: GithubAuthStatus = { has_token: false, source: "" };
  let loading = false;
  let errorMsg: string | null = null;
  let successMsg: string | null = null;

  // Device flow state
  let deviceResp: DeviceCodeResponse | null = null;
  let pollTimer: number | null = null;
  let remainingSeconds = 0;
  let countdownTimer: number | null = null;
  let isPolling = false;

  // PAT state
  let patInput = "";
  let savingPat = false;

  async function checkAuthStatus() {
    try {
      authStatus = await invoke<GithubAuthStatus>("github_token_status");
    } catch (err: unknown) {
      errorMsg = String(err);
    }
  }

  let wasShow = false;

  function resetTransient() {
    stopPolling();
    deviceResp = null;
    remainingSeconds = 0;
    errorMsg = null;
    successMsg = null;
    patInput = "";
    loading = false;
    savingPat = false;
    activeTab = "device";
  }

  $: {
    if (show && !wasShow) {
      resetTransient();
      checkAuthStatus();
    }
    if (!show && wasShow) {
      resetTransient();
    }
    wasShow = show;
  }

  onMount(() => {
    checkAuthStatus();
  });

  onDestroy(() => {
    stopPolling();
  });

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    isPolling = false;
  }

  async function startDeviceFlow() {
    try {
      errorMsg = null;
      successMsg = null;
      loading = true;
      stopPolling();

      deviceResp = await invoke<DeviceCodeResponse>("github_device_start", { clientId: null });
      remainingSeconds = deviceResp.expires_in || 900;
      isPolling = true;

      // 倒计时
      countdownTimer = window.setInterval(() => {
        if (remainingSeconds > 0) {
          remainingSeconds--;
        } else {
          stopPolling();
          errorMsg = "授权码已超时，请重新获取。";
        }
      }, 1000);

      // 轮询
      const intervalSec = Math.max(deviceResp.interval || 5, 5);
      pollTimer = window.setInterval(async () => {
        if (!deviceResp) return;
        try {
          const pollRes = await invoke<DevicePollResult>("github_device_poll", {
            clientId: "Ov23liAsterDesktop",
            deviceCode: deviceResp.device_code,
          });

          if (pollRes.status === "success") {
            stopPolling();
            successMsg = "GitHub 授权成功！凭据已加密保存在 Windows 凭据管理器。";
            await checkAuthStatus();
            dispatch("authenticated");
          } else if (pollRes.status === "expired" || pollRes.status === "denied" || pollRes.status === "error") {
            stopPolling();
            errorMsg = pollRes.error || "授权失败";
          }
        } catch (err: unknown) {
          stopPolling();
          errorMsg = `轮询出错: ${String(err)}`;
        }
      }, intervalSec * 1000);

    } catch (err: unknown) {
      errorMsg = `发起授权失败: ${String(err)}`;
    } finally {
      loading = false;
    }
  }

  async function handleSavePat() {
    if (!patInput.trim()) {
      errorMsg = "请输入有效的 GitHub Personal Access Token (PAT)";
      return;
    }
    try {
      errorMsg = null;
      successMsg = null;
      savingPat = true;
      await invoke("github_set_pat", { pat: patInput.trim() });
      patInput = "";
      successMsg = "PAT 凭据已加密保存至 Windows 凭据管理器！";
      await checkAuthStatus();
      dispatch("authenticated");
    } catch (err: unknown) {
      errorMsg = `保存凭据失败: ${String(err)}`;
    } finally {
      savingPat = false;
    }
  }

  async function handleLogout() {
    try {
      errorMsg = null;
      successMsg = null;
      await invoke("github_logout");
      stopPolling();
      deviceResp = null;
      await checkAuthStatus();
      successMsg = "已成功从 Windows 凭据管理器中移除 GitHub 凭据。";
      dispatch("authenticated");
    } catch (err: unknown) {
      errorMsg = `退出失败: ${String(err)}`;
    }
  }

  function handleCopyUserCode() {
    if (deviceResp?.user_code) {
      navigator.clipboard.writeText(deviceResp.user_code);
    }
  }

  function close() {
    resetTransient();
    dispatch("close");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!show) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
  <div class="modal-backdrop" on:click={close}>
    <div class="modal-card" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          GitHub 凭据与私有仓库授权
        </div>
        <button type="button" class="close-btn" on:click={close}>×</button>
      </div>

      <div class="auth-status-bar">
        <span>当前状态:</span>
        {#if authStatus.has_token}
          <span class="tag ok sm">已授权 · Windows 凭据管理器</span>
          <button type="button" class="btn sm danger-ghost" on:click={handleLogout}>断开连接</button>
        {:else}
          <span class="tag neutral sm">未连接 (仅可扫描公共仓库)</span>
        {/if}
      </div>

      <div class="tabs-nav">
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === "device"}
          on:click={() => activeTab = "device"}
        >
          Device Flow (浏览器快速授权)
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === "pat"}
          on:click={() => activeTab = "pat"}
        >
          PAT (Personal Access Token)
        </button>
      </div>

      <div class="modal-body">
        {#if errorMsg}
          <div class="tag err" style="margin-bottom: 12px; word-break: break-word;">{errorMsg}</div>
        {/if}

        {#if successMsg}
          <div class="tag ok" style="margin-bottom: 12px;">{successMsg}</div>
        {/if}

        {#if activeTab === "device"}
          <div class="tab-content">
            <p class="desc-text">
              通过 GitHub RFC 8628 设备授权流连接。点击下方按钮获取授权码并在 GitHub 网页中完成确认。
            </p>

            {#if !deviceResp}
              <button
                type="button"
                class="btn primary"
                disabled={loading}
                on:click={startDeviceFlow}
              >
                {loading ? "正在生成设备授权码..." : "获取 GitHub 设备授权码"}
              </button>
            {:else}
              <div class="device-box">
                <div class="code-label">您的一次性设备码:</div>
                <div class="user-code-display">{deviceResp.user_code}</div>
                <div class="code-actions">
                  <button type="button" class="btn sm" on:click={handleCopyUserCode}>复制授权码</button>
                  <a
                    href={deviceResp.verification_uri}
                    target="_blank"
                    rel="noreferrer"
                    class="btn primary sm"
                  >
                    打开 GitHub 授权页 ↗
                  </a>
                </div>
                {#if isPolling}
                  <div class="poll-status">
                    <span class="status-dot run"></span>
                    正在等待授权... 倒计时 {remainingSeconds}s
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div class="tab-content">
            <p class="desc-text">
              手动输入 GitHub 经典 PAT 或 Fine-grained Token（需要 `repo` 或 `read:packages` 权限）。
            </p>
            <div class="form-group">
              <label for="pat-input">Token 密钥:</label>
              <input
                id="pat-input"
                type="password"
                class="input"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx 或 github_pat_..."
                bind:value={patInput}
              />
            </div>
            <div class="form-actions">
              <button
                type="button"
                class="btn primary"
                disabled={savingPat || !patInput.trim()}
                on:click={handleSavePat}
              >
                {savingPat ? "正在保存..." : "安全保存到凭据管理器"}
              </button>
            </div>
          </div>
        {/if}

        <div class="security-note">
          🔒 <strong>安全承诺</strong>：所有 GitHub 令牌仅存储在 Windows Credential Manager（服务名 <code>aster.github</code>），绝不存入 SQLite、不写入日志、不包含在导出包中。
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(2px);
  }
  .modal-card {
    background: var(--bg-surface, #18181b);
    border: 1px solid var(--border-normal, #3f3f46);
    border-radius: 10px;
    width: 520px;
    max-width: 90vw;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle, #27272a);
  }
  .modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-normal, #f4f4f5);
  }
  .close-btn {
    background: transparent;
    border: none;
    font-size: 18px;
    color: var(--text-faint, #71717a);
    cursor: pointer;
  }
  .auth-status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid var(--border-subtle, #27272a);
    font-size: 12px;
  }
  .tabs-nav {
    display: flex;
    border-bottom: 1px solid var(--border-subtle, #27272a);
  }
  .tab-btn {
    flex: 1;
    padding: 10px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 12px;
    color: var(--text-muted, #a1a1aa);
    cursor: pointer;
    transition: all 0.15s;
  }
  .tab-btn.active {
    color: var(--accent, #6366f1);
    border-bottom-color: var(--accent, #6366f1);
    font-weight: 500;
  }
  .modal-body {
    padding: 18px;
  }
  .desc-text {
    font-size: 12px;
    color: var(--text-muted, #a1a1aa);
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .device-box {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-subtle, #27272a);
    border-radius: 8px;
    padding: 16px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .code-label {
    font-size: 11.5px;
    color: var(--text-faint, #71717a);
  }
  .user-code-display {
    font-family: var(--font-mono, monospace);
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 4px;
    color: var(--accent, #818cf8);
    background: rgba(99, 102, 241, 0.1);
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px dashed var(--accent, #6366f1);
  }
  .code-actions {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }
  .poll-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--text-faint, #888);
    margin-top: 6px;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }
  .form-group label {
    font-size: 11.5px;
    color: var(--text-muted, #a1a1aa);
  }
  .form-group input {
    background: var(--bg-card, #1e1e24);
    border: 1px solid var(--border-normal, #3f3f46);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text-normal, #f4f4f5);
    font-size: 12px;
    font-family: var(--font-mono, monospace);
  }
  .security-note {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle, #27272a);
    font-size: 11px;
    color: var(--text-faint, #71717a);
    line-height: 1.4;
  }
</style>
