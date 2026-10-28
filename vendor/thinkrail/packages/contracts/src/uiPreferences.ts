export type WorkspaceMode = 'chat' | 'code';

export interface UiPreferences {
  sidebarWidth?: number;
  selection?: { workspaceId: string; sessionId: string } | null;
  mode?: WorkspaceMode;
  sidebarOpen?: boolean;
  previewRatio?: number;
}

export type PreferencesReadResult =
  | { ok: true; prefs: UiPreferences }
  | { ok: false; error: string };

export type PreferencesWriteResult = { ok: true } | { ok: false; error: string };
