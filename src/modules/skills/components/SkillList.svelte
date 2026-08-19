<script lang="ts">
  import type { SkillItem } from "../../../types";

  export let skills: SkillItem[] = [];
  export let onOpen: (id: string) => void;
</script>

<div class="skills-grid">
  {#if skills.length === 0}
    <div class="skills-empty">
      <div class="empty-title">暂无已快照的技能</div>
      <p>
        当前 SQLite 中未记录任何技能快照。可在上方切换「本地目录」或「GitHub 仓库」扫描技能。
      </p>
    </div>
  {:else}
    {#each skills as s, i (s.id)}
      <button
        type="button"
        class="skill-card"
        style="animation-delay: {Math.min(i, 5) * 30}ms;"
        on:click={() => onOpen(s.id)}
      >
        <span class="sc-name">{s.skill_name || s.id}</span>
        <span class="sc-desc">{s.desc}</span>
        <span class="sc-foot">
          {#each s.tools as tool}
            <span class="sc-tool">{tool}</span>
          {/each}
          <span class="sc-date">{s.updated}</span>
        </span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .skills-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }
  .skill-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-1);
    padding: 14px 16px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.12s ease, box-shadow 0.16s ease;
    cursor: pointer;
    animation: cardIn 0.17s cubic-bezier(0.2, 0, 0, 1) both;
  }
  .skill-card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-2);
  }
  .sc-name {
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fg);
  }
  .sc-desc {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.6;
  }
  .sc-foot {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .sc-tool {
    font-size: 10.5px;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .sc-date {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--faint);
  }
  .skills-empty {
    grid-column: 1 / -1;
    text-align: center;
    padding: 48px 24px;
    color: var(--muted);
    font-size: 12.5px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
  }
  .empty-title {
    font-size: 15px;
    font-weight: 550;
    margin-bottom: 6px;
    color: var(--fg);
  }
  .skills-empty p {
    font-size: 12.5px;
    max-width: 480px;
    margin: 0 auto 16px;
  }
  @keyframes cardIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
