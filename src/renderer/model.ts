import type {
  AgentSettlement,
  ExtUiRequest,
  ImageContent,
  SessionState,
  SessionSummary,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
  WireAgentMessage,
} from '@thinkrail/contracts';
import type { ConnectionStatus } from './client';

/** Extension dialogs that block the Pi session until the UI answers or cancels them. */
export type UiDialogRequest = Extract<ExtUiRequest, { kind: 'select' | 'confirm' | 'input' | 'editor' }>;

export type RuntimeStatus = 'offline' | 'ready' | 'working' | 'stop-requested' | 'failed';

/** Presentation-only projection of upstream SessionState; it never drives a lifecycle of its own. */
export interface RuntimeView {
  status: RuntimeStatus;
  detail: string | null;
  queued: number;
  backgroundWork: boolean;
}

export interface UiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

/** Pi's native image block: base64 payload plus its media type, kept as reported. */
export interface UiImage {
  data: string;
  mimeType: string;
}

export type UiContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id: string; name: string; arguments: unknown }
  | ({ type: 'image' } & UiImage)
  | { type: 'unsupported'; nativeType: string };

export interface UiMessage {
  role: 'user' | 'assistant' | 'toolResult' | 'custom';
  content: UiContent[];
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  usage?: UiUsage;
  errorMessage?: string;
  streaming?: boolean;
}

export interface UiToolActivity {
  id: string;
  name: string;
  arguments: unknown;
  output?: unknown;
  images?: UiImage[];
  status: 'running' | 'succeeded' | 'failed' | 'unknown';
}

type NativeContent = TextContent | ThinkingContent | ToolCall | ImageContent;

function toUiContent(content: NativeContent): UiContent {
  switch (content.type) {
    case 'text':
      return { type: 'text', text: content.text };
    case 'thinking':
      return { type: 'thinking', thinking: content.thinking };
    case 'toolCall':
      return { type: 'toolCall', id: content.id, name: content.name, arguments: content.arguments };
    case 'image':
      return { type: 'image', data: content.data, mimeType: content.mimeType };
  }
  return { type: 'unsupported', nativeType: String(content) };
}

function toUiContentList(content: string | readonly NativeContent[]): UiContent[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  return content.map(toUiContent);
}

function toUiUsage(usage: Usage | undefined): UiUsage | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
}

/** Native transcript message to the renderer's view props; null means the kind has no rendering yet. */
export function toUiMessage(message: WireAgentMessage): UiMessage | null {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: toUiContentList(message.content), timestamp: message.timestamp };
    case 'assistant':
      return {
        role: 'assistant',
        content: toUiContentList(message.content),
        timestamp: message.timestamp,
        usage: toUiUsage(message.usage),
        errorMessage: message.errorMessage,
      };
    case 'toolResult':
      return {
        role: 'toolResult',
        content: toUiContentList(message.content),
        timestamp: message.timestamp,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        isError: message.isError,
      };
    case 'custom':
      if (!message.display) return null;
      return { role: 'custom', content: toUiContentList(message.content), timestamp: message.timestamp };
    default:
      return null;
  }
}

export function sessionRuntime(
  connection: ConnectionStatus,
  session: SessionSummary | null,
  state: SessionState | undefined,
  settlement: AgentSettlement | null | undefined,
  stopRequested: boolean,
): RuntimeView {
  const queued = state?.queuedCount ?? 0;
  const backgroundWork = state?.backgroundWork === true;
  if (connection !== 'connected') {
    return {
      status: 'offline',
      detail: connection === 'connecting' ? 'Connecting to the local server' : 'Disconnected from the local server',
      queued,
      backgroundWork,
    };
  }
  if (!session) return { status: 'ready', detail: null, queued, backgroundWork };
  if (state?.execution === 'running' || backgroundWork) {
    return {
      status: stopRequested ? 'stop-requested' : 'working',
      detail: state?.needsInput ? 'Waiting for your input' : null,
      queued,
      backgroundWork,
    };
  }
  if (state?.completion?.outcome === 'failed') {
    return {
      status: 'failed',
      detail: settlement?.errorMessage ?? 'The last turn failed.',
      queued,
      backgroundWork,
    };
  }
  return {
    status: 'ready',
    detail: state?.needsInput ? 'Waiting for your input' : null,
    queued,
    backgroundWork,
  };
}
