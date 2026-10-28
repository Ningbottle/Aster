import { useRef, useState } from 'react';
import type { AskUserQuestionArgs, AskUserQuestionAnswer, AskUserQuestionResult } from '@thinkrail/contracts';
import { CdsButton } from './cds/Button';
import { useModalFocus } from './modal-focus';

/** multi keeps the checked list and the typed answer side by side; a single choice and a custom text stay exclusive. */
export function buildQuestionAnswers(
  args: AskUserQuestionArgs,
  choices: Record<number, string[]>,
  custom: Record<number, string>,
): AskUserQuestionAnswer[] {
  return args.questions.map((question, index) => {
    const base = { questionIndex: index, question: question.question };
    const text = custom[index]?.trim();
    const selected = choices[index] ?? [];
    if (question.multiSelect) return { ...base, kind: 'multi', selected, answer: text || null };
    if (text) return { ...base, kind: 'custom', answer: text };
    return { ...base, kind: 'option', answer: selected[0] ?? null };
  });
}

export function cancelledQuestionResult(): AskUserQuestionResult {
  return { answers: [], cancelled: true };
}

export function QuestionDialog({ args, invalid = false, onReply, pending, error }: {
  args: AskUserQuestionArgs; invalid?: boolean; onReply: (result: AskUserQuestionResult) => void; pending: boolean; error: string | null;
}) {
  const [choices, setChoices] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { fallbackFocusSelector: '[aria-label="Message Aster"]' });
  const complete = !invalid && args.questions.every((_, index) => choices[index]?.length || custom[index]?.trim());
  const cancel = () => onReply(cancelledQuestionResult());
  const submit = () => onReply({ answers: buildQuestionAnswers(args, choices, custom), cancelled: false });
  return <div className="modal-scrim" ref={layer}>
    <form className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="question-dialog-title"
      style={{ maxHeight: '80vh', overflowY: 'auto' }}
      onKeyDown={event => { if (event.key === 'Escape' && !pending && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); cancel(); } }}
      onSubmit={event => { event.preventDefault(); if (complete && !pending) submit(); }}>
      <h2 id="question-dialog-title">{invalid ? 'Question unavailable' : 'Pi needs your input'}</h2>
      {invalid
        ? <p role="alert">The host sent a question this client cannot read. Cancel it to let the session continue.</p>
        : args.questions.map((question, index) => <fieldset key={index} disabled={pending} style={{ border: 0, padding: '12px 0' }}>
        <legend>{question.header}</legend>
        <p>{question.question}</p>
        {question.options.map(option => <label key={option.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '8px 0' }}>
          <input type={question.multiSelect ? 'checkbox' : 'radio'} name={`question-${index}`} style={{ width: 'auto', marginTop: 3 }}
            checked={choices[index]?.includes(option.label) ?? false}
            onChange={event => {
              const checked = event.target.checked;
              if (!question.multiSelect) setCustom(value => ({ ...value, [index]: '' }));
              setChoices(value => ({ ...value, [index]: question.multiSelect
                ? checked ? [...(value[index] ?? []), option.label] : (value[index] ?? []).filter(label => label !== option.label)
                : [option.label] }));
            }} />
          <span><strong>{option.label}</strong><span className="detail-subtle" style={{ display: 'block' }}>{option.description}</span>
            {option.preview && <pre style={{ whiteSpace: 'pre-wrap' }}>{option.preview}</pre>}</span>
        </label>)}
        <input aria-label={`Other answer for ${question.header}`} placeholder="Or enter your own answer" value={custom[index] ?? ''}
          onChange={event => {
            const value = event.target.value;
            setCustom(current => ({ ...current, [index]: value }));
            if (!question.multiSelect) setChoices(current => ({ ...current, [index]: [] }));
          }} />
      </fieldset>)}
      {error && <p role="alert">{error}</p>}
      <div className="rename-actions"><CdsButton variant="secondary" size="sm" disabled={pending} onClick={cancel}>{invalid ? 'Cancel question' : 'Cancel'}</CdsButton>
        {!invalid && <CdsButton variant="brand" size="sm" type="submit" disabled={pending || !complete}>Send answers</CdsButton>}</div>
    </form>
  </div>;
}
