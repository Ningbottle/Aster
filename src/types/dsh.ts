export type DshRuntime = {
  version: string;
  entry_path: string;
  managed: boolean;
  supported: boolean;
};

export type DshStatus = {
  running: boolean;
  /** 三层探针全部通过（进程存活 + 静态页面 + boot manifest 注入）。 */
  healthy: boolean;
  /** 分层证据：进程存活。 */
  runner_alive: boolean;
  /** 分层证据：HTTP 200 且含 SPA 静态标记。 */
  static_ok: boolean;
  /** 分层证据：响应体含 window.__DSH_BOOT__（前端可启动的必要条件）。 */
  boot_ok: boolean;
  port: number;
  url: string;
  version: string;
  managed: boolean;
  pid: number | null;
  /** Ready/Crashed/Unknown from the live DshSlot, never inferred from a Start click. */
  lifecycle: string;
};
