import type { UiPreferences, WorkspaceMode } from '@thinkrail/contracts';

/** Pure schema for the preferences IPC channel; no Electron import so it can be tested directly. */
export type { UiPreferences, WorkspaceMode };

export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 420;
const MODES: readonly WorkspaceMode[] = ['chat', 'code'];

function idField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new Error(`Invalid ${name}.`);
  return value;
}

/** Strict allowlist: unknown keys are dropped, unusable values are rejected. */
export function normalizePreferences(payload: unknown): UiPreferences {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('Invalid preferences payload.');
  const record = payload as Record<string, unknown>;
  const next: UiPreferences = {};
  if ('sidebarWidth' in record) {
    const value = record.sidebarWidth;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < SIDEBAR_MIN_WIDTH || value > SIDEBAR_MAX_WIDTH) {
      throw new Error('Invalid sidebar width.');
    }
    next.sidebarWidth = value;
  }
  if ('selection' in record) {
    const value = record.selection;
    if (value === null) next.selection = null;
    else {
      const selection = value as { workspaceId?: unknown; sessionId?: unknown } | null;
      next.selection = { workspaceId: idField(selection?.workspaceId, 'workspace id'), sessionId: idField(selection?.sessionId, 'session id') };
    }
  }
  if ('mode' in record) {
    const value = record.mode;
    if (typeof value !== 'string' || !MODES.includes(value as WorkspaceMode)) throw new Error('Invalid workspace mode.');
    next.mode = value as WorkspaceMode;
  }
  if ('sidebarOpen' in record) {
    if (typeof record.sidebarOpen !== 'boolean') throw new Error('Invalid sidebar state.');
    next.sidebarOpen = record.sidebarOpen;
  }
  if ('previewRatio' in record) {
    const value = record.previewRatio;
    // Any real share of the row is fine; the split itself clamps to the panes' minimums.
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) throw new Error('Invalid preview ratio.');
    next.previewRatio = value;
  }
  return next;
}
