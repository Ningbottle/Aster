import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { ArrowRight, ArrowUp, Check, FolderSimple, ImageSquare, Plus, ShieldCheck, Square, X } from '@phosphor-icons/react';
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_MAX_BASE64_BYTES,
  base64EncodedLength,
  type ApprovalMode,
  type SlashCommandInfo,
  type ThinkingLevel,
  type WireModel,
} from '@thinkrail/contracts';
import type { DesktopView } from './desktop-state';
import type { UiImage } from './model';
import { CdsButton as Button } from './cds/Button';
import { ComposerFrame } from './cds/Composer';
import { ContextRing } from './ContextRing';
import { ImageLightbox, imageSource } from './ImageAttachment';
import { ApiUsageRows, ContextUsageMeter } from './UsageCard';
import { contextWindowUsage } from './usage';
import { dismissesCommandMenu, isComposingKey, submitsMessage } from './composer-keys';
import { useMenuFocus } from './menu-focus';

type ComposerMenu = 'model' | 'thinking' | 'access' | 'add' | 'usage';

function matchingCommands(commands: SlashCommandInfo[], draft: string): { query: string; matches: SlashCommandInfo[] } | null {
  const match = /^\/(\S*)$/.exec(draft);
  if (!match) return null;
  const query = match[1].toLocaleLowerCase();
  return { query, matches: commands.filter(command => command.name.toLocaleLowerCase().startsWith(query)).slice(0, 12) };
}

const capitalize = (value: string) => value ? value[0].toLocaleUpperCase() + value.slice(1) : value;

interface ComposerAttachment extends UiImage {
  id: string;
  name: string;
}

interface Draft {
  text: string;
  images: ComposerAttachment[];
}

/** The image cap is Pi's provider contract; the total is under Bun's default 16 MiB WS frame. */
const IMAGE_COUNT_LIMIT = 6;
const IMAGE_TOTAL_BASE64_LIMIT = 12 * 1024 * 1024;
const IMAGE_MEGABYTE = 1024 * 1024;
const mimeLabels = ACCEPTED_IMAGE_TYPES.map(type => type.replace('image/', '').toLocaleUpperCase()).join(', ');
let attachmentSequence = 0;

function mimeTypeOf(file: File): string | null {
  if (ACCEPTED_IMAGE_TYPES.includes(file.type)) return file.type;
  if (file.type) return null;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLocaleLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  return null;
}

function readAttachment(file: File, mimeType: string): Promise<ComposerAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') { reject(new Error('The file could not be read.')); return; }
      const comma = result.indexOf(',');
      if (comma < 0) { reject(new Error('The file could not be decoded.')); return; }
      attachmentSequence += 1;
      resolve({ id: `attachment-${attachmentSequence}`, name: file.name || 'Pasted image', mimeType, data: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}

export function PromptComposer({ onChooseProject, view, onSend, onAbort, onSetApproval, onSetModel, onSetThinking, onOpenDetails, pending, awaitingInput }: {
  view: DesktopView; onChooseProject: () => void; onSend: (text: string, images: UiImage[]) => Promise<boolean>;
  onAbort: () => void; onSetApproval: (mode: ApprovalMode) => void;
  onSetModel: (model: WireModel) => void; onSetThinking: (level: ThinkingLevel) => void; onOpenDetails: () => void; pending: boolean; awaitingInput: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [dismissedCommand, setDismissedCommand] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [menu, setMenu] = useState<ComposerMenu | null>(null);
  const [menuBox, setMenuBox] = useState<{ left: number; bottom: number } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const usageCard = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const previewOpener = useRef<HTMLElement | null>(null);
  const triggers = useRef<Partial<Record<ComposerMenu, HTMLButtonElement | null>>>({});
  useMenuFocus(menu, menuPanel);
  const identity = view.activeSession?.session.sessionId ?? '';
  const previousIdentity = useRef(identity);
  /** Drafts survive switching sessions; a sent draft is removed, an empty draft is not stored. */
  const drafts = useRef(new Map<string, Draft>());
  const connected = view.connection === 'connected';
  const canEdit = !!view.activeSession && connected && !view.loading;
  const hasDraft = !!draft.trim() || attachments.length > 0;
  /** A running turn must stay editable: that is how a follow-up (with images) is queued. */
  const canSend = canEdit && hasDraft && !awaitingInput;
  const canStop = !!view.activeSession && (view.runtime.status === 'working' || view.runtime.status === 'stop-requested');
  const working = view.runtime.status === 'working' || view.runtime.status === 'stop-requested';
  const approvalMode = view.activeSession?.session.approvalMode ?? 'auto';
  const hasMessages = !!view.activeSession?.messages.length;
  const usage = contextWindowUsage(view.activeSession?.stats);
  const commands = matchingCommands(view.commands, draft);
  const commandMatches = commands?.matches ?? [];
  const showCommands = canEdit && !awaitingInput && commandMatches.length > 0 && dismissedCommand !== draft;
  const activeCommandIndex = showCommands ? Math.min(commandIndex, commandMatches.length - 1) : -1;
  const resize = () => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, Math.min(384, window.innerHeight * .4))}px`;
  };
  const textareaDraft = useRef(draft);
  textareaDraft.current = draft;
  const attachmentRef = useRef(attachments);
  attachmentRef.current = attachments;
  const addingFiles = useRef<object | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const storeDraft = (text: string, images: ComposerAttachment[]) => {
    if (!identity) return;
    if (text || images.length > 0) drafts.current.set(identity, { text, images });
    else drafts.current.delete(identity);
  };
  const changeDraft = (value: string) => {
    setDraft(value);
    storeDraft(value, attachments);
  };
  const changeAttachments = (update: (current: ComposerAttachment[]) => ComposerAttachment[]) => {
    setAttachments(current => {
      const next = update(current);
      storeDraft(textareaDraft.current, next);
      return next;
    });
  };
  useLayoutEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    // An unfinished file selection belongs to the session that started it.
    addingFiles.current = null;
    setMenu(null);
    setPreview(null);
    setAttachError(null);
    setDismissedCommand(null);
    const saved = identity ? drafts.current.get(identity) : undefined;
    setDraft(saved?.text ?? '');
    setAttachments(saved?.images ?? []);
    if (textarea.current) textarea.current.style.height = 'auto';
  }, [identity]);
  useEffect(resize, [draft]);
  useEffect(() => { setCommandIndex(0); }, [draft, commandMatches.length]);
  useEffect(() => {
    if (!showCommands) return;
    region.current?.querySelector<HTMLElement>(`.command-menu [data-command-index="${activeCommandIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeCommandIndex, showCommands]);
  useEffect(() => {
    if (!menu) { setMenuBox(null); return; }
    const trigger = triggers.current[menu];
    if (!trigger) return;
    const widths = { model: 300, thinking: 190, access: 310, add: 184, usage: 322 } as const;
    const width = widths[menu];
    const rect = trigger.getBoundingClientRect();
    const regionTop = region.current?.getBoundingClientRect().top ?? rect.top;
    const composerTop = region.current?.querySelector<HTMLElement>('.composer')?.getBoundingClientRect().top ?? regionTop;
    const preferred = menu === 'model' ? rect.right - width : rect.left;
    setMenuBox({
      left: Math.min(Math.max(8, preferred), Math.max(8, window.innerWidth - width - 8)),
      bottom: Math.max(8, window.innerHeight - (menu === 'add' ? regionTop : composerTop) + 8),
    });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!region.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); triggers.current[menu]?.focus(); setMenu(null); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);
  useEffect(() => {
    if (menu === 'usage' && menuBox) usageCard.current?.focus();
  }, [menu, menuBox]);
  async function addFiles(files: File[]) {
    if (!canEdit || files.length === 0 || addingFiles.current) return;
    const batch = {};
    addingFiles.current = batch;
    try {
      setAttachError(null);
      const problems: string[] = [];
      const next: ComposerAttachment[] = [];
      const current = attachmentRef.current;
      let total = current.reduce((sum, item) => sum + item.data.length, 0);
      for (const file of files) {
        if (addingFiles.current !== batch) return;
        const name = file.name || 'Pasted image';
        const mimeType = mimeTypeOf(file);
        if (!mimeType) { problems.push(`${name} is not a ${mimeLabels} image.`); continue; }
        if (current.length + next.length >= IMAGE_COUNT_LIMIT) { problems.push(`Up to ${IMAGE_COUNT_LIMIT} images can be attached to one message.`); break; }
        const encoded = base64EncodedLength(file.size);
        if (encoded > IMAGE_MAX_BASE64_BYTES) {
          problems.push(`${name} is ${(encoded / IMAGE_MEGABYTE).toFixed(1)} MB of base64; the image limit is ${(IMAGE_MAX_BASE64_BYTES / IMAGE_MEGABYTE).toFixed(1)} MB.`);
          continue;
        }
        if (total + encoded > IMAGE_TOTAL_BASE64_LIMIT) {
          problems.push(`The attachments exceed the ${IMAGE_TOTAL_BASE64_LIMIT / IMAGE_MEGABYTE} MB request budget for the local transport.`);
          break;
        }
        try {
          const attachment = await readAttachment(file, mimeType);
          next.push(attachment);
          total += attachment.data.length;
        } catch {
          problems.push(`${name} could not be read.`);
        }
      }
      if (addingFiles.current !== batch) return;
      if (next.length > 0) changeAttachments(list => [...list, ...next]);
      if (problems.length > 0) setAttachError([...new Set(problems)].join(' '));
    } finally {
      if (addingFiles.current === batch) addingFiles.current = null;
    }
  }
  function pastedImages(event: ClipboardEvent<HTMLTextAreaElement>): File[] {
    const items = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
    return items.length > 0 ? items : Array.from(event.clipboardData.files);
  }
  async function submit() {
    if (!canSend) return;
    const text = draft;
    const sent = attachments;
    // Clear optimistically so a second Enter cannot submit the same draft twice.
    setDraft('');
    setAttachments([]);
    setPreview(null);
    setDismissedCommand(null);
    storeDraft('', []);
    if (await onSend(text, sent.map(({ data, mimeType }) => ({ data, mimeType })))) return;
    // A rejected send restores the draft unless the user moved on or already started writing again.
    if (identityRef.current === identity && textareaDraft.current === '' && attachmentRef.current.length === 0) {
      setDraft(text);
      setAttachments(sent);
      storeDraft(text, sent);
    }
  }
  function insertCommand(command: SlashCommandInfo) {
    changeDraft(`/${command.name} `);
    textarea.current?.focus();
  }
  const menuStyle = menuBox
    ? { position: 'fixed' as const, left: menuBox.left, bottom: menuBox.bottom, top: 'auto' as const }
    : { visibility: 'hidden' as const };
  return <div className={`composer-region ${dragging ? 'is-dropping' : ''}`} ref={region}
    onDragOver={event => {
      if (!canEdit || ![...event.dataTransfer.types].includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}>
    {!canEdit && view.connection === 'disconnected' && <p className="composer-note">Disconnected from the local server. Reconnecting…</p>}
    {attachError && <p className="composer-attach-error" role="alert">{attachError}</p>}
    <input ref={filePicker} className="composer-file-input" type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(',')} tabIndex={-1} aria-hidden="true"
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files); }} />
    <ComposerFrame disabled={!canEdit}>
      {attachments.length > 0 && <div className="composer-attachments" aria-label="Image attachments">
        {attachments.map((attachment, index) => <div className="composer-attachment" key={attachment.id}>
          <button type="button" className="composer-attachment-open" aria-label={`Preview ${attachment.name}`}
            onClick={event => { previewOpener.current = event.currentTarget; setPreview(index); }}>
            <img src={imageSource(attachment)} alt="" />
          </button>
          <button type="button" className="composer-attachment-remove" aria-label={`Remove ${attachment.name}`}
            onClick={() => changeAttachments(current => current.filter(item => item.id !== attachment.id))}><X size={11} /></button>
        </div>)}
      </div>}
      <textarea ref={textarea} value={draft} onChange={event => changeDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onPaste={event => {
          const files = pastedImages(event);
          if (files.length === 0) return;
          event.preventDefault();
          void addFiles(files);
        }}
        onKeyDown={event => {
          const key = { key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode };
          if (isComposingKey(key, composing.current)) return;
          if (showCommands) {
            if (event.key === 'ArrowDown') { event.preventDefault(); setCommandIndex(index => (index + 1) % commandMatches.length); return; }
            if (event.key === 'ArrowUp') { event.preventDefault(); setCommandIndex(index => (index - 1 + commandMatches.length) % commandMatches.length); return; }
            if (event.key === 'Enter') { event.preventDefault(); const command = commandMatches[activeCommandIndex]; if (command) insertCommand(command); return; }
            if (dismissesCommandMenu(key, composing.current, showCommands)) { event.preventDefault(); setDismissedCommand(draft); return; }
          }
          if (submitsMessage(key, composing.current)) { event.preventDefault(); void submit(); }
        }} placeholder={awaitingInput ? 'Answer the open request' : working ? 'Queue a follow-up' : !hasMessages ? 'Describe a task or ask a question' : 'Type / for commands'} disabled={!canEdit} rows={1} aria-label="Message Aster" />
      <div className="composer-chin">
        <div className="composer-left">
          <div className="menu-anchor composer-add">
            <Button variant="ghost" size="icon" className="icon-button composer-plus" aria-label="Add content" title="Add content" ref={element => { triggers.current.add = element; }} aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}><Plus size={16} /></Button>
            {menu === 'add' && <div className="popover add-menu" style={menuStyle} role="menu" aria-label="Add content" ref={menuPanel}>
              <Button variant="ghost" size="xs" role="menuitem" className="menu-row" disabled={!canEdit} onClick={() => { setMenu(null); filePicker.current?.click(); }}><ImageSquare size={16} />Add image</Button>
              <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setMenu(null); onChooseProject(); }}><FolderSimple size={16} />Open folder</Button>
            </div>}
          </div>
        </div>
        <div className="composer-right">
          {canStop && <Button variant="ghost" size="icon" className="stop-control" aria-label="Stop" title="Stop" disabled={view.runtime.status === 'stop-requested'} onClick={onAbort}><Square size={12} weight="fill" /></Button>}
          {hasDraft && <Button variant="ghost" size="icon" className={`send-button ${canSend ? 'enabled' : ''}`} aria-label={working ? 'Queue follow-up' : 'Send message'} title={working ? 'Queue follow-up' : 'Send message'} onClick={() => void submit()} disabled={!canSend}><ArrowUp size={15} weight="bold" /></Button>}
        </div>
      </div>
    </ComposerFrame>
    {dragging && <div className="composer-drop-hint" aria-hidden="true">Drop images to attach</div>}
    <div className="composer-meta">
      <div className="composer-meta-left">
        {view.activeSession && <div className="menu-anchor">
          <Button variant="ghost" size="xs" icon={<ShieldCheck size={14} />} className="permission-control" ref={element => { triggers.current.access = element; }} onClick={() => setMenu(menu === 'access' ? null : 'access')} aria-haspopup="menu" aria-expanded={menu === 'access'} title={approvalMode === 'ask' ? 'Access: confirm changes' : 'Access: auto-approve'}>Access</Button>
          {menu === 'access' && <div className="popover access-menu" style={menuStyle} role="menu" aria-label="Tool access" ref={menuPanel}>
            <div className="menu-heading">Tool access</div>
            {([
              ['ask', 'Ask before changes', 'Confirm write, edit and bash before they run.'],
              ['auto', 'Auto-approve', 'Run tools without asking.'],
            ] as const).map(([mode, name, description]) => <Button variant="ghost" size="xs" key={mode} role="menuitemradio" aria-checked={approvalMode === mode} className="menu-row" disabled={pending} onClick={() => { triggers.current.access?.focus(); setMenu(null); onSetApproval(mode); }}>
              <span className="menu-check">{approvalMode === mode && <Check size={13} />}</span>
              <span className="model-row-text"><span className="model-name">{name}</span><span className="menu-sub">{description}</span></span>
            </Button>)}
          </div>}
        </div>}
      </div>
      <div className="composer-meta-right">
        {view.models.length > 0 && <div className="menu-anchor"><Button variant="ghost" size="xs" className="composer-model" title={view.currentModel?.name ?? 'Model'} ref={element => { triggers.current.model = element; }} onClick={() => setMenu(menu === 'model' ? null : 'model')} aria-haspopup="menu" aria-expanded={menu === 'model'}>{view.currentModel?.name ?? 'Model'}</Button>
          {menu === 'model' && <div className="popover model-menu" style={menuStyle} role="menu" ref={menuPanel}><div className="menu-heading">Model</div>{view.models.map(model => <Button variant="ghost" size="xs" key={`${model.provider}/${model.id}`} role="menuitemradio" aria-checked={model.id === view.currentModel?.id && model.provider === view.currentModel?.provider} className="menu-row model-row" onClick={() => { triggers.current.model?.focus(); setMenu(null); onSetModel(model); }}><span className="model-row-text"><span className="model-name">{model.name}</span><span className="menu-sub">{model.provider}</span></span><span className="menu-check-right">{model.id === view.currentModel?.id && model.provider === view.currentModel?.provider && <Check size={14} />}</span></Button>)}</div>}
        </div>}
        {view.availableThinkingLevels.length > 0 && <div className="menu-anchor">
          <Button variant="ghost" size="xs" className="composer-control" title="Thinking level" ref={element => { triggers.current.thinking = element; }} onClick={() => setMenu(menu === 'thinking' ? null : 'thinking')} aria-haspopup="menu" aria-expanded={menu === 'thinking'}>{capitalize(view.thinkingLevel)}</Button>
          {menu === 'thinking' && <div className="popover thinking-menu" style={menuStyle} role="menu" ref={menuPanel}><div className="menu-heading">Thinking</div>{view.availableThinkingLevels.map(level => <Button variant="ghost" size="xs" key={level} role="menuitem" className="menu-row" onClick={() => { triggers.current.thinking?.focus(); setMenu(null); onSetThinking(level); }}><span className="menu-check">{view.thinkingLevel === level && <Check size={13} />}</span>{capitalize(level)}</Button>)}<p className="menu-footnote">Applies to the next turn.</p></div>}
        </div>}
        {view.activeSession
          ? <Button variant="ghost" size="icon" className="composer-usage" ref={element => { triggers.current.usage = element; }} aria-label={`Context usage: ${usage.percentLabel ?? 'unknown'}`} title={usage.title} aria-haspopup="dialog" aria-expanded={menu === 'usage'} onClick={() => setMenu(menu === 'usage' ? null : 'usage')}>
            <ContextRing usage={usage} size={14} decorative />
          </Button>
          : <ContextRing usage={usage} size={14} className="composer-ring" decorative />}
      </div>
    </div>
    {menu === 'usage' && <div className="popover usage-card" style={menuStyle} role="dialog" aria-label="Context usage" tabIndex={-1} ref={usageCard}>
      <div className="usage-card-heading">Context</div>
      <ContextUsageMeter usage={usage} />
      <div className="usage-card-section">
        <div className="usage-card-heading">API usage · session total</div>
        <ApiUsageRows stats={view.activeSession?.stats ?? null} />
        <p className="detail-footnote">Includes turns before compaction; separate from context occupancy.</p>
      </div>
      <div className="usage-card-footer">
        <Button variant="ghost" size="xs" className="usage-card-link" onClick={() => { setMenu(null); onOpenDetails(); }}>View in session details<ArrowRight size={13} /></Button>
      </div>
    </div>}
    {showCommands && <div className="popover add-menu command-menu" role="listbox" aria-label="Commands">{commandMatches.map((command, index) => <Button variant="ghost" size="xs" role="option" aria-selected={index === activeCommandIndex} data-command-index={index} onMouseEnter={() => setCommandIndex(index)} key={`${command.source}/${command.name}`} className={`menu-row${index === activeCommandIndex ? ' is-active' : ''}`} onClick={() => insertCommand(command)}><span className="menu-check">/</span><span>{command.name}{command.description ? ` · ${command.description}` : ''}</span></Button>)}</div>}
    {preview !== null && <ImageLightbox images={attachments} startIndex={preview} onClose={() => setPreview(null)} returnFocus={previewOpener} />}
  </div>;
}
