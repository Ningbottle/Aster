import { invoke } from "@tauri-apps/api/core";
import type { PiActiveSession, PiProjectNode } from "../../types";

export const piApi = {
  refreshTree: () => invoke<PiProjectNode[]>("pi_project_tree_refresh"),
  createSession: (projectPath: string) =>
    invoke<PiActiveSession>("pi_session_create", { projectPath }),
  openSession: (projectPath: string, sessionId: string) =>
    invoke<PiActiveSession>("pi_session_open", { projectPath, sessionId }),
  snapshot: () => invoke<PiActiveSession>("pi_session_snapshot"),
  setName: (name: string) => invoke<PiActiveSession>("pi_session_set_name", { name }),
  setModel: (provider: string, modelId: string) =>
    invoke<PiActiveSession>("pi_session_set_model", { provider, modelId }),
  setThinkingLevel: (level: string) =>
    invoke<PiActiveSession>("pi_session_set_thinking_level", { level }),
  prompt: (message: string) => invoke<void>("pi_session_prompt", { message }),
  abort: () => invoke<PiActiveSession>("pi_session_abort"),
  stop: () => invoke<void>("pi_session_stop"),
  availableModels: () => invoke<import("../../types").PiModel[]>("pi_get_available_models"),
};
