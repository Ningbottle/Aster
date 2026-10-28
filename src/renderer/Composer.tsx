import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { ArrowRight, ArrowUp, Check, FolderSimple, ImageSquare, Plus, Prohibit, ShieldCheck, Square, X } from '@phosphor-icons/react';
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_MAX_BASE64_BYTES,
  base64EncodedLength,
  type ApprovalMode,
  type FileNode,
  type SlashCommandInfo,
  type ThinkingLevel,
  type WireModel,
} from '@thinkrail/contracts';
import type { DesktopView } from './desktop-state';
import type { WsClient } from './client';
import type { UiImage } from './model';
import { CdsButton as Button } from './cds/Button';
import { ComposerFrame } from './cds/Composer';
import { ContextRing } from './ContextRing';
import { ImageLightbox, imageSource } from './ImageAttachment';
import { ApiUsageRows, ContextUsageMeter } from './UsageCard';
import { contextWindowUsage } from './usage';
import { dismissesCommandMenu, isComposingKey, submitsMessage } from './composer-keys';
import { filterMentions, mentionAt, mentionInsertion, splitMentionQuery, type MentionToken } from './composer-mentions';
import { FileIcon } from './FileIcon';
import { useMenuFocus } from './menu-focus';
import { EffortSelector } from './cds/EffortSelector';
import { ModelSwitcher } from './cds/ModelSwitcher';

type ComposerMenu = 'model' | 'access' | 'add' | 'usage';

function matchingCommands(commands: SlashCommandInfo[], draft: string): { query: string; matches: SlashCommandInfo[] } | null {
  const match = /^\/(\S*)$/.exec(draft);
  if (!match) return null;
  const query = match[1].toLocaleLowerCase();
  return { query, matches: commands.filter(command => command.name.toLocaleLowerCase().startsWith(query)).slice(0, 12) };
}

interface ComposerAttachment extends UiImage {
  id: string;
  name: string;
}

interface Draft {
  text: string;
  images: ComposerAttachment[];
  origin: 'draft' | 'unconfirmed';
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

export function PromptComposer({ onChooseProject, view, client, onSend, onAbort, onSetApproval, onSetModel, onSetThinking, onOpenDetails, pending, awaitingInput }: {
  view: DesktopView; client: WsClient; onChooseProject: () => void; onSend: (text: string, images: UiImage[]) => Promise<boolean>;
  onAbort: () => void; onSetApproval: (mode: ApprovalMode) => void;
  onSetModel: (model: WireModel) => void; onSetThinking: (level: ThinkingLevel) => void; onOpenDetails: () => void; pending: boolean; awaitingInput: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [draftOrigin, setDraftOrigin] = useState<Draft['origin']>('draft');
  const [dismissedCommand, setDismissedCommand] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [menu, setMenu] = useState<ComposerMenu | null>(null);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [mentionFiles, setMentionFiles] = useState<FileNode[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [menuBox, setMenuBox] = useState<{ left: number; bottom: number } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const usageCard = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const previewOpener = useRef<HTMLElement | null>(null);
  const triggers = useRef<Partial<Record<ComposerMenu, HTMLButtonElement | null>>>({});
  useMenuFocus(menu, menuPanel, menuBox !== null);
  const identity = view.activeSession?.session.sessionId ?? '';
  const previousIdentity = useRef(identity);
  /** Drafts survive switching sessions; a sent draft is removed, an empty draft is not stored. */
  const drafts = useRef(new Map<string, Draft>());
  const [savedDrafts, setSavedDrafts] = useState<Map<string, Draft[]>>(() => new Map());
  const recoverable = savedDrafts.get(identity) ?? [];
  const connected = view.connection === 'connected';
  const canEdit = !!view.activeSession && connected && !view.loading && !view.sessionAction;
  /** Before a session exists the text can't be sent, but the model choice is real: `session.create` applies it. */
  const canConfigureModel = connected && !view.loading;
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
  const workspaceId = view.activeSession?.workspace?.id ?? null;
  const mentionQuery = mention?.query ?? null;
  const showMentions = canEdit && !awaitingInput && !showCommands && mentionQuery !== null && mentionFiles.length > 0;
  const activeMentionIndex = showMentions ? Math.min(mentionIndex, mentionFiles.length - 1) : -1;
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
  const storeDraft = (text: string, images: ComposerAttachment[], origin = draftOrigin) => {
    if (!identity) return;
    if (text || images.length > 0) drafts.current.set(identity, { text, images, origin });
    else drafts.current.delete(identity);
  };
  const changeDraft = (value: string) => {
    setDraft(value);
    const origin = !value && attachments.length === 0 ? 'draft' : draftOrigin;
    setDraftOrigin(origin);
    storeDraft(value, attachments, origin);
    setMention(mentionAt(value, textarea.current?.selectionStart ?? value.length));
  };
  const changeAttachments = (update: (current: ComposerAttachment[]) => ComposerAttachment[]) => {
    setAttachments(current => {
      const next = update(current);
      const origin = !textareaDraft.current && next.length === 0 ? 'draft' : draftOrigin;
      setDraftOrigin(origin);
      storeDraft(textareaDraft.current, next, origin);
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
    setMention(null);
    setMentionFiles([]);
    const saved = identity ? drafts.current.get(identity) : undefined;
    setDraft(saved?.text ?? '');
    setDraftOrigin(saved?.origin ?? 'draft');
    setAttachments(saved?.images ?? []);
    if (textarea.current) textarea.current.style.height = 'auto';
  }, [identity]);
  useEffect(resize, [draft]);
  useEffect(() => { setCommandIndex(0); }, [draft, commandMatches.length]);
  useEffect(() => {
    if (!showCommands) return;
    region.current?.querySelector<HTMLElement>(`.command-menu [data-command-index="${activeCommandIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeCommandIndex, showCommands]);
  /** File references read one directory per segment; the debounce keeps typing cheap. */
  useEffect(() => {
    if (mentionQuery === null || !workspaceId) { setMentionFiles([]); return; }
    let active = true;
    const { dir, filter } = splitMentionQuery(mentionQuery);
    const timer = window.setTimeout(() => {
      void client.request('fs.readDir', { workspaceId, path: dir }).then(nodes => {
        if (!active) return;
        setMentionFiles(filterMentions(nodes, filter));
        setMentionIndex(0);
      }, () => { if (active) setMentionFiles([]); });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mentionQuery, workspaceId, client]);
  useEffect(() => {
    if (!menu) { setMenuBox(null); return; }
    const trigger = triggers.current[menu];
    if (!trigger) return;
    const widths = { model: 320, access: 310, add: 184, usage: 322 } as const;
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
    const outside = (event: Event) => {
      const surface = menu === 'usage' ? usageCard.current : menuPanel.current;
      if (!surface?.contains(event.target as Node) && !triggers.current[menu]?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      triggers.current[menu]?.focus(); setMenu(null);
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
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
    setDraftOrigin('draft');
    setAttachments([]);
    setPreview(null);
    setDismissedCommand(null);
    storeDraft('', []);
    if (await onSend(text, sent.map(({ data, mimeType }) => ({ data, mimeType })))) return;
    // An acknowledgement may be lost after execution. Keep the draft marked unconfirmed,
    // including when there is no newer input; restoring never resends it automatically.
    const unsent: Draft = { text, images: sent, origin: 'unconfirmed' };
    setSavedDrafts(previous => new Map(previous).set(identity, [...(previous.get(identity) ?? []), unsent]));
  }
  function restoreSavedDraft() {
    const saved = recoverable[0];
    if (!saved) return;
    const current: Draft = { text: textareaDraft.current, images: attachmentRef.current, origin: draftOrigin };
    setSavedDrafts(previous => {
      const next = new Map(previous);
      const remaining = (next.get(identity) ?? []).filter(item => item !== saved);
      if (current.text || current.images.length) remaining.push(current);
      if (remaining.length) next.set(identity, remaining); else next.delete(identity);
      return next;
    });
    setDraft(saved.text); setDraftOrigin(saved.origin); setAttachments(saved.images); storeDraft(saved.text, saved.images, saved.origin);
    setMention(null); setDismissedCommand(null); textarea.current?.focus();
  }
  function insertCommand(command: SlashCommandInfo) {
    changeDraft(`/${command.name} `);
    textarea.current?.focus();
  }
  /** Directory picks keep the panel open on the next segment; files close it. */
  function applyMention(node: FileNode) {
    if (!mention) return;
    const caret = textarea.current?.selectionStart ?? draft.length;
    const insertion = mentionInsertion(node);
    const next = draft.slice(0, mention.start) + insertion + draft.slice(caret);
    const end = mention.start + insertion.length;
    setDraft(next);
    storeDraft(next, attachments);
    setMention(node.kind === 'dir' ? mentionAt(next, end) : null);
    if (node.kind !== 'dir') setMentionFiles([]);
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(end, end);
    });
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
    {(recoverable.length > 0 || draftOrigin === 'unconfirmed') && <div className="composer-recovery" role="status"><span>
      {(draftOrigin === 'unconfirmed' || recoverable.some(item => item.origin === 'unconfirmed')) && <>Message delivery is unconfirmed. Check the conversation before retrying. </>}
      {recoverable.filter(item => item.origin === 'draft').length > 0 && <>{recoverable.filter(item => item.origin === 'draft').length} unsent draft saved. </>}
      {recoverable.filter(item => item.origin === 'unconfirmed').length > 0 && <>{recoverable.filter(item => item.origin === 'unconfirmed').length} unconfirmed message saved.</>}
    </span>{recoverable.length > 0 && <Button variant="secondary" size="xs" disabled={!canEdit || awaitingInput} title={recoverable[0].text.slice(0, 160)} onClick={restoreSavedDraft}>Restore saved draft</Button>}</div>}
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
          if (showMentions) {
            if (event.key === 'ArrowDown') { event.preventDefault(); setMentionIndex(index => (index + 1) % mentionFiles.length); return; }
            if (event.key === 'ArrowUp') { event.preventDefault(); setMentionIndex(index => (index - 1 + mentionFiles.length) % mentionFiles.length); return; }
            if (event.key === 'Enter') { event.preventDefault(); const node = mentionFiles[activeMentionIndex]; if (node) applyMention(node); return; }
            if (event.key === 'Escape') { event.preventDefault(); setMention(null); setMentionFiles([]); return; }
          }
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
          <Button variant="ghost" size="xs" icon={approvalMode === 'ask' ? <ShieldCheck size={14} /> : <Prohibit size={14} />} className="permission-control" ref={element => { triggers.current.access = element; }} onClick={() => setMenu(menu === 'access' ? null : 'access')} aria-haspopup="menu" aria-expanded={menu === 'access'} title={approvalMode === 'ask' ? 'Access: confirm changes' : 'Access: auto-approve'}>{approvalMode === 'ask' ? 'Ask before changes' : 'Auto accept edits'}</Button>
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
        {view.models.length > 0 && <ModelSwitcher models={view.models} currentModel={view.currentModel} effort={view.thinkingLevel}
          disabled={!canConfigureModel || pending || awaitingInput} open={menu === 'model'} onOpenChange={open => setMenu(open ? 'model' : null)} onChooseModel={onSetModel}
          triggerRef={element => { triggers.current.model = element; }} panelRef={menuPanel} menuStyle={menuStyle}>
          {view.availableThinkingLevels.length > 0 && <EffortSelector levels={view.availableThinkingLevels} value={view.thinkingLevel}
            onChange={onSetThinking} disabled={!canConfigureModel || pending || awaitingInput} />}
        </ModelSwitcher>}
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
    {showMentions && <div className="popover add-menu mention-menu" role="listbox" aria-label="Files">{mentionFiles.map((node, index) => <Button variant="ghost" size="xs" role="option" aria-selected={index === activeMentionIndex} key={node.path} onMouseEnter={() => setMentionIndex(index)} className={`menu-row${index === activeMentionIndex ? ' is-active' : ''}`} onClick={() => applyMention(node)}>{node.kind === 'dir' ? <FolderSimple size={14} /> : <FileIcon path={node.path} size={14} />}<span className="mention-path">{node.path}</span></Button>)}</div>}
    {preview !== null && <ImageLightbox images={attachments} startIndex={preview} onClose={() => setPreview(null)} returnFocus={previewOpener} />}
  </div>;
}
