import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WireAgentMessage } from '@thinkrail/contracts';
import { ImageBlock, imageSource } from '../../src/renderer/ImageAttachment';
import { toUiMessage } from '../../src/renderer/model';

const image = { type: 'image' as const, data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' };

describe('native image content', () => {
  it('keeps the base64 payload and media type from Pi instead of a placeholder', () => {
    const message = { role: 'user', content: [{ type: 'text', text: '看看这张图' }, image], timestamp: 1 } as WireAgentMessage;
    const rendered = toUiMessage(message);

    expect(rendered?.content).toEqual([
      { type: 'text', text: '看看这张图' },
      { type: 'image', data: image.data, mimeType: image.mimeType },
    ]);
  });

  it('keeps images that arrive inside a tool result next to its text', () => {
    const message = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{ type: 'text', text: 'Read image file [image/png]' }, image],
      timestamp: 2,
      isError: false,
    } as WireAgentMessage;
    const rendered = toUiMessage(message);

    expect(rendered?.content.map(part => part.type)).toEqual(['text', 'image']);
    expect(rendered?.content[1]).toEqual({ type: 'image', data: image.data, mimeType: image.mimeType });
  });

  it('builds a data URL only for display', () => {
    expect(imageSource({ data: 'AAAA', mimeType: 'image/webp' })).toBe('data:image/webp;base64,AAAA');
  });

  it('renders one labelled thumbnail per attached image', () => {
    const markup = renderToStaticMarkup(<ImageBlock images={[
      { data: 'AAAA', mimeType: 'image/png' },
      { data: 'BBBB', mimeType: 'image/png' },
    ]} />);

    expect(markup).toContain('class="image-grid assistant"');
    expect(markup).toContain('aria-label="Open image 1 of 2"');
    expect(markup).toContain('aria-label="Open image 2 of 2"');
    expect(markup).toContain('src="data:image/png;base64,AAAA"');
    expect(markup).toContain('loading="lazy"');
  });
});
