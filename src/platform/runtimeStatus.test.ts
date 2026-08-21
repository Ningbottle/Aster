import { get } from "svelte/store";
import { describe, expect, it, beforeEach } from "vitest";
import type { DshStatus, PiRuntimeSnapshot } from "../types";
import {
  emptyHostRuntimeFacts,
  hostRuntimeStore,
  setPiRuntimeFacts,
  setDshRuntimeFacts,
  getHostRuntimeFacts,
  piProjectBlocksChange,
  piLifecycleLabel,
  dshLifecycleLabel,
} from "./runtimeStatus";

const readyPi: PiRuntimeSnapshot = {
  lifecycle: "ready",
  hasLockedInstall: true,
  projectPath: "C:\\work\\proj-a",
  sessionId: "s-1",
  runtimeInstanceId: 1,
};

const readyDsh: DshStatus = {
  running: true,
  healthy: true,
  runner_alive: true,
  static_ok: true,
  boot_ok: true,
  port: 38472,
  url: "http://127.0.0.1:38472",
  version: "0.1.0-rc.6",
  managed: true,
  pid: 1,
  lifecycle: "ready",
};

describe("hostRuntimeStore", () => {
  beforeEach(() => {
    hostRuntimeStore.set(emptyHostRuntimeFacts());
  });

  it("starts empty and records Pi and DSH writes independently", () => {
    expect(getHostRuntimeFacts()).toEqual({ pi: null, dsh: null });
    setPiRuntimeFacts(readyPi);
    expect(getHostRuntimeFacts().pi?.sessionId).toBe("s-1");
    expect(getHostRuntimeFacts().dsh).toBeNull();
    setDshRuntimeFacts(readyDsh);
    expect(get(hostRuntimeStore).dsh?.lifecycle).toBe("ready");
    expect(get(hostRuntimeStore).pi?.lifecycle).toBe("ready");
  });

  it("blocks a different project while Pi is ready, busy, or crashed", () => {
    for (const lifecycle of ["ready", "busy", "crashed"]) {
      setPiRuntimeFacts({ ...readyPi, lifecycle });
      const err = piProjectBlocksChange(getHostRuntimeFacts(), "C:\\work\\proj-b");
      expect(err).toContain("活动 Pi Session");
      expect(err).toContain("proj-a");
      expect(err).toContain("停止 Session");
    }
  });

  it("is a no-op for the same path including slash and case differences", () => {
    setPiRuntimeFacts(readyPi);
    expect(piProjectBlocksChange(getHostRuntimeFacts(), "C:\\work\\proj-a")).toBeNull();
    expect(piProjectBlocksChange(getHostRuntimeFacts(), "C:/work/proj-a")).toBeNull();
    expect(piProjectBlocksChange(getHostRuntimeFacts(), "c:\\work\\PROJ-A")).toBeNull();
  });

  it("allows switch when closed or needsSetup and when there is no project path", () => {
    setPiRuntimeFacts({
      lifecycle: "closed",
      hasLockedInstall: true,
      projectPath: null,
      sessionId: null,
      runtimeInstanceId: null,
    });
    expect(piProjectBlocksChange(getHostRuntimeFacts(), "C:\\work\\proj-b")).toBeNull();
    setPiRuntimeFacts({
      ...readyPi,
      lifecycle: "needsSetup",
      projectPath: "C:\\work\\proj-a",
    });
    expect(piProjectBlocksChange(getHostRuntimeFacts(), "C:\\work\\proj-b")).toBeNull();
  });

  it("does not map closed to Ready", () => {
    expect(piLifecycleLabel("closed", "closed")).toBe("Closed");
    expect(piLifecycleLabel("idle", "ready")).toBe("Ready");
    expect(piLifecycleLabel("idle", "closed")).toBe("Ready");
    expect(piLifecycleLabel("streaming", "busy")).toBe("Running");
    expect(dshLifecycleLabel(null, null)).toBe("Closed");
    expect(dshLifecycleLabel(null, "starting")).toBe("Starting");
    expect(dshLifecycleLabel(null, "stopping")).toBe("Stopping");
    expect(dshLifecycleLabel({ lifecycle: "crashed" }, null)).toBe("Crashed");
    expect(dshLifecycleLabel({ lifecycle: "ready" }, null)).toBe("Ready");
  });
});
