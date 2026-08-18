<script lang="ts">
  import type { AppStatus } from "../types";

  export let status: AppStatus | null = null;
  export let skillStatus: Record<string, unknown> | null = null;

  type DeploymentRow = {
    id: number;
    skill: string;
    target: string;
    scope: string;
    state: string;
    time: string;
  };

  type EvidenceRow = {
    key: string;
    stage: string;
    status: string;
    observer: string;
    observed_at: string;
  };

  $: rawDeployments = skillStatus?.deployments as Array<Record<string, unknown>> | undefined;
  $: deployments = (rawDeployments && rawDeployments.length)
    ? rawDeployments.map((d) => ({
        id: Number(d.id),
        skill: String(d.snapshot_id || "skill"),
        target: String(d.target_host || "pi"),
        scope: String(d.scope || "user"),
        state: String(d.state || "deployed"),
        time: String(d.deployed_at || "—"),
      }))
    : [];

  $: rawEvidence = skillStatus?.evidence as Array<Record<string, unknown>> | undefined;
  $: evidenceList = (rawEvidence && rawEvidence.length)
    ? rawEvidence.map((e) => ({
        key: String(e.key || "—"),
        stage: String(e.stage || "discovered"),
        status: String(e.status || "unknown"),
        observer: String(e.observer || "Aster"),
        observed_at: String(e.observed_at || "—"),
      }))
    : [];
</script>

<div class="view-scroll">
  <div class="page-head">
    <div>
      <h1>基础设施与证据</h1>
      <p class="desc">应用状态、部署记录与分级 Evidence，如实呈现，不做布尔化的“已兼容”</p>
    </div>
  </div>

  <div class="page-body">
    <div class="infra-grid">
      <div class="card card-pad">
        <div class="section-h" style="margin-top:0">应用状态 <span class="hint">get_app_status</span></div>
        <dl class="kv">
          <dt>app_version</dt>
          <dd class="mono">{status?.app_version || "—"}</dd>
          <dt>数据目录</dt>
          <dd class="mono">{status?.app_data_dir || "—"}</dd>
          <dt>schema 版本</dt>
          <dd class="mono">{status ? status.database_schema_version : "—"} (迁移 0001-0003)</dd>
          <dt>证据总数</dt>
          <dd class="mono">{status ? status.evidence_count : 0}</dd>
          <dt>支持平台</dt>
          <dd>Windows 10 22H2 / 11 x64</dd>
        </dl>
      </div>

      <div class="card">
        <div class="section-h" style="margin:14px 18px 4px">部署记录 <span class="hint">skill_deployment</span></div>
        {#if deployments.length === 0}
          <div style="padding: 24px; text-align: center; color: var(--muted); font-size: 12.5px;">
            暂无部署记录（尚未执行 Skill 部署）
          </div>
        {:else}
          <table class="table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>目标</th>
                <th>作用域</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {#each deployments as dep (dep.id)}
                <tr>
                  <td class="mono">{dep.skill}</td>
                  <td>{dep.target}</td>
                  <td>{dep.scope}</td>
                  <td>
                    <span class="tag" class:ok={dep.state === "deployed"} class:err={dep.state === "rolled_back"}>
                      {dep.state}
                    </span>
                  </td>
                  <td class="faint">{dep.time}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-h" style="margin:14px 18px 4px">
        分级 Evidence <span class="hint">七阶段：discovered → … → callable_verified</span>
      </div>
      {#if evidenceList.length === 0}
        <div style="padding: 24px; text-align: center; color: var(--muted); font-size: 12.5px;">
          暂无 Evidence 观察记录（执行测试流水线或部署后将记录观察证据）
        </div>
      {:else}
        <table class="table">
          <thead>
            <tr>
              <th>快照 × 宿主</th>
              <th>阶段</th>
              <th>状态</th>
              <th>observer</th>
              <th>observed_at</th>
            </tr>
          </thead>
          <tbody>
            {#each evidenceList as ev, i (i)}
              <tr>
                <td class="mono">{ev.key}</td>
                <td>{ev.stage}</td>
                <td>
                  <span
                    class="tag"
                    class:ok={ev.status === "success"}
                    class:warn={ev.status === "unknown"}
                    class:neutral={ev.status === "stale"}
                    class:err={ev.status === "failure"}
                  >
                    {ev.status}
                  </span>
                </td>
                <td class="mono">{ev.observer}</td>
                <td class="faint">{ev.observed_at}</td>
              </tr>
            {/each}
          </tbody>
        </table>
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
  .infra-grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 16px;
    align-items: start;
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
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
  }
  .card-pad {
    padding: 16px 18px;
  }
  .kv {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 8px 12px;
    font-size: 12.5px;
  }
  .kv dt {
    color: var(--faint);
    font-size: 11.5px;
    padding-top: 1px;
  }
  .kv dd {
    word-break: break-all;
    color: var(--fg);
  }
  .kv dd.mono,
  .mono {
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .table th {
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--faint);
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
    color: var(--fg);
  }
  .table tr:last-child td {
    border-bottom: none;
  }
  .table tbody tr:hover {
    background: var(--surface-2);
  }
  .faint {
    color: var(--faint);
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
  .tag.err {
    background: oklch(0.95 0.03 27);
    color: oklch(0.46 0.15 27);
  }
  .tag.warn {
    background: oklch(0.95 0.05 78);
    color: oklch(0.45 0.1 70);
  }
  .tag.neutral {
    background: var(--surface-2);
    color: var(--muted);
  }
  @media (max-width: 880px) {
    .infra-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
