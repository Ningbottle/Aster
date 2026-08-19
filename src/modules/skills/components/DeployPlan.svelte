<script lang="ts">
  import type { DeploymentPlan } from "../../../types";

  export let plan: DeploymentPlan;
  export let applying = false;
  export let onClose: () => void;
  export let onApply: () => Promise<void>;
</script>

<section class="card sp-block plan">
  <div class="sp-block-h">
    <span>批量部署计划 (Batch Deployment Plan)</span>
    <span class="hint">共 {plan.total_targets} 个目标，{plan.ready_targets} 个就绪</span>
  </div>
  <div class="deploy-plan-list">
    {#each plan.items as item (item.host_id + item.target_path)}
      <div class="deploy-plan-item" class:blocked={item.status !== "ready"}>
        <div>
          <strong>{item.host_display_name || item.host_id}</strong>
          <span class="tag neutral sm">{item.scope_kind}</span>
          <div class="faint path">{item.target_path}</div>
        </div>
        <div class="status">
          {#if item.status === "ready"}
            <span class="tag ok sm">就绪 (复制)</span>
          {:else if item.status === "already_deployed_by_aster"}
            <span class="tag info sm">已由 Aster 部署</span>
          {:else if item.status === "blocked_unmanaged_conflict"}
            <span class="tag warn sm" title={item.reason || "目录存在外部文件"}>存在外部文件 (保护跳过)</span>
          {:else}
            <span class="tag err sm">{item.status}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  <div class="actions">
    <button type="button" class="btn sm" on:click={onClose}>关闭计划</button>
    <button
      type="button"
      class="btn sm primary"
      disabled={!plan.can_apply || applying}
      on:click={onApply}
    >
      {applying ? "正在写入与记录证据..." : "确认应用批量部署"}
    </button>
  </div>
</section>

<style>
  .plan {
    border-color: var(--accent);
  }
  .sp-block {
    padding: 18px 20px;
  }
  .sp-block-h {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--accent);
    margin-bottom: 10px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .hint {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: var(--faint);
  }
  .deploy-plan-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  .deploy-plan-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-size: 12.5px;
  }
  .deploy-plan-item.blocked {
    border-color: var(--warn);
    background: oklch(0.97 0.02 80);
  }
  .tag.neutral.sm {
    margin-left: 6px;
  }
  .path {
    font-size: 11px;
    margin-top: 2px;
  }
  .status {
    text-align: right;
  }
  .actions {
    margin-top: 14px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
</style>
