<script lang="ts">
  import { tick, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { renderMarkdown } from "../lib/markdown";
  import type { PiEvent, PiModel, PiObservation, PiRuntime, PiSessionState } from "../types";

  export let piRuntimes: PiRuntime[] = [];
  export let observation: PiObservation | null = null;
  export let onRefresh: () => Promise<void>;

  export let isChatOpen = false;

  type ToolCallItem = {
    name: string;
    summary: string;
    running: boolean;
    isError?: boolean;
  };

  type ChatMessage = {
    id: string;
    role: "user" | "pi";
    time: string;
    text: string;
    streaming?: boolean;
    tools?: ToolCallItem[];
  };

  let messages: ChatMessage[] = [];
  let availableModels: PiModel[] = [];
  let currentModel: PiModel | null = null;
  let thinkingLevel: string = "high";
  let loadingModels = false;

  let composeText = "";
  let chatInputText = "";
  let transcriptEl: HTMLElement;
  let isSubmitting = false;
  let installingPi = false;
  let installMsg = "";
  let modelError = "";

  $: hasPi = piRuntimes.some((r) => r.version === "0.84.2");

  function formatTime(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  async function scrollToBottom() {
    await tick();
    if (transcriptEl) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
  }

  export function openCompose() {
    isChatOpen = false;
  }

  export function openChat() {
    isChatOpen = true;
    scrollToBottom();
  }

  export async function loadModelsAndState() {
    if (!hasPi) return;
    loadingModels = true;
    modelError = "";
    try {
      // 获取当前状态
      const state = await invoke<PiSessionState>("pi_get_state");
      if (state?.model) {
        currentModel = state.model;
      }
      if (state?.thinkingLevel) {
        thinkingLevel = state.thinkingLevel;
      }

      // 获取可用模型列表
      const models = await invoke<PiModel[]>("pi_get_available_models");
      if (Array.isArray(models) && models.length > 0) {
        availableModels = models;
        if (!currentModel && models.length > 0) {
          currentModel = models[0];
        }
      }
    } catch (e) {
      modelError = `获取模型列表: ${e}`;
    } finally {
      loadingModels = false;
    }
  }

  async function handleModelChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const selectedId = target.value;
    const model = availableModels.find((m) => m.id === selectedId);
    if (!model) return;

    try {
      await invoke("pi_set_model", {
        provider: model.provider || "default",
        modelId: model.id,
      });
      currentModel = model;
      modelError = "";
    } catch (err) {
      modelError = `切换模型失败: ${err}`;
    }
  }

  export function handleIncomingEvent(ev: PiEvent) {
    const event_type = ev.event_type;
    const raw = (ev.raw || (ev as any).data || {}) as Record<string, unknown>;

    if (event_type === "assistant_message_start") {
      messages = [
        ...messages,
        {
          id: String(Date.now()),
          role: "pi",
          time: formatTime(),
          text: "",
          streaming: true,
          tools: [],
        },
      ];
      scrollToBottom();
    } else if (event_type === "assistant_message_update") {
      const updateType = raw?.update_type as string;
      const assistantEvent = raw?.assistant_message_event as Record<string, unknown>;
      if (updateType === "text_delta") {
        const delta = (assistantEvent?.delta as string) || "";
        updateCurrentAssistantMessage((msg) => {
          msg.text = (msg.text || "") + delta;
        });
        scrollToBottom();
      } else if (updateType === "text_end") {
        const content = (assistantEvent?.content as string) || "";
        if (content) {
          updateCurrentAssistantMessage((msg) => {
            if (!msg.text) msg.text = content;
          });
        }
      }
    } else if (event_type === "tool_execution_start") {
      const toolName = (raw?.toolName as string) || "tool";
      const args = raw?.args ? JSON.stringify(raw.args) : "";
      updateCurrentAssistantMessage((msg) => {
        msg.tools = msg.tools || [];
        msg.tools.push({
          name: toolName,
          summary: args.length > 60 ? `${args.slice(0, 60)}...` : args,
          running: true,
        });
      });
      scrollToBottom();
    } else if (event_type === "tool_execution_end") {
      const isError = !!raw?.isError;
      updateCurrentAssistantMessage((msg) => {
        if (msg.tools && msg.tools.length > 0) {
          const lastTool = msg.tools[msg.tools.length - 1];
          if (lastTool) {
            lastTool.running = false;
            lastTool.isError = isError;
          }
        }
      });
      scrollToBottom();
    } else if (event_type === "agent_end" || event_type === "agent_settled") {
      updateCurrentAssistantMessage((msg) => {
        msg.streaming = false;
        if (msg.tools) {
          for (const t of msg.tools) {
            t.running = false;
          }
        }
      });
      isSubmitting = false;
      scrollToBottom();
    }
  }

  function updateCurrentAssistantMessage(fn: (msg: ChatMessage) => void) {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === "pi") {
      fn(last);
      messages = [...messages];
    }
  }

  onMount(async () => {
    if (hasPi) {
      await loadModelsAndState();
    }
  });

  async function installManagedPi() {
    installingPi = true;
    installMsg = "正在安装 Pi 0.84.2 到 Aster 管理目录...";
    try {
      await invoke<PiRuntime>("pi_install_managed", { version: "0.84.2" });
      installMsg = "成功安装 Managed Pi 0.84.2";
      await onRefresh();
      await loadModelsAndState();
    } catch (e) {
      installMsg = `安装失败: ${e}`;
    } finally {
      installingPi = false;
    }
  }

  async function handleNewSession() {
    try {
      await invoke("pi_new_session");
      messages = [];
      isChatOpen = false;
    } catch (e) {
      modelError = `新建会话失败: ${e}`;
    }
  }

  async function handleComposeSend() {
    const text = composeText.trim();
    if (!text) return;
    messages = [
      ...messages,
      {
        id: `msg-${Date.now()}`,
        role: "user",
        time: formatTime(),
        text,
      },
    ];
    composeText = "";
    isChatOpen = true;
    scrollToBottom();
    await sendPromptToSession(text);
  }

  async function handleChatSend() {
    const text = chatInputText.trim();
    if (!text || isSubmitting) return;
    messages = [
      ...messages,
      {
        id: `msg-${Date.now()}`,
        role: "user",
        time: formatTime(),
        text,
      },
    ];
    chatInputText = "";
    scrollToBottom();
    await sendPromptToSession(text);
  }

  async function sendPromptToSession(prompt: string) {
    isSubmitting = true;
    try {
      await invoke("pi_session_ensure");
      await invoke("pi_session_prompt", { message: prompt });
    } catch (e) {
      messages = [
        ...messages,
        {
          id: `err-${Date.now()}`,
          role: "pi",
          time: formatTime(),
          text: `**会话错误**: ${e}`,
        },
      ];
      isSubmitting = false;
      scrollToBottom();
    }
  }

  async function handleAbort() {
    try {
      const res = await invoke<string>("pi_session_abort");
      messages = [
        ...messages,
        {
          id: `abort-${Date.now()}`,
          role: "pi",
          time: formatTime(),
          text: `*[已请求中断]* ${res}`,
        },
      ];
      isSubmitting = false;
      scrollToBottom();
      await onRefresh();
    } catch (e) {
      messages = [
        ...messages,
        {
          id: `abort-err-${Date.now()}`,
          role: "pi",
          time: formatTime(),
          text: `*[中断失败]* ${e}`,
        },
      ];
      scrollToBottom();
    }
  }

  function handleChipClick(chip: string) {
    composeText = `${chip}：`;
  }
</script>

{#if !isChatOpen}
  <!-- 状态一：新任务主页 (Compose) -->
  <div class="home-wrap" id="pi-compose">
    <div class="home-inner">
      <h1 class="home-title">想在 Aster 里构建什么？</h1>
      <p class="home-sub">描述任务。Pi 走严格本地 RPC 会话，数据与配置由 Pi 自主管理。</p>

      {#if !hasPi}
        <div class="card card-pad" style="margin-bottom: 20px; width: 100%; border-color: var(--warn);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <strong>未检测到锁定版本 Pi (0.84.2)</strong>
              <div class="faint" style="font-size: 12px; margin-top: 2px;">
                {installMsg || "可一键安装至 Aster 管理隔离目录，不影响系统全局 npm"}
              </div>
            </div>
            <button
              type="button"
              class="btn primary sm"
              disabled={installingPi}
              on:click={installManagedPi}
            >
              {installingPi ? "安装中..." : "一键安装 Pi 0.84.2"}
            </button>
          </div>
        </div>
      {/if}

      <div class="composer">
        <div class="ctx-bar">
          <span class="ctx-chip">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <path d="M2 4.5A1.5 1.5 0 013.5 3h2L7 4.5h5.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" />
            </svg>
            <b>Aster Pi</b>
          </span>

          <!-- 模型选择下拉 -->
          <div class="model-select-wrap">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v6M5 8h6" />
            </svg>
            {#if availableModels.length > 0}
              <select
                class="model-select"
                value={currentModel?.id || availableModels[0]?.id}
                on:change={handleModelChange}
                aria-label="选择模型"
              >
                {#each availableModels as m (m.id)}
                  <option value={m.id}>{m.name || m.id} ({m.provider})</option>
                {/each}
              </select>
            {:else if loadingModels}
              <span class="faint" style="font-size: 11px;">加载模型中...</span>
            {:else}
              <span class="faint" style="font-size: 11px;">{currentModel?.name || "默认模型"}</span>
            {/if}
          </div>

          <span class="ctx-chip" style="margin-left: auto;">
            <span class="status-dot run"></span>
            <b>0.84.2</b>
          </span>
        </div>

        {#if modelError}
          <div class="model-err-bar">{modelError}</div>
        {/if}

        <textarea
          placeholder="描述任务，例如：为 M4 更新中心编写并排版本切换的 TDD 计划…"
          aria-label="任务输入"
          bind:value={composeText}
          on:keydown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleComposeSend();
            }
          }}
        ></textarea>

        <div class="composer-foot">
          <button type="button" class="icon-btn" aria-label="附件" title="附件（未来支持）">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <span class="tag neutral">会话将写入独立工作目录</span>
          <button
            type="button"
            class="send-btn"
            aria-label="发送"
            disabled={!composeText.trim() || isSubmitting}
            on:click={handleComposeSend}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
            </svg>
          </button>
        </div>
      </div>

      <div class="suggest-row">
        <button type="button" class="chip" on:click={() => handleChipClick("代码审查")}>代码审查</button>
        <button type="button" class="chip" on:click={() => handleChipClick("TDD 计划")}>TDD 计划</button>
        <button type="button" class="chip" on:click={() => handleChipClick("Skills 快照排查")}>Skills 快照排查</button>
        <button type="button" class="chip" on:click={() => handleChipClick("架构决策记录")}>架构决策记录</button>
      </div>

      {#if messages.length > 0}
        <div class="home-recents">
          <h2>当前会话</h2>
          <button type="button" class="recent-row" on:click={openChat}>
            <span>{messages[0]?.text?.slice(0, 40) || "已激活的 Pi 会话"}...</span>
            <span class="time">{messages.length} 条消息</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <!-- 状态二：流式会话中 (Chat) -->
  <div class="pi-chat" id="pi-chat">
    <div class="chat-topbar">
      <button type="button" class="btn sm" on:click={openCompose} title="返回任务配置">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M10 3L5 8l5 5" /></svg>
        返回
      </button>

      <button type="button" class="btn sm" on:click={handleNewSession} style="margin-left: 6px;">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2.5v11M2.5 8h11" /></svg>
        新会话
      </button>

      <!-- 顶部模型切换 -->
      <div class="model-select-wrap" style="margin-left: 12px;">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v6M5 8h6" />
        </svg>
        {#if availableModels.length > 0}
          <select
            class="model-select"
            value={currentModel?.id || availableModels[0]?.id}
            on:change={handleModelChange}
            aria-label="切换模型"
          >
            {#each availableModels as m (m.id)}
              <option value={m.id}>{m.name || m.id}</option>
            {/each}
          </select>
        {:else}
          <span class="faint" style="font-size: 11.5px;">{currentModel?.name || "默认模型"}</span>
        {/if}
      </div>

      <span class="faint" style="font-size: 11.5px; margin-left: 12px;">
        {#if observation}
          tools: {observation.tool_starts} · updates: {observation.message_updates}
        {/if}
      </span>

      <div style="margin-left: auto; display: flex; gap: 8px;">
        {#if isSubmitting}
          <button type="button" class="btn sm danger-ghost" on:click={handleAbort}>中断生成</button>
        {/if}
      </div>
    </div>

    {#if modelError}
      <div class="model-err-bar">{modelError}</div>
    {/if}

    <div class="pi-transcript" bind:this={transcriptEl} aria-live="polite">
      {#if messages.length === 0}
        <div class="empty-chat">
          <div class="faint">开始与 Pi 对话...</div>
        </div>
      {:else}
        {#each messages as msg (msg.id)}
          <div class="msg" class:user={msg.role === "user"}>
            <div class="role">
              {msg.role === "user" ? "你" : "PI"} · {msg.time}
              {#if msg.streaming}
                <span class="streaming-badge">生成中...</span>
              {/if}
            </div>

            <div class="bubble">
              {#if msg.role === "user"}
                <div style="white-space: pre-wrap;">{msg.text}</div>
              {:else}
                <div class="md-body">
                  {@html renderMarkdown(msg.text || (msg.streaming ? "..." : ""))}
                </div>
              {/if}

              {#if msg.tools && msg.tools.length > 0}
                <div class="tool-list">
                  {#each msg.tools as tool}
                    <div class="tool-call" class:err={tool.isError}>
                      <span class="status-dot" class:run={tool.running} class:idle={!tool.running}></span>
                      <span class="tool-name">{tool.name}</span>
                      <span class="tool-summary">{tool.summary}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="pi-input">
      <div class="pi-input-inner">
        <textarea
          placeholder="发送 prompt 到 Pi 会话…（Enter 发送，Shift+Enter 换行）"
          aria-label="Pi prompt 输入"
          bind:value={chatInputText}
          on:keydown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleChatSend();
            }
          }}
        ></textarea>
        <button
          type="button"
          class="btn primary"
          disabled={isSubmitting || !chatInputText.trim()}
          on:click={handleChatSend}
        >
          {isSubmitting ? "发送中..." : "发送"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .home-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 28px;
    overflow-y: auto;
  }
  .home-inner {
    width: 100%;
    max-width: 680px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .home-title {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 600;
    line-height: 1.35;
    text-align: center;
    margin-bottom: 6px;
    color: var(--fg);
  }
  .home-sub {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 30px;
    text-align: center;
  }
  .composer {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    box-shadow: var(--shadow-2);
    overflow: hidden;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .composer .ctx-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .ctx-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    color: var(--muted);
    padding: 2px 8px;
    border-radius: 5px;
  }
  .ctx-chip svg {
    width: 12px;
    height: 12px;
  }
  .ctx-chip b {
    font-weight: 550;
    color: var(--fg);
  }
  .model-select-wrap {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12px;
    color: var(--fg);
  }
  .model-select-wrap svg {
    width: 12px;
    height: 12px;
    color: var(--muted);
    flex: none;
  }
  .model-select {
    border: none;
    background: transparent;
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 550;
    color: var(--fg);
    cursor: pointer;
    outline: none;
  }
  .model-err-bar {
    background: oklch(0.96 0.03 27);
    color: var(--danger);
    font-size: 11.5px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border);
  }
  .composer textarea {
    width: 100%;
    border: none;
    resize: none;
    padding: 14px 16px 6px;
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--fg);
    background: transparent;
    min-height: 80px;
  }
  .composer textarea::placeholder {
    color: var(--faint);
  }
  .composer textarea:focus {
    outline: none;
  }
  .composer:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-2);
  }
  .composer .composer-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 10px;
  }
  .composer .icon-btn {
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    display: grid;
    place-items: center;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .composer .icon-btn:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .composer .icon-btn svg {
    width: 15px;
    height: 15px;
  }
  .send-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--surface);
    display: grid;
    place-items: center;
    margin-left: auto;
    border: none;
    cursor: pointer;
    transition: background 0.12s ease, transform 0.1s ease;
  }
  .send-btn:hover {
    background: var(--accent-hover);
  }
  .send-btn:active {
    transform: scale(0.94);
  }
  .send-btn:disabled {
    opacity: 0.4;
    cursor: default;
    transform: none;
  }
  .send-btn svg {
    width: 14px;
    height: 14px;
  }
  .suggest-row {
    display: flex;
    gap: 8px;
    margin-top: 16px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .home-recents {
    margin-top: 34px;
    width: 100%;
    max-width: 680px;
  }
  .home-recents h2 {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--faint);
    font-weight: 600;
    margin-bottom: 8px;
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    font-size: 12.5px;
    color: var(--muted);
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
  }
  .recent-row:hover {
    background: var(--surface);
    color: var(--fg);
    box-shadow: var(--shadow-1);
  }
  .recent-row .time {
    margin-left: auto;
    font-size: 11px;
    color: var(--faint);
  }

  /* Pi Chat */
  .pi-chat {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .chat-topbar {
    padding: 8px 24px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pi-transcript {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .empty-chat {
    flex: 1;
    display: grid;
    place-items: center;
  }
  .msg {
    width: 100%;
    max-width: 720px;
    margin-bottom: 18px;
    animation: msgIn 0.18s cubic-bezier(0.2, 0, 0, 1);
  }
  .msg .role {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--faint);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .streaming-badge {
    font-size: 10px;
    color: var(--accent);
    font-weight: normal;
  }
  .msg .bubble {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: 14px 16px;
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--fg);
  }
  .msg.user .bubble {
    background: var(--surface-2);
  }
  .tool-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tool-call {
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface-2);
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tool-call.err {
    border-color: var(--danger);
    background: oklch(0.96 0.03 27);
  }
  .tool-name {
    font-weight: 600;
    color: var(--fg);
  }
  .tool-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--faint);
  }
  .pi-input {
    flex: none;
    border-top: 1px solid var(--border);
    padding: 12px 24px;
    background: var(--surface);
    display: flex;
    justify-content: center;
  }
  .pi-input-inner {
    flex: 1;
    max-width: 724px;
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }
  .pi-input textarea {
    flex: 1;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    padding: 9px 12px;
    font-family: inherit;
    font-size: 13px;
    resize: none;
    min-height: 42px;
    max-height: 140px;
    background: var(--surface);
    color: var(--fg);
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
  @keyframes msgIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>

