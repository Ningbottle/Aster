import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { QuestionDialog } from '../../src/renderer/QuestionDialog';

describe('unreadable question payload', () => {
  test('renders a cancel-only fallback instead of mapping invalid options', () => {
    const markup = renderToStaticMarkup(<QuestionDialog
      args={{ questions: [] }}
      invalid
      onReply={() => {}}
      pending={false}
      error={null}
    />);

    expect(markup).toContain('Question unavailable');
    expect(markup).toContain('cannot read');
    expect(markup).toContain('Cancel question');
    expect(markup).not.toContain('Send answers');
  });
});
