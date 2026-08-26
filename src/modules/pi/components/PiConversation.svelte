<script lang="ts">
  import { tick } from "svelte";
  import { renderMarkdown } from "../../../platform/markdown";
  import { piConsoleStore } from "../store";
  import {
    assistantTextFromContent,
    thinkingFromContent,
  } from "../sessionReducer";
  import type { PiMessage } from "../../../types";

  let transcriptEl: HTMLElement;
  let stickToBottom = true;

  $: messages = $piConsoleStore.messages;
  $: streamingText = $piConsoleStore.streamingText;
  $: streamingThinking = $piConsoleStore.streamingThinking;
  $: liveTools = $piConsoleStore.liveTools;
  $: streaming = $piConsoleStore.sessionStatus === "streaming";
  $: messages, streamingText, streamingThinking, liveTools, scrollIfNeeded();

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
    const text = assistantTextFromContent(content);
    if (text) return text;
    if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content, null, 2);
    return "";
  }

  function toolsFromMessage(msg: PiMessage): { name: string; args: string; isError?: boolean }[] {
    if (msg.role === "toolResult" && msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
      const rec = msg.content as Record<string, unknown>;
      return [{
        name: String(rec.name ?? rec.toolName ?? "tool"),
        args: JSON.stringify(rec, null, 2),
        isError: rec.isError === true,
      }];
    }
    return toolsFromContent(msg.content);
  }

  function toolsFromContent(content: unknown): { name: string; args: string; isError?: boolean }[] {
    if (!Array.isArray(content)) return [];
    const out: { name: string; args: string; isError?: boolean }[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const rec = block as Record<string, unknown>;
      if (rec.type === "toolCall" || rec.type === "toolResult") {
        const result = rec.result && typeof rec.result === "object"
          ? (rec.result as Record<string, unknown>)
          : null;
        out.push({
          name: String(rec.name ?? rec.toolName ?? "tool"),
          args: JSON.stringify(rec.arguments ?? rec.args ?? rec.content ?? rec.result ?? {}, null, 2),
          isError: rec.isError === true || result?.isError === true,
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

  function toolSummary(tool: { name: string; isError?: boolean; status?: string }): string {
    if (tool.status === "running") return `${tool.name} · 执行中`;
    return `${tool.name}${tool.isError ? " · 失败" : ""}`;
  }
</script>

<div class="pi-transcript" bind:this={transcriptEl} on:scroll={onScroll} aria-live="polite">
  {#if messages.length === 0 && !streamingText && !streamingThinking && liveTools.length === 0}
    <div class="empty faint">从左侧选择会话后，将通过 Pi RPC 恢复原生消息。</div>
  {/if}

  {#each messages as msg, i (`${msg.role}-${i}`)}
    {@const thinking = thinkingFromContent(msg.content)}
    <article class="msg" class:user={msg.role === "user"}>
      <div class="role">{roleLabel(msg)}</div>
      <div class="bubble">
        {#if thinking}
          <details class="thinking">
            <summary>思考</summary>
            <pre class="plain">{thinking}</pre>
          </details>
        {/if}
        {#if msg.role === "user"}
          <div class="plain">{textFromContent(msg.content)}</div>
        {:else if textFromContent(msg.content)}
          <div class="md-body">{@html renderMarkdown(textFromContent(msg.content))}</div>
        {/if}
        {#each toolsFromMessage(msg) as tool, ti (`${i}-${ti}`)}
          <details class="tool" class:err={tool.isError}>
            <summary>{toolSummary(tool)}</summary>
            <pre><code>{tool.args}</code></pre>
            <button type="button" class="copy" on:click={() => copyText(tool.args)}>复制</button>
          </details>
        {/each}
      </div>
    </article>
  {/each}

  {#if streamingThinking || streamingText || liveTools.length > 0}
    <article class="msg">
      <div class="role">Pi · 生成中</div>
      <div class="bubble">
        {#if streamingThinking}
          <details class="thinking" open>
            <summary>思考</summary>
            <pre class="plain">{streamingThinking}</pre>
          </details>
        {/if}
        {#each liveTools as tool (tool.id)}
          <details class="tool" class:err={tool.isError} open>
            <summary>{toolSummary(tool)}</summary>
            {#if tool.args}
              <pre><code>{tool.args}</code></pre>
            {/if}
            {#if tool.result}
              <pre><code>{tool.result}</code></pre>
            {/if}
          </details>
        {/each}
        {#if streamingText}
          <div class="md-body">{@html renderMarkdown(streamingText)}</div>
        {/if}
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
  .thinking {
    margin-bottom: 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 6px 10px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--muted);
  }
  .thinking pre {
    margin: 8px 0 0;
    white-space: pre-wrap;
    max-height: 240px;
    overflow: auto;
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
