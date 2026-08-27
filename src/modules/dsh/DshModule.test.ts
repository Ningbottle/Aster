import { render } from "svelte/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { DshStatus } from "../../types";
import { emptyHostRuntimeFacts, hostRuntimeStore } from "../../platform/runtimeStatus";
import DshModule from "./DshModule.svelte";

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
  pid: 1234,
  lifecycle: "ready",
};

describe("DshModule top bar", () => {
  beforeEach(() => {
    hostRuntimeStore.set({ ...emptyHostRuntimeFacts(), dsh: readyDsh });
  });

  it("keeps runtime diagnostics in a closed Details disclosure", () => {
    const { body } = render(DshModule, {
      props: { dshRuntimes: [], onRefresh: async () => undefined },
    });

    expect(body).toContain('class="dsh-details');
    expect(body).toContain("详情");
    expect(body).not.toContain('class="dsh-details open');

    const detailsBody = body.slice(body.indexOf('class="dsh-details'));
    expect(detailsBody).toContain("http://127.0.0.1:38472");
    expect(detailsBody).toContain("PID");
    expect(detailsBody).toContain("0.1.0-rc.6");
    expect(detailsBody).toContain("Boot Probe");
    expect(detailsBody).toContain("健康");
  });

  it("keeps lifecycle and required controls visible in the default bar", () => {
    const { body } = render(DshModule, {
      props: { dshRuntimes: [], onRefresh: async () => undefined },
    });

    const bar = body.slice(body.indexOf('<div class="dsh-bar'), body.indexOf('<div class="dsh-embed'));
    const barLeft = bar.slice(bar.indexOf('class="dsh-bar-left'), bar.indexOf('class="dsh-bar-right'));
    expect(barLeft).toContain("DeepSeek Harness");
    expect(barLeft).toContain("Ready");
    expect(bar).toContain("刷新");
    expect(bar).toContain("独立窗口");
    expect(bar).toContain("停止服务");
    expect(barLeft).not.toContain("PID");
    expect(barLeft).not.toContain("Boot Probe");
  });
});
