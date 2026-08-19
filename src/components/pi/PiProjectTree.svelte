<script lang="ts">
  import type { PiProjectNode } from "../../types";

  export let projects: PiProjectNode[] = [];
  export let error: string | null = null;
  export let treeStatus: string = "idle";
  export let openProjectPicker: () => Promise<void>;
  export let createSession: (projectPath: string) => Promise<void>;
  export let openSession: (projectPath: string, sessionId: string) => Promise<void>;

  let expanded = new Set<string>();

  function toggleProject(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expanded = next;
  }

  function formatUnnamedSession(iso: string): string {
    return `未命名会话 · ${new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso))}`;
  }

  function formatRelativeTime(iso: string): string {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  }

  function availabilityLabel(availability: string): string {
    if (availability === "missing") return "缺失";
    if (availability === "project_missing") return "项目缺失";
    if (availability === "unsupported") return "未验证";
    return "";
  }
</script>

<nav class="pi-project-tree" aria-label="Pi 项目与会话">
  <button type="button" class="open-project" on:click={() => openProjectPicker()}>
    打开项目
  </button>

  {#if treeStatus === "loading"}
    <p class="hint">正在读取原生会话索引…</p>
  {/if}

  {#if error}
    <p class="err" role="alert">{error}</p>
  {/if}

  {#if treeStatus === "ready" && projects.length === 0}
    <p class="hint">还没有可展示的项目。打开一个工作目录后，Pi 会按该目录组织原生会话。</p>
  {/if}

  {#each projects as project (project.path)}
    <section class="project-group">
      <div class="project-row">
        <button
          type="button"
          class="project-toggle"
          aria-expanded={expanded.has(project.path)}
          on:click={() => toggleProject(project.path)}
        >
          <span class="chev">{expanded.has(project.path) ? "▾" : "▸"}</span>
          <span class="name" title={project.path}>{project.displayName}</span>
        </button>
        <button
          type="button"
          class="new-session"
          aria-label={`在 ${project.displayName} 中新建会话`}
          on:click={() => createSession(project.path)}
        >+</button>
      </div>

      {#if expanded.has(project.path)}
        <ul>
          {#each project.sessions as session (session.sessionId)}
            <li>
              <button
                type="button"
                class="session-btn"
                class:active={session.isActive}
                disabled={session.availability !== "available"}
                on:click={() => openSession(project.path, session.sessionId)}
              >
                <span class="session-name">
                  {session.name || formatUnnamedSession(session.modifiedAt)}
                </span>
                {#if session.availability !== "available"}
                  <span class="avail">{availabilityLabel(session.availability)}</span>
                {/if}
                <time datetime={session.modifiedAt}>{formatRelativeTime(session.modifiedAt)}</time>
              </button>
            </li>
          {/each}
          {#if project.sessions.length === 0}
            <li class="empty">此项目还没有已索引的 Pi 会话</li>
          {/if}
        </ul>
      {/if}
    </section>
  {/each}
</nav>

<style>
  .pi-project-tree {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .open-project {
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    font-size: 12.5px;
    font-weight: 550;
  }
  .open-project:hover {
    background: var(--surface-2);
  }
  .hint,
  .err,
  .empty {
    font-size: 12px;
    color: var(--muted);
    padding: 4px 8px;
    line-height: 1.5;
  }
  .err {
    color: var(--danger);
  }
  .project-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .project-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .project-toggle:hover {
    background: var(--border);
  }
  .project-toggle .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 550;
  }
  .chev {
    color: var(--faint);
    width: 12px;
    flex: none;
  }
  .new-session {
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--r-sm);
    font-size: 16px;
    line-height: 1;
    color: var(--muted);
  }
  .new-session:hover {
    background: var(--border);
    color: var(--fg);
  }
  ul {
    list-style: none;
    padding: 0 0 6px 18px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .session-btn {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 5px 8px;
    border-radius: var(--r-sm);
    text-align: left;
    color: var(--muted);
  }
  .session-btn:hover:not(:disabled) {
    background: var(--border);
    color: var(--fg);
  }
  .session-btn.active {
    background: var(--surface);
    color: var(--fg);
    box-shadow: var(--shadow-1);
  }
  .session-btn:disabled {
    opacity: 0.65;
    cursor: default;
  }
  .session-name {
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
  .session-btn time,
  .avail {
    font-size: 11px;
    color: var(--faint);
  }
</style>
