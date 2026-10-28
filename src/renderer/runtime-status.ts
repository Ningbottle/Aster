import type { RuntimeView } from './model';
import type { StatusKind } from './cds/Status';

/** Runtime projection shared by the title-bar menu and the settings dialog. */
export function runtimeKind(runtime: RuntimeView): StatusKind {
  switch (runtime.status) {
    case 'offline':
    case 'failed': return 'error';
    case 'working': return 'running';
    case 'stop-requested': return 'clay';
    default: return 'ready';
  }
}

export function runtimeLabel(runtime: RuntimeView) {
  switch (runtime.status) {
    case 'offline': return runtime.detail ?? 'Disconnected';
    case 'ready': return runtime.detail ?? 'Ready';
    case 'working': return runtime.queued > 0 ? `Working · ${runtime.queued} queued` : 'Working';
    case 'stop-requested': return 'Stop requested';
    case 'failed': return 'Last turn failed';
  }
}
