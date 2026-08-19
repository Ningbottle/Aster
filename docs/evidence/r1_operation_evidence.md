# R1 自动化验证记录

- 生成时间：2026-08-18T16:23:29.269Z
- 证据类型：自动命令输出
- 不包含：真实 Tauri UI 操作、真实宿主加载、真实用户部署目录

> 本文件只能证明下列命令成功退出。进程/AppData 冒烟只证明 release 程序能启动并创建数据库，不证明扫描、Diff、部署、evidence 或回滚能从 UI 完成。真实 UI 结果单独记录在 [R1–R3 UI 审计](r1-r3-manual-audit-2026-08-18.md)。

## 自动化结果

### CI no-fake-data gate

- Command: `node scripts/ci-no-fake-data.mjs`
- Result: `AUTOMATED_VERIFIED` (exit code 0)

```text
[CI Gate] Scanning 14 frontend files and 12 backend files for fake data, constant true hacks, and empty catch blocks...
[OK] CI Gate Passed: Zero fake data patterns, zero constant true hacks, zero empty catch blocks across 26 files.
```

### Svelte/TypeScript check

- Command: `npm run check`
- Result: `AUTOMATED_VERIFIED` (exit code 0)

```text
> aster@0.1.0 check
> svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: c:\Aster
Getting Svelte diagnostics...

c:\Aster\[32msrc\components\ProjectSelector.svelte[39m:95:5
[33mWarn[39m: Visible, non-interactive element `<div>` with a click event must be accompanied by a keyboard event handler. Consider whether an interactive element such as `<button type="button">` or `<a>` might be more appropriate
https://svelte.dev/e/a11y_click_events_have_key_events (svelte)
[36m  <div class="selector-bar">
    [35m<div class="project-info" on:click={toggleDropdown} title="点击切换最近项目">
      <svg class="icon-folder" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M1.5 3.5A1.5 1.5 0 013 2h3.586a1 1 0 01.707.293L8.707 3.7a1 1 0 00.707.293H13A1.5 1.5 0 0114.5 5.5v7A1.5 1.5 0 0113 14H3a1.5 1.5 0 01-1.5-1.5v-9z" />
      </svg>
      <div class="project-text">
        <span class="label">当前工作目录:</span>
        <span class="path" title={activeProjectPath || "使用宿主默认工作区"}>
          {activeProjectPath ? activeProjectPath : "默认工作目录 (未指定)"}
        </span>
      </div>
      <svg class="icon-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>[36m[39m

c:\Aster\[32msrc\components\ProjectSelector.svelte[39m:95:5
[33mWarn[39m: `<div>` with a click handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions (svelte)
[36m  <div class="selector-bar">
    [35m<div class="project-info" on:click={toggleDropdown} title="点击切换最近项目">
      <svg class="icon-folder" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M1.5 3.5A1.5 1.5 0 013 2h3.586a1 1 0 01.707.293L8.707 3.7a1 1 0 00.707.293H13A1.5 1.5 0 0114.5 5.5v7A1.5 1.5 0 0113 14H3a1.5 1.5 0 01-1.5-1.5v-9z" />
      </svg>
      <div class="project-text">
        <span class="label">当前工作目录:</span>
        <span class="path" title={activeProjectPath || "使用宿主默认工作区"}>
          {activeProjectPath ? activeProjectPath : "默认工作目录 (未指定)"}
        </span>
      </div>
      <svg class="icon-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>[36m[39m

c:\Aster\[32msrc\components\ProjectSelector.svelte[39m:119:5
[33mWarn[39m: Visible, non-interactive element `<div>` with a click event must be accompanied by a keyboard event handler. Consider whether an interactive element such as `<button type="button">` or `<a>` might be more appropriate
https://svelte.dev/e/a11y_click_events_have_key_events (svelte)
[36m  {#if showDropdown}
    [35m<div class="dropdown-overlay" on:click={() => showDropdown = false}></div>[36m
    <div class="project-dropdown">[39m

c:\Aster\[32msrc\components\ProjectSelector.svelte[39m:119:5
[33mWarn[39m: `<div>` with a click handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions (svelte)
[36m  {#if showDropdown}
    [35m<div class="dropdown-overlay" on:click={() => showDropdown = false}></div>[36m
    <div class="project-dropdown">[39m

c:\Aster\[32msrc\components\ProjectSelector.svelte[39m:133:13
[33mWarn[39m: Visible, non-interactive element `<div>` with a click event must be accompanied by a keyboard event handler. Consider whether an interactive element such as `<button type="button">` or `<a>` might be more appropriate
https://svelte.dev/e/a11y_click_events_have_key_events (svelte)
[36m          {#each recentList as proj}
            [35m<div
              class="dropdown-item"
              class:active={proj.path === activeProjectPath}
              on:click={() => handleSelectRecent(proj)}
            >
              <div class="item-main">
                <span class="item-name">{proj.display_name}</span>
                <span class="item-path" title={proj.path}>{proj.path}</span>
              </div>
              <button
                type="button"
                class="item-del"
                title="从历史记录移除"
                on:click={(e) => handleRemoveRecent(e, proj)}
              >
                ×
              </button>
            </div>[36m
          {/each}[39m

c:\Aster\[32msrc\components\ProjectSelector.svelte[39m:133:13
[33mWarn[39m: `<div>` with a click handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions (svelte)
[36m          {#each recentList as proj}
            [35m<div
              class="dropdown-item"
              class:active={proj.path === activeProjectPath}
              on:click={() => handleSelectRecent(proj)}
            >
              <div class="item-main">
                <span class="item-name">{proj.display_name}</span>
                <span class="item-path" title={proj.path}>{proj.path}</span>
              </div>
              <button
                type="button"
                class="item-del"
                title="从历史记录移除"
                on:click={(e) => handleRemoveRecent(e, proj)}
              >
                ×
              </button>
            </div>[36m
          {/each}[39m

c:\Aster\[32msrc\components\GithubAuthModal.svelte[39m:160:3
[33mWarn[39m: Visible, non-interactive element `<div>` with a click event must be accompanied by a keyboard event handler. Consider whether an interactive element such as `<button type="button">` or `<a>` might be more appropriate
https://svelte.dev/e/a11y_click_events_have_key_events (svelte)
[36m{#if show}
  [35m<div class="modal-backdrop" on:click={close}>
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
          🔒 <strong>安全承诺</strong>：根据 AGENTS.md 约束，所有 GitHub 令牌仅存储在 Windows Credential Manager（服务名 <code>aster.github</code>），绝不存入 SQLite、不写入日志、不包含在导出包中。
        </div>
      </div>
    </div>
  </div>[36m
{/if}[39m

c:\Aster\[32msrc\components\GithubAuthModal.svelte[39m:160:3
[33mWarn[39m: `<div>` with a click handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions (svelte)
[36m{#if show}
  [35m<div class="modal-backdrop" on:click={close}>
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
          🔒 <strong>安全承诺</strong>：根据 AGENTS.md 约束，所有 GitHub 令牌仅存储在 Windows Credential Manager（服务名 <code>aster.github</code>），绝不存入 SQLite、不写入日志、不包含在导出包中。
        </div>
      </div>
    </div>
  </div>[36m
{/if}[39m

c:\Aster\[32msrc\components\GithubAuthModal.svelte[39m:161:5
[33mWarn[39m: Visible, non-interactive element `<div>` with a click event must be accompanied by a keyboard event handler. Consider whether an interactive element such as `<button type="button">` or `<a>` might be more appropriate
https://svelte.dev/e/a11y_click_events_have_key_events (svelte)
[36m  <div class="modal-backdrop" on:click={close}>
    [35m<div class="modal-card" on:click|stopPropagation>
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
          🔒 <strong>安全承诺</strong>：根据 AGENTS.md 约束，所有 GitHub 令牌仅存储在 Windows Credential Manager（服务名 <code>aster.github</code>），绝不存入 SQLite、不写入日志、不包含在导出包中。
        </div>
      </div>
    </div>[36m
  </div>[39m

c:\Aster\[32msrc\components\GithubAuthModal.svelte[39m:161:5
[33mWarn[39m: `<div>` with a click handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions (svelte)
[36m  <div class="modal-backdrop" on:click={close}>
    [35m<div class="modal-card" on:click|stopPropagation>
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
          🔒 <strong>安全承诺</strong>：根据 AGENTS.md 约束，所有 GitHub 令牌仅存储在 Windows Credential Manager（服务名 <code>aster.github</code>），绝不存入 SQLite、不写入日志、不包含在导出包中。
        </div>
      </div>
    </div>[36m
  </div>[39m

====================================
[33msvelte-check found 0 errors and 10 warnings in 2 files
[39m
```

### Frontend production build

- Command: `npm run build`
- Result: `AUTOMATED_VERIFIED` (exit code 0)

```text
> aster@0.1.0 build
> vite build

[36mvite v7.3.6 [32mbuilding client environment for production...[36m[39m
transforming...
[32m✓[39m 136 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/[22m[32mindex.html                 [39m[1m[2m  0.40 kB[22m[1m[22m[2m │ gzip:  0.28 kB[22m
[2mdist/[22m[35massets/index-jRx6aQsN.css  [39m[1m[2m 44.43 kB[22m[1m[22m[2m │ gzip:  7.57 kB[22m
[2mdist/[22m[36massets/index-D5yLbtXI.js   [39m[1m[2m142.91 kB[22m[1m[22m[2m │ gzip: 47.51 kB[22m
[32m✓ built in 1.75s[39m
```

### Rust unit, contract and flow tests

- Command: `cargo test --manifest-path src-tauri/Cargo.toml`
- Result: `AUTOMATED_VERIFIED` (exit code 0)

```text
running 49 tests
test credentials::tests::credential_service_and_user_constants ... ok
test command_threading_tests::dsh_open_window_stays_async ... ok
test logging::tests::leaves_ordinary_text_untouched ... ok
test db::tests::database_newer_than_code_is_reported_not_downgraded ... ok
test dsh_connector::tests::version_key_orders_semver ... ok
test host_profile::tests::exact_11_profiles_defined ... ok
test dsh_connector::tests::install_rejects_unsafe_version ... ok
test app_data::tests::open_rejects_file_as_root ... ok
test logging::tests::redacts_authorization_header ... ok
test logging::tests::redacts_known_token_shapes ... ok
test logging::tests::redacts_secret_env_values ... ok
test logging::tests::redacts_windows_user_path ... ok
test host_profile::tests::verified_profiles_strictly_gated ... ok
test pi_connector::tests::error_fixture_collects_protocol_errors ... ok
test pi_connector::tests::crash_fixture_ends_without_settled ... ok
test pi_connector::tests::parse_is_strict_jsonl ... ok
test dsh_connector::tests::find_available_port_finds_free_port ... ok
test dsh_connector::tests::find_available_port_skips_occupied_port ... ok
test pi_connector::tests::cancel_fixture_shows_early_end_without_error ... ok
test pi_connector::tests::normal_fixture_shows_streaming_tools_and_settled ... ok
test supervisor::tests::missing_program_is_spawn_error ... ok
test host_profile::tests::expand_path_template_handles_env_and_project ... ok
test host_profile::tests::scan_host_finds_real_directories_and_degrades_gracefully ... ok
test db::tests::migrates_empty_database_to_latest ... ok
test evidence::tests::append_then_query_latest ... ok
test db::tests::partially_migrated_database_advances_only_pending ... ok
test db::tests::migration_0004_recent_projects_and_workdirs ... ok
test db::tests::migrate_is_idempotent ... ok
test evidence::tests::different_key_is_isolated ... ok
test evidence::tests::invalidate_marks_records_stale ... ok
test skill_flow::tests::multi_skill_repo_scanned_and_grouped ... ok
test app_data::tests::open_creates_all_partitions_idempotently ... ok
test logging::tests::logger_writes_redacted_jsonl ... ok
test skill_flow::tests::snapshot_diff_detects_additions_modifications_and_deletions ... ok
test skill_flow::tests::quarantine_isolates_dangerous_files_and_cleans_staging ... ok
test skill_flow::tests::snapshot_diff_truncates_oversized_line_diffs ... ok
test skill_flow::tests::translation_lifecycle_and_stale_detection ... ok
test skill_flow::tests::local_rescan_after_content_change_produces_new_snapshot ... ok
test skill_flow::tests::rollback_refuses_externally_modified_target ... ok
test skill_flow::tests::batch_deployment_plan_and_compensating_rollback ... ok
test supervisor::tests::nonzero_exit_is_classified_failure ... ok
test supervisor::tests::normal_exit_is_classified_clean ... ok
test dsh_connector::tests::probe_full_boot_marker_is_healthy ... ok
test dsh_connector::tests::probe_distinguishes_static_and_boot_layers ... ok
test supervisor::tests::cancelled_long_process_is_classified_terminated ... ok
test dsh_connector::tests::status_reports_not_running_after_process_exit ... ok
test supervisor::tests::wait_timeout_returns_none_while_running ... ok
test skill_flow::tests::snapshot_diff_handles_missing_dirs_and_large_trees ... ok
test dsh_connector::tests::drop_cleans_up_process ... ok

test result: ok. 49 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.76s


running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s


running 8 tests
test contract_deployment_plan_item_host_version ... ok
test contract_batch_deploy_result_and_snapshot_diff ... ok
test contract_skill_item_dto_and_translation_doc ... ok
test contract_deployment_target_fixtures ... ok
test contract_r3_github_and_quarantine_fixtures ... ok
test contract_r3_project_and_host_workdir_fixtures ... ok
test contract_invoke_arg_payloads ... ok
test contract_strict_path_resolution_and_empty_scope ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s


running 1 test
test full_m0_flow_on_real_files ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s


running 1 test
test test_m1_skill_deployment_evidence_and_rollback_flow ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s


running 3 tests
test webapp_only_install_must_not_be_recognized_as_complete_host ... ok
test full_cli_install_is_recognized_as_complete_host ... ok
test test_m2_dsh_connector_discovery_and_port_handling ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.70s


running 1 test
test test_m3_skills_manager_breadth_flow ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.49s


running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### Release process/AppData smoke check

- Command: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-run-check.ps1`
- Result: `AUTOMATED_VERIFIED` (exit code 0)

```text
PROCESS RUNNING: PID 22388
DB CREATED: C:\Users\w1521\AppData\Local\Temp\aster-e2e-check-13880-1787070200\database\aster.db
PROCESS TREE TERMINATED: PID 22388
```

## 能力状态

| 能力 | 本脚本能证明的范围 | 状态 |
|---|---|---|
| 无硬编码业务数据门禁 | 静态扫描规则未命中 | `AUTOMATED_VERIFIED` |
| 前端/Rust 契约与流程 | 固定 fixture 和临时文件系统测试通过 | `AUTOMATED_VERIFIED` |
| release 启动与数据库创建 | 隔离 AppData 冒烟通过 | `AUTOMATED_VERIFIED` |
| Skills 列表/详情 | 2026-08-18 晚间真实 UI 复审通过（七步验收第 1–2 步） | `MANUAL_VERIFIED` |
| Diff | 2026-08-18 晚间真实 UI 复审通过（七步验收第 3 步）；白天审计观察到的卡住已不可复现 | `MANUAL_VERIFIED` |
| 计划→部署→evidence→回滚 | 2026-08-18 晚间真实 UI 复审通过（七步验收第 4–7 步，隔离数据目录 + 测试部署作用域） | `MANUAL_VERIFIED` |

本脚本不会生成 R1 `complete` 结论。里程碑状态以 [docs/status.md](../status.md) 为准。
