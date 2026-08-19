<script lang="ts">
  import { tick } from "svelte";
  import { renderMarkdown } from "../../lib/markdown";
  import { piConsoleStore } from "../../lib/pi/piConsoleStore";
  import type { PiMessage } from "../../types";

  let transcriptEl: HTMLElement;
  let stickToBottom = true;

  $: messages = $piConsoleStore.messages;
  $: streamingText = $piConsoleStore.streamingText;
  $: streaming = $piConsoleStore.sessionStatus === "streaming";
  $: messages, streamingText, scrollIfNeeded();

  async function scrollIfNeeded() {
    await tick();
    if (!transcriptEl || !stickToBottom) return;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function onScroll() {
    if (!transcriptEl) return;
    const gap = transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight;
    stickToBottom = gap < 48;
  }

  function textFromContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content, null, 2);
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const rec = block as Record<string, unknown>;
        if (rec.type === "text" && typeof rec.text === "string") return rec.text;
        if (rec.type === "thinking" && typeof rec.thinking === "string") return rec.thinking;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  function toolsFromContent(content: unknown): { name: string; args: string; isError?: boolean }[] {
    if (!Array.isArray(content)) return [];
    const out: { name: string; args: string; isError?: boolean }[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const rec = block as Record<string, unknown>;
      if (rec.type === "toolCall") {
        out.push({
          name: String(rec.name ?? "tool"),
          args: JSON.stringify(rec.arguments ?? rec.args ?? {}, null, 2),
        });
      }
    }
    return out;
  }

  function roleLabel(msg: PiMessage): string {
    if (msg.role === "user") return "你";
    if (msg.role === "toolResult") return "工具结果";
    if (msg.role === "system") return "系统";
    return "Pi";
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.debug("copy failed:", err);
    }
  }
</script>

<div class="pi-transcript" bind:this={transcriptEl} on:scroll={onScroll} aria-live="polite">
  {#if messages.length === 0 && !streamingText}
    <div class="empty faint">从左侧选择会话后，将通过 Pi RPC 恢复原生消息。</div>
  {/if}

  {#each messages as msg, i (`${msg.role}-${i}`)}
    <article class="msg" class:user={msg.role === "user"}>
      <div class="role">{roleLabel(msg)}</div>
      <div class="bubble">
        {#if msg.role === "user"}
          <div class="plain">{textFromContent(msg.content)}</div>
        {:else}
          <div class="md-body">{@html renderMarkdown(textFromContent(msg.content))}</div>
        {/if}
        {#each toolsFromContent(msg.content) as tool, ti (`${i}-${ti}`)}
          <details class="tool" class:err={tool.isError}>
            <summary>{tool.name}{tool.isError ? " · 失败" : ""}</summary>
            <pre><code>{tool.args}</code></pre>
            <button type="button" class="copy" on:click={() => copyText(tool.args)}>复制</button>
          </details>
        {/each}
      </div>
    </article>
  {/each}

  {#if streamingText}
    <article class="msg">
      <div class="role">Pi · 生成中</div>
      <div class="bubble">
        <div class="md-body">{@html renderMarkdown(streamingText)}</div>
      </div>
    </article>
  {/if}
</div>

<style>
  .pi-transcript {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .empty {
    margin: auto;
    font-size: 13px;
  }
  .msg {
    width: 100%;
    max-width: 720px;
    margin-bottom: 18px;
  }
  .role {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--faint);
    margin-bottom: 4px;
  }
  .bubble {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: 14px 16px;
    font-size: 13.5px;
    line-height: 1.7;
  }
  .msg.user .bubble {
    background: var(--surface-2);
  }
  .plain {
    white-space: pre-wrap;
  }
  .md-body :global(pre) {
    overflow-x: auto;
    background: var(--surface-2);
    padding: 10px;
    border-radius: var(--r-sm);
  }
  .tool {
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 6px 10px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .tool.err {
    border-color: var(--danger);
  }
  .tool pre {
    max-height: 240px;
    overflow: auto;
    white-space: pre;
    margin: 8px 0;
  }
  .copy {
    font-size: 11px;
    color: var(--muted);
  }
</style>
