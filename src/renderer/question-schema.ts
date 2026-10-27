import type { AskUserQuestionArgs, AskUserQuestionItem, AskUserQuestionOption } from '@thinkrail/contracts';

type UnknownRecord = Record<string, unknown>;

function recordOf(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/**
 * Validates the host's ask_user_question payload before the renderer maps it.
 * A malformed or replayed transcript must not reach JSX array methods.
 */
export function parseAskUserQuestionArgs(value: unknown): AskUserQuestionArgs | null {
  const root = recordOf(value);
  if (!root || !Array.isArray(root.questions) || root.questions.length === 0) return null;
  const questions: AskUserQuestionItem[] = [];
  for (const rawQuestion of root.questions) {
    const question = recordOf(rawQuestion);
    if (!question
      || typeof question.question !== 'string'
      || typeof question.header !== 'string'
      || !Array.isArray(question.options)
      || (question.multiSelect !== undefined && typeof question.multiSelect !== 'boolean')) return null;
    const options: AskUserQuestionOption[] = [];
    for (const rawOption of question.options) {
      const option = recordOf(rawOption);
      if (!option
        || typeof option.label !== 'string'
        || typeof option.description !== 'string'
        || !optionalText(option.preview)
        || !optionalText(option.recommendedReason)) return null;
      options.push({
        label: option.label,
        description: option.description,
        ...(option.preview === undefined ? {} : { preview: option.preview }),
        ...(option.recommendedReason === undefined ? {} : { recommendedReason: option.recommendedReason }),
      });
    }
    questions.push({
      question: question.question,
      header: question.header,
      options,
      ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
    });
  }
  return { questions };
}
