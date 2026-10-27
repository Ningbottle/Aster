import { describe, expect, test } from 'vitest';
import { parseAskUserQuestionArgs } from '../../src/renderer/question-schema';

const valid = {
  questions: [{
    header: 'Target',
    question: 'Which target?',
    options: [
      { label: 'Local', description: 'This workspace', preview: 'preview text', recommendedReason: 'fast' },
      { label: 'Remote', description: 'Another host' },
    ],
    multiSelect: false,
  }],
};

describe('ask_user_question payload', () => {
  test('normalizes a valid payload and keeps optional fields', () => {
    expect(parseAskUserQuestionArgs(valid)).toEqual(valid);
  });

  test('rejects a non-array options field instead of passing it to the dialog', () => {
    expect(parseAskUserQuestionArgs({ questions: [{ header: 'Target', question: 'Which?', options: 42 }] })).toBeNull();
  });

  test('rejects empty questions and malformed optional fields', () => {
    expect(parseAskUserQuestionArgs({ questions: [] })).toBeNull();
    expect(parseAskUserQuestionArgs({ questions: [{ header: 'T', question: 'Q', options: [], multiSelect: 'yes' }] })).toBeNull();
    expect(parseAskUserQuestionArgs({
      questions: [{ header: 'T', question: 'Q', options: [{ label: 'A', description: 'B', preview: 42 }] }],
    })).toBeNull();
  });

  test('rejects values that are not the host question shape', () => {
    expect(parseAskUserQuestionArgs(null)).toBeNull();
    expect(parseAskUserQuestionArgs({ questions: 'nope' })).toBeNull();
    expect(parseAskUserQuestionArgs({ questions: [{ header: 'T' }] })).toBeNull();
  });
});
