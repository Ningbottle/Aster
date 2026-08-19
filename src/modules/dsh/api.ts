import { invoke } from "@tauri-apps/api/core";
import type { DshRuntime, DshStatus } from "../../types";

export const dshApi = {
  installManaged: (version: string) =>
    invoke<DshRuntime>("dsh_install_managed", { version }),
  start: (port: number) => invoke<DshStatus>("dsh_start", { port }),
  stop: () => invoke<void>("dsh_stop"),
  openWindow: () => invoke<void>("dsh_open_window"),
};
