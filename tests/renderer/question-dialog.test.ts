import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AskUserQuestionArgs } from '@thinkrail/contracts';
import { buildQuestionAnswers, cancelledQuestionResult, QuestionDialog } from '../../src/renderer/QuestionDialog';

const multi: AskUserQuestionArgs = {
  questions: [{
    header: 'Targets',
    question: 'Which targets should be updated?',
    multiSelect: true,
    options: [
      { label: 'Local', description: 'This workspace' },
      { label: 'Remote', description: 'The deployed environment' },
    ],
  }],
};

const single: AskUserQuestionArgs = {
  questions: [{
    header: 'Scope',
    question: 'Which scope?',
    options: [
      { label: 'Minimal', description: 'Only the fix' },
      { label: 'Full', description: 'Fix and cleanup' },
    ],
  }],
};

describe('question answers', () => {
  test('a multi-select answer keeps checked options and the typed Other answer', () => {
    expect(buildQuestionAnswers(multi, { 0: ['Local', 'Remote'] }, { 0: '  also staging  ' })[0]).toMatchObject({
      kind: 'multi',
      selected: ['Local', 'Remote'],
      answer: 'also staging',
    });
  });

  test('a multi-select answer without Other text has a null answer', () => {
    expect(buildQuestionAnswers(multi, { 0: ['Local'] }, {})[0]).toMatchObject({
      kind: 'multi',
      selected: ['Local'],
      answer: null,
    });
  });

  test('a multi-select answer with only Other text keeps an empty selection', () => {
    expect(buildQuestionAnswers(multi, {}, { 0: 'only my own words' })[0]).toMatchObject({
      kind: 'multi',
      selected: [],
      answer: 'only my own words',
    });
  });

  test('a single choice and Other stay mutually exclusive', () => {
    expect(buildQuestionAnswers(single, { 0: ['Minimal'] }, {})[0]).toMatchObject({ kind: 'option', answer: 'Minimal' });
    expect(buildQuestionAnswers(single, {}, { 0: 'custom' })[0]).toMatchObject({ kind: 'custom', answer: 'custom' });
    expect(buildQuestionAnswers(single, { 0: ['Minimal'] }, { 0: 'custom' })[0]).toMatchObject({ kind: 'custom', answer: 'custom' });
  });

  test('cancelling reports no answers', () => {
    expect(cancelledQuestionResult()).toEqual({ answers: [], cancelled: true });
  });

  test('renders checkboxes for multi-select and disables answers while pending', () => {
    const idle = renderToStaticMarkup(createElement(QuestionDialog, { args: multi, onReply: () => {}, pending: false, error: null }));
    const pending = renderToStaticMarkup(createElement(QuestionDialog, { args: multi, onReply: () => {}, pending: true, error: null }));

    expect(idle).toContain('type="checkbox"');
    expect(pending).toMatch(/<fieldset[^>]*disabled/);
    expect((pending.match(/disabled=""/g) ?? []).length).toBeGreaterThan((idle.match(/disabled=""/g) ?? []).length);
  });

  test('shows a reply failure inside the dialog', () => {
    const markup = renderToStaticMarkup(createElement(QuestionDialog, {
      args: single,
      onReply: () => {},
      pending: false,
      error: 'connection lost',
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('connection lost');
  });
});
