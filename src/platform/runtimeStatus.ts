import { get, writable } from "svelte/store";
import type { DshStatus, PiRuntimeSnapshot } from "../types";

/**
 * Single queryable/subscribable host runtime fact source.
 * Callers write snapshots from IPC and read labels from these facts
 * rather than inferring Ready/Crashed from a click.
 */
export type HostRuntimeFacts = {
  pi: PiRuntimeSnapshot | null;
  dsh: DshStatus | null;
};

export type DshPending = "starting" | "stopping" | null;

export function emptyHostRuntimeFacts(): HostRuntimeFacts {
  return { pi: null, dsh: null };
}

export const hostRuntimeStore = writable<HostRuntimeFacts>(emptyHostRuntimeFacts());

export function setPiRuntimeFacts(pi: PiRuntimeSnapshot | null): void {
  hostRuntimeStore.update((facts) => ({ ...facts, pi }));
}

export function setDshRuntimeFacts(dsh: DshStatus | null): void {
  hostRuntimeStore.update((facts) => ({ ...facts, dsh }));
}

export function getHostRuntimeFacts(): HostRuntimeFacts {
  return get(hostRuntimeStore);
}

export function pathsEqual(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "");
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}

function projectDisplayName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  const name = parts[parts.length - 1];
  return name && name.length > 0 ? name : "当前项目";
}

export function piProjectBlocksChange(facts: HostRuntimeFacts, nextPath: string): string | null {
  const pi = facts.pi;
  if (!pi?.projectPath) return null;
  if (pi.lifecycle === "closed" || pi.lifecycle === "needsSetup") return null;
  if (pathsEqual(pi.projectPath, nextPath)) return null;
  const display = projectDisplayName(pi.projectPath);
  return `当前存在活动 Pi Session，绑定项目为「${display}」。已保留该 Session。如需切换或清除项目，请先在 Pi 中停止 Session，再重新操作。`;
}

export function piLifecycleLabel(sessionStatus: string, lifecycle: string | null): string {
  if (sessionStatus === "starting" || lifecycle === "starting") return "Starting";
  if (sessionStatus === "streaming" || lifecycle === "busy") return "Running";
  if (sessionStatus === "compacting") return "Compacting";
  if (sessionStatus === "error" || lifecycle === "crashed") return "Error";
  if (lifecycle === "stopping") return "Stopping";
  if (lifecycle === "needsSetup") return "Needs setup";
  if (lifecycle === "unknown") return "Unknown";
  if (sessionStatus === "idle") return "Ready";
  if (sessionStatus === "closed" || lifecycle === "closed") return "Closed";
  if (lifecycle === "ready") return "Ready";
  return "Unknown";
}

export function dshLifecycleLabel(
  status: { lifecycle: string } | null,
  pending: DshPending,
): string {
  if (pending === "starting") return "Starting";
  if (pending === "stopping") return "Stopping";
  if (!status) return "Closed";
  if (status.lifecycle === "ready") return "Ready";
  if (status.lifecycle === "crashed") return "Crashed";
  if (status.lifecycle === "unknown") return "Unknown";
  return "Unknown";
}
