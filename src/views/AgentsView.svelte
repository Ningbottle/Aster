<script lang="ts">
  import type { DiscoveredHost, DshStatus, PiRuntime, ViewId } from "../types";

  export let piRuntimes: PiRuntime[] = [];
  export let dshStatus: DshStatus | null = null;
  export let discoveredHosts: DiscoveredHost[] = [];
  export let onSelectView: (id: ViewId) => void;

  $: hasPi = piRuntimes.some((r) => r.version === "0.84.2");
  $: isDshRunning = !!dshStatus?.running;
</script>

<div class="view-scroll">
  <div class="page-head">
    <div>
      <h1>智能体与宿主</h1>
      <p class="desc">两个活跃 connector 驱动会话；其余工具以只读 HostProfile 接入 Skills-Hub</p>
    </div>
  </div>

  <div class="page-body">
    <div class="section-h" style="margin-top:0">活跃 Connector <span class="hint">可发起会话的宿主</span></div>
    <div class="host-cards">
      <div class="card host-card">
        <div class="hc-top">
          <span class="hc-icon">π</span>
          <div>
            <div class="hc-name">Pi</div>
            <div class="hc-ver">锁定 0.84.2 · managed，严格 JSONL RPC</div>
          </div>
          {#if hasPi}
            <span class="tag ok" style="margin-left:auto">verified_and_ready</span>
          {:else}
            <span class="tag warn" style="margin-left:auto">未检测到安装</span>
          {/if}
        </div>
        <p class="hc-desc">
          以子进程运行，流式状态机解析事件；会话在 Aster 内的 Pi 工作台进行，事件经 pi-event 推送。进程退出由 supervisor 分类：CleanExit / FailureExit / TerminatedByAster。
        </p>
        <div class="hc-foot">
          <button type="button" class="btn sm" on:click={() => onSelectView("pi")}>打开 Pi 工作台</button>
          <span class="faint" style="font-size:11px">pi-workspace 独立工作目录</span>
        </div>
      </div>

      <div class="card host-card">
        <div class="hc-top">
          <span class="hc-icon alt">DS</span>
          <div>
            <div class="hc-name">DeepSeek Harness</div>
            <div class="hc-ver">锁定 0.1.0-rc.6 · managed，原生 Web UI</div>
          </div>
          {#if isDshRunning}
            <span class="tag ok" style="margin-left:auto">running</span>
          {:else}
            <span class="tag faint" style="margin-left:auto">stopped</span>
          {/if}
        </div>
        <p class="hc-desc">
          以 localhost 服务运行，原生界面内嵌于 DSH 页面（WebView2，仅限 127.0.0.1 来源）。DSH 的插件与自定义模式由其原生 UI 提供；Aster 不另做插件系统，避免两套真相。
        </p>
        <div class="hc-foot">
          <button type="button" class="btn sm" on:click={() => onSelectView("dsh")}>打开 DSH 控制台</button>
          <span class="faint" style="font-size:11px">dsh-workspace 独立工作目录</span>
        </div>
      </div>
    </div>

    <div class="section-h">只读宿主档案 <span class="hint">host_profiles_list · 用于 Skill 部署目标与扫描</span></div>
    <div class="profile-grid">
      {#if discoveredHosts.length > 0}
        {#each discoveredHosts as h (h.profile.id)}
          <div class="card profile-card">
            <div class="pc-top">
              <span
                class="status-dot"
                class:run={h.profile.confidence === "verified"}
                class:warn={h.profile.confidence === "experimental"}
                class:idle={h.profile.confidence === "scan-only"}
              ></span>
              <span class="pc-name">{h.profile.display_name}</span>
              <span
                class="tag"
                class:ok={h.profile.confidence === "verified"}
                class:warn={h.profile.confidence === "experimental"}
                class:neutral={h.profile.confidence === "scan-only"}
                style="margin-left:auto"
              >
                {h.profile.confidence}
              </span>
            </div>
            <div class="pc-meta">
              {h.profile.discovery_shape} 发现 · {h.discovered_scopes.length} 个作用域
              {#if h.installed}
                ，已检测到安装
              {:else}
                ，未检测到安装
              {/if}
            </div>
          </div>
        {/each}
      {:else}
        <div style="grid-column: 1 / -1; padding: 32px 20px; text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: var(--r-md); font-size: 13px;">
          暂无已加载的宿主档案（正在读取 host_profiles_list 或宿主扫描未就绪）
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .view-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .page-head {
    flex: none;
    padding: 18px 28px 0;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
  }
  .page-head h1 {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--fg);
  }
  .page-head .desc {
    font-size: 12.5px;
    color: var(--muted);
    margin-top: 2px;
  }
  .page-body {
    padding: 16px 28px 32px;
  }
  .section-h {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    margin: 22px 0 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--fg);
  }
  .section-h .hint {
    font-size: 11.5px;
    color: var(--faint);
    font-weight: 400;
  }
  .host-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
    margin-bottom: 20px;
  }
  .host-card {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
  }
  .host-card .hc-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .host-card .hc-icon {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    flex: none;
    background: var(--fg);
    color: var(--surface);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
  }
  .host-card .hc-icon.alt {
    background: var(--surface-2);
    color: var(--fg);
    border: 1px solid var(--border-strong);
  }
  .host-card .hc-name {
    font-size: 14px;
    font-weight: 600;
    font-family: var(--font-display);
    color: var(--fg);
  }
  .host-card .hc-ver {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--faint);
  }
  .host-card .hc-desc {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.65;
  }
  .host-card .hc-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: auto;
  }
  .profile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }
  .profile-card {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
  }
  .profile-card .pc-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .profile-card .pc-name {
    font-size: 12.5px;
    font-weight: 550;
    color: var(--fg);
  }
  .profile-card .pc-meta {
    font-size: 11px;
    color: var(--faint);
    line-height: 1.55;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
    flex: none;
  }
  .status-dot.run {
    background: var(--success);
    box-shadow: 0 0 0 3px oklch(0.6 0.13 152 / 0.18);
  }
  .status-dot.idle {
    background: var(--faint);
  }
  .status-dot.warn {
    background: var(--warn);
  }
  .tag {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 550;
    letter-spacing: 0.02em;
  }
  .tag.ok {
    background: oklch(0.94 0.04 152);
    color: oklch(0.42 0.11 152);
  }
  .tag.warn {
    background: oklch(0.95 0.05 78);
    color: oklch(0.45 0.1 70);
  }
  .tag.neutral {
    background: var(--surface-2);
    color: var(--muted);
  }
</style>
