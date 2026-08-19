import type { DshStatus, PiRuntimeSnapshot } from "../types";

/**
 * M0.4 landing: each host has one status fact source.
 * Callers should read these facts rather than infer Ready/Crashed from a click.
 * This module only establishes the location and shape; App wiring stays unchanged.
 */
export type HostRuntimeFacts = {
  pi: PiRuntimeSnapshot | null;
  dsh: DshStatus | null;
};

export function emptyHostRuntimeFacts(): HostRuntimeFacts {
  return { pi: null, dsh: null };
}
