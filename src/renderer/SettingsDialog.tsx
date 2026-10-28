import { useRef } from 'react';
import { Check, Gear, ShieldCheck, Prohibit, X } from '@phosphor-icons/react';
import type { ApprovalMode } from '@thinkrail/contracts';
import type { DesktopView } from './desktop-state';
import { CdsButton as Button } from './cds/Button';
import { StatusDot } from './cds/Status';
import { runtimeKind, runtimeLabel } from './runtime-status';
import { useModalFocus } from './modal-focus';

/**
 * Settings only lists controls that already act on real state. Appearance has no
 * switch because this build owns a single light theme; an inert toggle would be
 * a second fake button and is deliberately not rendered.
 */
export function SettingsDialog({ view, onClose, onSetApproval, onSetTrust, onRelease }: {
  view: DesktopView;
  onClose: () => void;
  onSetApproval: (mode: ApprovalMode) => void;
  onSetTrust: (projectId: string, trusted: boolean) => void;
  onRelease: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { initialFocusSelector: '#settings-close' });
  const session = view.activeSession?.session ?? null;
  const project = view.activeSession?.project ?? null;
  const approvalMode = session?.approvalMode ?? 'auto';
  const trusted = project?.piResourceTrust === 'granted';
  return <div className="modal-scrim" ref={layer} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); onClose(); } }}>
      <header className="settings-head">
        <h2 id="settings-title"><Gear size={15} aria-hidden="true" />Settings</h2>
        <Button id="settings-close" variant="ghost" size="icon" className="icon-button" aria-label="Close settings" onClick={onClose}><X size={14} /></Button>
      </header>

      <section className="settings-section" aria-labelledby="settings-session">
        <h3 id="settings-session">Session</h3>
        <p className="settings-note">Applies to the open session only.</p>
        <div className="settings-options" role="radiogroup" aria-label="Tool access">
          {([
            ['auto', 'Auto accept edits', 'Tools run without asking.', <Prohibit size={15} key="auto" />],
            ['ask', 'Ask before changes', 'Write, edit and bash ask first.', <ShieldCheck size={15} key="ask" />],
          ] as const).map(([mode, name, description, icon]) => <button type="button" key={mode} role="radio" aria-checked={approvalMode === mode}
            className={`settings-option ${approvalMode === mode ? 'is-selected' : ''}`}
            disabled={!session || view.runtime.status === 'offline'}
            onClick={() => onSetApproval(mode)}>
            <span className="settings-option-icon">{icon}</span>
            <span className="settings-option-text"><span>{name}</span><span className="settings-option-sub">{description}</span></span>
            {approvalMode === mode && <Check size={14} className="settings-check" aria-hidden="true" />}
          </button>)}
        </div>
        {!session && <p className="settings-note">Open a session to change its tool access.</p>}
      </section>

      <section className="settings-section" aria-labelledby="settings-project">
        <h3 id="settings-project">Project</h3>
        {project
          ? <>
            <div className="settings-row">
              <label className="settings-checkbox">
                <input type="checkbox" checked={trusted} onChange={event => onSetTrust(project.id, event.target.checked)} />
                <span>Trust project resources</span>
              </label>
              <p className="settings-note">Loads .pi settings, skills, MCP and extensions for this project. It does not sandbox tools.</p>
              <p className="settings-path" title={project.path}>{project.path}</p>
            </div>
          </>
          : <p className="settings-note">No project is open.</p>}
      </section>

      <section className="settings-section" aria-labelledby="settings-runtime">
        <h3 id="settings-runtime">Runtime</h3>
        <div className="settings-row settings-status">
          <StatusDot kind={runtimeKind(view.runtime)} label={runtimeLabel(view.runtime)} />
          <Button variant="secondary" size="sm" disabled={!session} onClick={() => { onRelease(); onClose(); }}>Release session</Button>
        </div>
        <p className="settings-note">Releasing unloads the session runtime; the transcript stays on disk.</p>
      </section>

      <p className="settings-footnote">Light theme only. System dark mode and per-window scaling are not supported in this build.</p>
    </div>
  </div>;
}
