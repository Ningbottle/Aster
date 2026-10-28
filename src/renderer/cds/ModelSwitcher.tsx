/*
 * Adapted from Caho1/open-claude-ui (ModelSwitcherWithTokenGauge) and the Codex
 * desktop picker in Microqian2th/dsh-codex-effort-slider: one model row with a
 * chevron opens the list, the effort track stays directly under that row.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { CaretLeft, CaretRight, Check } from '@phosphor-icons/react';
import { sameModel, type ThinkingLevel, type WireModel } from '@thinkrail/contracts';
import { CdsButton as Button } from './Button';
import { effortLevelLabel } from './EffortSelector';
import './model-switcher.css';

export interface ModelSwitcherProps {
  models: readonly WireModel[];
  currentModel: WireModel | null;
  effort: ThinkingLevel;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseModel: (model: WireModel) => void;
  triggerRef?: (element: HTMLButtonElement | null) => void;
  panelRef?: Ref<HTMLDivElement>;
  menuStyle?: CSSProperties;
  children?: ReactNode;
}

export function ModelSwitcher({
  models, currentModel, effort, disabled = false, open, onOpenChange, onChooseModel,
  triggerRef, panelRef, menuStyle, children,
}: ModelSwitcherProps) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [picking, setPicking] = useState(false);
  const name = currentModel?.name ?? 'No model';
  /** An empty list is a status, not a level: never open onto a dead end. */
  const canPick = models.length > 0;
  const showList = canPick && (picking || !children);
  const inert = disabled || (!canPick && !children);

  useEffect(() => {
    if (!open) setPicking(false);
  }, [open]);

  useEffect(() => {
    if (!open || !disabled) return;
    onOpenChange(false);
    trigger.current?.focus({ preventScroll: true });
    // Only an opening attempt is refused. A run that starts while the picker is
    // already open (for example after choosing effort) must not close it.
  }, [open]);

  return <div className="menu-anchor model-switcher" data-cds="ModelSwitcher">
    <Button
      variant="ghost" size="xs" className="composer-model model-switcher-trigger"
      ref={element => { trigger.current = element; triggerRef?.(element); }}
      aria-label={'Model: ' + name + ', effort: ' + effortLevelLabel(effort)}
      aria-disabled={inert}
      aria-haspopup="menu"
      aria-expanded={open}
      title={name}
      onClick={() => { if (!inert) onOpenChange(!open); }}
    ><span className="model-switcher-trigger-name">{name}</span><span className="model-switcher-trigger-effort" data-off={effort === 'off'}>{effortLevelLabel(effort)}</span></Button>
    {open && <div className="model-switcher-menu" role="menu" aria-label="Model" ref={panelRef} style={menuStyle}>
      {showList
        ? <>
          {children ? <div className="model-switcher-list-head">
            <button type="button" className="model-switcher-back" aria-label="Back to thinking effort" onClick={() => setPicking(false)}><CaretLeft size={13} /></button>
            <span>Model</span>
          </div> : null}
          <div className="model-switcher-options">
            {models.map(model => {
              const selected = sameModel(currentModel, model);
              return <Button
                variant="ghost" size="xs" key={JSON.stringify([model.provider, model.id])}
                role="menuitemradio" aria-checked={selected} aria-disabled={disabled}
                className="model-switcher-row"
                onFocus={event => event.currentTarget.scrollIntoView({ block: 'nearest' })}
                onClick={() => {
                  if (disabled) return;
                  onOpenChange(false);
                  trigger.current?.focus({ preventScroll: true });
                  onChooseModel(model);
                }}
              >
                <span className="model-switcher-row-text"><span className="model-switcher-name">{model.name}</span><span className="model-switcher-provider">{model.provider}</span></span>
                {selected && <Check className="model-switcher-check" size={14} aria-hidden="true" />}
              </Button>;
            })}
          </div>
        </>
        : <>
          {canPick
            ? <button type="button" role="menuitem" className="model-switcher-current" aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking(true)}>
              <span className="model-switcher-name">{name}</span>
              <CaretRight size={13} className="model-switcher-chev" aria-hidden="true" />
            </button>
            : <p className="model-switcher-status">No model configured · choose one in Settings</p>}
          {children}
        </>}
    </div>}
  </div>;
}
