<script lang="ts">
  import type { DshStatus, PiRuntime, ViewId } from "../types";

  export let piRuntimes: PiRuntime[] = [];
  export let dshStatus: DshStatus | null = null;
  export let totalSkillsCount: number = 0;
  export let onSelectView: (id: ViewId) => void;
  export let onOpenPiChat: () => void;

  $: hasPi = piRuntimes.some((r) => r.version === "0.84.2");
  $: isDshRunning = !!dshStatus?.running;
</script>

<div class="show-wrap">
  <div class="show-inner">
    <div class="show-hero">
      <h1 class="show-title">Aster 工作台</h1>
      <p class="show-sub">本机的多宿主智能体工作台。在一个窗口里管理 Pi 会话、DeepSeek Harness 原生界面，以及各个 AI 工具里安装的 skills。</p>
      <div class="show-status">
        <span class="ss">
          <span class="status-dot" class:run={hasPi} class:warn={!hasPi}></span>
          Pi · {hasPi ? "RPC 已就绪" : "待安装 (0.84.2)"}
        </span>
        <span class="ss">
          <span class="status-dot" class:run={isDshRunning} class:idle={!isDshRunning}></span>
          DeepSeek Harness · <span class="mono">{isDshRunning ? (dshStatus?.url ? dshStatus.url.replace("http://", "") : "127.0.0.1") : "未启动"}</span>
        </span>
        <span class="ss">
          <span class="status-dot" class:run={totalSkillsCount > 0} class:idle={totalSkillsCount === 0}></span>
          Skills-Hub · {totalSkillsCount} 个 skills / 11 个工具
        </span>
      </div>
    </div>

    <div class="show-grid">
      <button type="button" class="ws-card" on:click={() => onSelectView("pi")}>
        <span class="ws-icon">π</span>
        <span class="ws-name">Pi 工作台</span>
        <span class="ws-desc">与 Pi 的本地会话：RPC 子进程驱动，流式返回，会话写入独立工作目录。</span>
        <span class="ws-go">
          打开
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </span>
      </button>

      <button type="button" class="ws-card" on:click={() => onSelectView("dsh")}>
        <span class="ws-icon">DS</span>
        <span class="ws-name">DeepSeek Harness</span>
        <span class="ws-desc">本地服务的原生 Web UI，直接进入即启动；插件由 cordis 上下文驱动。</span>
        <span class="ws-go">
          打开
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </span>
      </button>

      <button type="button" class="ws-card" on:click={() => onSelectView("skills")}>
        <span class="ws-icon">Sk</span>
        <span class="ws-name">Skills-Hub</span>
        <span class="ws-desc">查看各个 AI 工具里安装的 skill，按工具名浏览与核对。</span>
        <span class="ws-go">
          打开
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </span>
      </button>
    </div>

    <div class="show-cols">
      <div>
        <h2>权限</h2>
        <div class="proj-item perm-item">
          <svg class="folder-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M8 1.8l4.8 1.9v4.1c0 2.9-1.9 4.9-4.8 6-2.9-1.1-4.8-3.1-4.8-6V3.7L8 1.8z" />
          </svg>
          <span>Pi<span class="sub">本地 RPC 会话，写入独立工作目录</span></span>
        </div>
        <div class="proj-item perm-item">
          <svg class="folder-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M8 1.8l4.8 1.9v4.1c0 2.9-1.9 4.9-4.8 6-2.9-1.1-4.8-3.1-4.8-6V3.7L8 1.8z" />
          </svg>
          <span>DeepSeek Harness<span class="sub">仅监听 127.0.0.1，不暴露到局域网</span></span>
        </div>
        <div class="proj-item perm-item">
          <svg class="folder-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M8 1.8l4.8 1.9v4.1c0 2.9-1.9 4.9-4.8 6-2.9-1.1-4.8-3.1-4.8-6V3.7L8 1.8z" />
          </svg>
          <span>Skills-Hub<span class="sub">扫描只读，部署确认 Plan 后才写入</span></span>
        </div>
      </div>

      <div>
        <h2>最近会话</h2>
        <div class="recent-empty" style="padding: 16px; color: var(--muted); font-size: 12.5px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); text-align: center;">
          暂无历史会话记录。<br />
          <button
            type="button"
            class="btn sm"
            style="margin-top: 10px;"
            on:click={() => {
              onSelectView("pi");
              onOpenPiChat();
            }}
          >
            发起新会话
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .show-wrap {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 52px 40px 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .show-inner {
    width: 100%;
    max-width: 920px;
  }
  .show-hero {
    text-align: center;
    margin-bottom: 36px;
  }
  .show-title {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 600;
    line-height: 1.35;
    margin-bottom: 8px;
    color: var(--fg);
  }
  .show-sub {
    font-size: 13px;
    color: var(--muted);
    max-width: 560px;
    margin: 0 auto 20px;
  }
  .show-status {
    display: flex;
    justify-content: center;
    gap: 20px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--muted);
    margin-top: 20px;
  }
  .show-status .ss {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .show-status .mono {
    font-size: 11px;
    color: var(--faint);
    font-family: var(--font-mono);
  }
  .show-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
    margin-bottom: 30px;
  }
  .ws-card {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
    transition: border-color 0.12s ease, box-shadow 0.16s ease;
    cursor: pointer;
  }
  .ws-card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-2);
  }
  .ws-card .ws-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    flex: none;
    background: var(--fg);
    color: var(--surface);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 700;
  }
  .ws-card .ws-name {
    font-size: 13.5px;
    font-weight: 600;
    font-family: var(--font-display);
    color: var(--fg);
  }
  .ws-card .ws-desc {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.65;
  }
  .ws-card .ws-go {
    margin-top: auto;
    font-size: 12px;
    color: var(--faint);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .ws-card:hover .ws-go {
    color: var(--fg);
  }
  .ws-card .ws-go svg {
    width: 12px;
    height: 12px;
  }
  .show-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .show-cols h2 {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--faint);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .proj-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    color: var(--muted);
    width: 100%;
    text-align: left;
  }
  .perm-item {
    cursor: default;
  }
  .proj-item .folder-ic {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--faint);
  }
  .proj-item .sub {
    display: block;
    font-size: 11px;
    color: var(--faint);
  }
  .recent-empty {
    padding: 18px 14px;
    color: var(--muted);
    font-size: 12.5px;
    background: var(--surface);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
    text-align: center;
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
  @media (max-width: 880px) {
    .show-cols {
      grid-template-columns: 1fr;
    }
    .show-wrap {
      padding: 36px 20px 32px;
    }
  }
</style>
