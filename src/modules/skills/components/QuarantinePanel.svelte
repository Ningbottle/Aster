<script lang="ts">
  import type { QuarantineItem } from "../../../types";

  export let items: QuarantineItem[] = [];
  export let loading = false;
  export let message = "";
  export let isError = false;
  export let onRefresh: () => Promise<void>;
  export let onDelete: (quarantineId: string) => Promise<void>;
</script>

<div class="panel-row">
  <span class="desc">
    静态安全检测拦截的可疑/违规 Skill 归档区。根据安全不变量，隔离文件禁止一键恢复，仅提供详情排查与彻底物理删除。
  </span>
  <button type="button" class="btn sm" disabled={loading} on:click={onRefresh}>
    {loading ? "刷新中..." : "刷新隔离列表"}
  </button>
</div>

{#if message}
  <div class="msg">
    <div class="tag {isError ? 'err' : 'info'}">{message}</div>
  </div>
{/if}

<div class="quarantine-container">
  {#if items.length === 0}
    <div class="empty">
      <div class="empty-title">隔离区空闲</div>
      <p>暂无被拦截隔离的危险 Skill，所有已扫描的技能均通过了静态安全检查。</p>
    </div>
  {:else}
    <div class="quarantine-list">
      {#each items as q (q.quarantine_id)}
        <div class="quarantine-card">
          <div class="qc-head">
            <div>
              <span class="tag err sm">已隔离</span>
              <strong class="qc-title">{q.quarantine_id}</strong>
              <span class="qc-source faint">来源: {q.source_info} · 拦截时间: {q.quarantined_at}</span>
            </div>
            <button
              type="button"
              class="btn sm danger-ghost"
              on:click={() => onDelete(q.quarantine_id)}
            >
              彻底删除
            </button>
          </div>

          <div class="qc-reason">
            <strong>拦截原因:</strong> {q.reason} (发现 {q.total_findings} 处静态违规项)
          </div>

          {#if q.findings && q.findings.length > 0}
            <div class="qc-findings">
              <table class="findings-table">
                <thead>
                  <tr>
                    <th>违规文件</th>
                    <th>违规类型</th>
                    <th>详细描述</th>
                  </tr>
                </thead>
                <tbody>
                  {#each q.findings as f (f.relative_path + f.finding_type + f.problem)}
                    <tr>
                      <td><code>{f.relative_path}</code></td>
                      <td><span class="tag sm err">{f.finding_type}</span></td>
                      <td>{f.problem}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 0 0 12px;
  }
  .desc {
    font-size: 12px;
    color: var(--muted);
    margin: 0;
    flex: 1;
  }
  .msg {
    padding: 0 0 12px;
  }
  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--muted);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
  }
  .empty-title {
    font-size: 14px;
    font-weight: 550;
    margin-bottom: 6px;
    color: var(--fg);
  }
  .empty p {
    font-size: 12px;
    margin: 0;
  }
  .quarantine-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .quarantine-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .quarantine-card {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--danger, #ef4444);
    border-radius: var(--r-md);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .qc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .qc-title {
    font-size: 13.5px;
    color: var(--fg);
    font-family: var(--font-mono);
    margin-left: 6px;
  }
  .qc-source {
    display: block;
    font-size: 11.5px;
    margin-top: 2px;
  }
  .qc-reason {
    font-size: 12.5px;
    color: var(--fg);
    background: var(--surface-2);
    padding: 8px 12px;
    border-radius: 6px;
  }
  .qc-findings {
    margin-top: 4px;
    overflow-x: auto;
  }
  .findings-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .findings-table th {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-weight: 600;
  }
  .findings-table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
  }
</style>
