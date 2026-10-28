// Isolated acceptance helpers. They observe real WS traffic; holds inject transport faults/latency only.
export function installWireObserver() {
  if (window !== window.top) return;
  if (window.__asterTestWire) return;
  const originalSend = WebSocket.prototype.send;
  const messageProperty = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  if (!messageProperty?.set || !messageProperty.get) throw new Error('WebSocket message observation is unavailable.');
  const methods = new Map();
  const observedReplyMethods = new Set(['session.create', 'session.getMessages', 'session.getCommands', 'session.getStats']);
  const wire = window.__asterTestWire = { requests: [], replies: [], holdMethod: null, held: [], interruptText: null, interruptedSocket: null,
    hold(methods) { this.holdMethod = new Set(methods); },
    release() { const pending = this.held.splice(0); this.holdMethod = null; for (const deliver of pending) deliver(); } };
  if (sessionStorage.getItem('aster-test-hold-conversation') === '1') {
    sessionStorage.removeItem('aster-test-hold-conversation'); wire.holdMethod = 'session.getMessages';
  }
  Object.defineProperty(WebSocket.prototype, 'onmessage', { configurable: true, enumerable: messageProperty.enumerable,
    get() { return messageProperty.get.call(this); },
    set(handler) {
      if (!handler) { messageProperty.set.call(this, handler); return; }
      messageProperty.set.call(this, event => {
        let frame;
        try { frame = JSON.parse(event.data); } catch { handler.call(this, event); return; }
        const method = methods.get(frame.id);
        if (method && 'ok' in frame && method.startsWith('session.set')) wire.replies.push({ method, frame });
        else if (method && observedReplyMethods.has(method) && 'ok' in frame) {
          const result = method === 'session.create'
            ? { sessionId: frame.result?.sessionId, model: frame.result?.model && { id: frame.result.model.id, name: frame.result.model.name, provider: frame.result.model.provider }, thinkingLevel: frame.result?.thinkingLevel }
            : method === 'session.getMessages'
              ? { summary: frame.result?.summary && { sessionId: frame.result.summary.sessionId } }
              : undefined;
          wire.replies.push({ method, frame: { id: frame.id, ok: frame.ok, ...(frame.error ? { error: frame.error } : {}), ...(result ? { result } : {}) } });
        }
        const hold = wire.holdMethod instanceof Set ? wire.holdMethod.has(method) : method === wire.holdMethod;
        if (method && hold && 'ok' in frame) wire.held.push(() => handler.call(this, event));
        else handler.call(this, event);
      });
    },
  });
  WebSocket.prototype.send = function(data) {
    let frame;
    try { frame = typeof data === 'string' ? JSON.parse(data) : null; } catch { return originalSend.call(this, data); }
    if (frame?.method) {
      methods.set(frame.id, frame.method);
      wire.requests.push({ id: frame.id, method: frame.method,
        params: frame.method === 'session.create' || frame.method.startsWith('session.set') ? frame.params
          : { sessionId: frame.params?.sessionId, text: frame.params?.text?.startsWith('AUDIT_') ? frame.params.text : undefined } });
      if (frame.params?.text === wire.interruptText && frame.method === 'session.prompt') {
        wire.interruptedSocket = this; return;
      }
    }
    return originalSend.call(this, data);
  };
}

export async function verifyEffort({ page, check, capture }) {
  const model = page.getByRole('button', { name: /^Model:/ });
  const menu = () => page.getByRole('menu', { name: 'Model', exact: true });
  const sliderOf = () => page.getByRole('slider', { name: 'Thinking effort', exact: true });
  const labels = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' };
  const sent = () => page.evaluate(() => window.__asterTestWire.requests.filter(item => item.method === 'session.setThinkingLevel').length);

  await model.click();
  await menu().waitFor();
  await sliderOf().waitFor();
  check('the picker opens on the current model and its effort', await menu().locator('.model-switcher-current').isVisible()
    && await menu().locator('.effort-inline').isVisible());
  check('the model list stays closed until the model row is used', await menu().locator('.model-switcher-options').count() === 0);
  check('the model row sits above the effort track', await page.evaluate(() => {
    const row = document.querySelector('.model-switcher-current');
    const effort = document.querySelector('.effort-inline');
    return Boolean(row && effort && row.compareDocumentPosition(effort) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  const levels = await menu().locator('[data-effort-level]').evaluateAll(nodes => nodes.map(node => node.dataset.effortLevel));
  check('every level the model reports stays on the same track', levels.length >= 2 && new Set(levels).size === levels.length);
  check('no level is pushed outside the track as a separate row', await menu().locator('.effort-additional').count() === 0);
  check('every level on the track has a tick', await menu().locator('.effort-tick').count() === levels.length);
  check('the track has no separate row of level labels', await menu().locator('.effort-labels').count() === 0);
  check('the model trigger carries no lightning glyph', await model.locator('svg').count() === 0);
  await capture('desktop-ui-thinking-effort-1280x840.png');
  const rect = await sliderOf().boundingBox();
  assertBox(rect);
  const lowest = levels[0];
  const highest = levels[levels.length - 1];
  const start = await sent();
  await page.mouse.move(rect.x + rect.width - 8, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 6, rect.y + rect.height / 2, { steps: 8 });
  check('dragging previews locally without sending', await sent() === start && await sliderOf().getAttribute('aria-valuetext') === labels[lowest]);
  await page.mouse.up();
  await page.waitForFunction(level => window.__asterTestWire.replies.some(item => item.method === 'session.setThinkingLevel' && item.frame.result?.thinkingLevel === level), lowest);
  check('releasing commits exactly once', await sent() === start + 1);
  check('the trigger shows the level that took effect', ((await model.getAttribute('aria-label')) ?? '').includes('effort: ' + labels[lowest]));
  check('choosing a level keeps the picker open for the next change', await menu().isVisible());
  await sliderOf().press('End');
  await page.waitForFunction(level => window.__asterTestWire.replies.some(item => item.method === 'session.setThinkingLevel' && item.frame.result?.thinkingLevel === level), highest);
  check('End selects the highest reported level', await sliderOf().getAttribute('aria-valuetext') === labels[highest]);
  await page.keyboard.press('Escape');
  check('Escape closes the picker', await menu().count() === 0);
  await page.reload();
  await page.getByRole('button', { name: /^Model:/ }).waitFor();
  await page.waitForFunction(() => {
    const input = document.querySelector('textarea[aria-label="Message Aster"]');
    return input && !input.disabled && !document.querySelector('.conversation-loading');
  });
  check('the effective level survives a renderer reload', ((await model.getAttribute('aria-label')) ?? '').includes('effort: ' + labels[highest]));
}
function assertBox(box) { if (!box) throw new Error('The effort slider has no visible geometry.'); }

export async function verifyCompactWindow({ page, electronApp, check, capture }) {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600));
  // Windows frame/DPI rounding can add two CSS px at the native minimum size.
  await page.waitForFunction(() => Math.abs(window.innerWidth - 800) <= 4 && Math.abs(window.innerHeight - 600) <= 4);
  const withinViewport = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
  await page.getByRole('button', { name: /^Model:/ }).click();
  const menu = page.getByRole('menu', { name: 'Model', exact: true });
  await menu.waitFor();
  check('the model menu fits the minimum window', await withinViewport(menu));
  // The effort track lives inside the model menu now.
  // The effort track lives inside the model menu now.
  await page.getByRole('slider', { name: 'Thinking effort', exact: true }).waitFor();
  check('the effort track fits the minimum window', await withinViewport(menu.locator('.effort-inline')));
  await capture('desktop-ui-thinking-effort-800x600.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('menu', { name: 'Model', exact: true }).waitFor({ state: 'detached' });
  check('minimum window has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 840));
  await page.waitForFunction(() => Math.abs(window.innerWidth - 1280) <= 2 && Math.abs(window.innerHeight - 840) <= 2);
}

/** Reads the platform faces Chromium actually used, not the declared CSS stack. */
export async function verifyFonts({ page, check }) {
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'aster-font-probe';
    host.innerHTML = '<div class="assistant-message"><div class="rich-text"><p id="font-prose-probe">中文 English 123</p></div></div>'
      + '<pre id="font-code-probe" class="bash-command">const value = 1;</pre>';
    document.body.append(host);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const familiesFor = async selector => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`The font probe node ${selector} was not found.`);
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    if (!fonts.length) throw new Error(`Chromium reported no platform font for ${selector}.`);
    return fonts.map(font => font.familyName);
  };
  const prose = await familiesFor('#font-prose-probe');
  const code = await familiesFor('#font-code-probe');
  await cdp.detach();
  await page.evaluate(() => document.querySelector('#aster-font-probe')?.remove());
  check('UI text loads the shipped Inter face for Latin glyphs', prose.includes('Inter'), prose.join(', '));
  check('CJK glyphs resolve to a real Windows CJK family', prose.some(name => /YaHei|SimSun|DengXian/i.test(name)), prose.join(', '));
  check('code glyphs use the bundled Cascadia Mono face', code.some(name => /Cascadia Mono/i.test(name)), code.join(', '));
}

/** The fixture answer ends with a fenced TypeScript block; tokens must come from Prism. */
export async function verifyCodeHighlight({ page, check, capture }) {
  const block = page.locator('.code-block').first();
  await block.waitFor();
  await page.locator('.conversation-scroll').evaluate(el => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForFunction(() => !document.querySelector('.jump-latest'));
  const originalBlock = await block.elementHandle();
  await page.locator('.conversation-scroll').evaluate(el => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check('scrolling keeps the rendered code block mounted', !!originalBlock && await originalBlock.evaluate(el => el.isConnected));
  await originalBlock?.dispose();
  await block.scrollIntoViewIfNeeded();
  const keyword = await block.locator('.tok-keyword').allTextContents();
  const string = await block.locator('.tok-string').allTextContents();
  const comment = await block.locator('.tok-comment').allTextContents();
  check('fenced TypeScript is tokenized into React spans', keyword.includes('const')
    && string.some(text => text.includes('首页'))
    && comment.some(text => text.includes('中文注释')), JSON.stringify({ keyword, string, comment }));
  check('a highlighted block keeps its real copy affordance', await block.getByRole('button', { name: 'Copy code', exact: true }).count() === 1);
  await capture('desktop-ui-code-highlight-1280x840.png');
  await page.locator('.conversation-scroll').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).waitFor();
  check('the circular jump control appears after leaving the live edge', await page.locator('.jump-latest').isVisible());
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  await page.waitForFunction(() => {
    const scroller = document.querySelector('.conversation-scroll');
    return !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 40;
  });
  check('jump-to-latest returns to the live edge and hides itself', await page.locator('.jump-latest').count() === 0);
}

export async function verifyShellMenus({ page, check }) {
  const composer = page.getByRole('textbox', { name: 'Message Aster' });
  for (const [name, trigger] of [
    ['Session menu', page.getByRole('button', { name: 'Session menu', exact: true })],
    ['More', page.getByRole('button', { name: 'More', exact: true })],
    ['Session title', page.locator('button.pane-title')],
  ]) {
    await trigger.click();
    await page.waitForFunction(() => document.querySelector('[role="menu"] [role^="menuitem"]') === document.activeElement);
    await composer.focus();
    check(`${name} closes when keyboard focus leaves`, await trigger.getAttribute('aria-expanded') === 'false');
    await trigger.click();
    await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
    check(`${name} ignores a composing Escape`, await trigger.getAttribute('aria-expanded') === 'true');
    await page.keyboard.press('Escape');
    check(`${name} dismisses on Escape and restores its trigger`, await trigger.getAttribute('aria-expanded') === 'false' && await trigger.evaluate(el => el === document.activeElement));
  }
}

async function setContentSize(electronApp, page, width, height) {
  await electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await page.waitForFunction(({ width: w, height: h }) => Math.abs(innerWidth - w) <= 2 && Math.abs(innerHeight - h) <= 2, { width, height });
}

export async function verifyRightCards({ page, electronApp, check, capture }) {
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  const panel = page.locator('.details-panel');
  const environment = panel.locator('.info-card').filter({ has: page.locator('summary').filter({ hasText: /^Environment$/ }) });
  const context = panel.locator('.context-card');
  await panel.waitFor();
  const cardWidth = () => environment.evaluate(el => el.getBoundingClientRect().width);
  check('right information uses fixed small cards without a sidebar edge', Math.abs(await cardWidth() - 280) <= 1
    && await panel.evaluate(el => getComputedStyle(el).borderLeftWidth === '0px' && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'));
  await environment.locator('summary').click();
  check('Environment collapses without changing its width', await environment.getAttribute('open') === null && Math.abs(await cardWidth() - 280) <= 1);
  await environment.locator('summary').click();
  await context.locator(':scope > summary').click();
  check('Context expands its own card', await context.locator('.context-bar').isVisible());
  await context.locator(':scope > summary').click();
  check('Context collapses without changing its width', await context.getAttribute('open') === null
    && await context.evaluate(el => Math.abs(el.getBoundingClientRect().width - 280) <= 1));
  await capture('desktop-ui-right-cards-1280x840.png');
  await setContentSize(electronApp, page, 800, 600);
  check('right cards keep their width at the minimum window', Math.abs(await cardWidth() - 280) <= 1);
  check('narrow cards float above the conversation without squeezing it', await page.locator('.workspace-overlay.is-cards').count() === 1
    && await page.locator('.workspace').evaluate(el => el.getBoundingClientRect().width > 400));
  check('narrow cards stay in the viewport', await panel.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
  await capture('desktop-ui-right-cards-800x600.png');
  const close = panel.getByRole('button', { name: 'Close details', exact: true });
  await close.focus(); await page.keyboard.press('Enter');
  await panel.waitFor({ state: 'detached' });
  check('compact cards can be closed with the keyboard', await page.getByRole('textbox', { name: 'Message Aster' }).isEnabled());
  await setContentSize(electronApp, page, 1280, 840);
}

export async function verifyPreviewContext({ page, electronApp, check, capture, createSessionFromUi, waitReady }) {
  await setContentSize(electronApp, page, 1600, 900);
  const link = page.getByRole('link', { name: 'fixture-read.txt', exact: true }).first();
  await link.click();
  await page.locator('.preview-panel').waitFor();
  await page.locator('.details-preview-text').filter({ hasText: 'ASTER_HOST_READ_OK' }).waitFor();
  check('opening a file does not force the information cards open', await page.locator('.details-panel').count() === 0);
  const reads = () => page.evaluate(() => window.__asterTestWire.requests.filter(item => item.method === 'fs.readFile').length);
  const readsBefore = await reads();
  await page.getByRole('button', { name: /^Context usage:/ }).click();
  await page.getByRole('button', { name: 'View in session details', exact: true }).click();
  await page.locator('.context-card[open]').waitFor();
  const contextCounts = {
    preview: await page.locator('.preview-panel').count(),
    contextCard: await page.locator('.details-panel .context-card').count(),
    readText: await page.locator('.details-preview-text').filter({ hasText: 'ASTER_HOST_READ_OK' }).count(),
    focus: await page.evaluate(() => (document.activeElement?.tagName ?? '') + '.' + (document.activeElement?.className ?? '')),
  };
  check('Context keeps the open preview beside the fixed cards', contextCounts.preview === 1
    && contextCounts.contextCard === 1
    && contextCounts.readText === 1
    && await page.locator('.context-card').evaluate(el => el.contains(document.activeElement)), JSON.stringify(contextCounts));
  check('Context does not re-read the file that is already open', await reads() === readsBefore);
  await capture('desktop-ui-context-with-preview-1600x900.png');
  await page.evaluate(() => { window.__asterTestWire.holdMethod = 'fs.readFile'; });
  await page.locator('.output-row').filter({ hasText: 'fixture-write.md' }).first().click();
  await page.waitForFunction(() => window.__asterTestWire.held.length > 0);
  check('an outstanding preview read hides stale bytes and the Open action', await page.locator('.details-preview-text').count() === 0 && await page.locator('.details-preview-open').count() === 0);
  await createSessionFromUi(true);
  await page.evaluate(() => window.__asterTestWire.release());
  check('switching session clears preview bytes and the Open action', await page.locator('.preview-panel').count() === 0 && await page.locator('.details-preview-open').count() === 0);
  await page.locator('.session-open').filter({ hasText: 'UI integration' }).click();
  await waitReady();
  await page.getByText('ASTER_HOST_ANSWER', { exact: true }).waitFor();
}

/** Cards and preview are independent panes with a draggable boundary of their own. */
export async function verifyWorkspaceLayout({ page, electronApp, check, capture }) {
  await setContentSize(electronApp, page, 1600, 900);
  if (await page.locator('.details-panel').count() === 0) {
    await page.getByRole('button', { name: 'Session details', exact: true }).click();
  }
  await page.locator('.output-row').filter({ hasText: 'fixture-write.md' }).first().click();
  const preview = page.locator('.preview-panel');
  const cards = page.locator('.details-panel');
  await preview.waitFor();
  const cardWidth = () => cards.locator('.info-card').first().evaluate(el => el.getBoundingClientRect().width);
  const previewWidth = () => preview.evaluate(el => el.getBoundingClientRect().width);
  check('wide workspace shows the fixed cards and the resizable preview at once', await page.locator('.split-pane').count() === 1
    && await preview.isVisible() && await cards.isVisible());
  const startWidth = await previewWidth();
  check('the preview pane starts with a usable width', startWidth >= 420);
  const handle = page.getByRole('separator', { name: /Resize the file preview/ });
  const first = await handle.boundingBox();
  if (!first) throw new Error('The split separator has no visible geometry.');
  const y = first.y + Math.min(240, first.height / 2);
  /** The left pane already sits at its minimum with the cards open, so the first drag narrows the preview. */
  await page.mouse.move(first.x + first.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2 + 120, y, { steps: 8 });
  const narrowed = await previewWidth();
  await page.mouse.up();
  check('dragging the separator resizes the preview by its own pointer distance', startWidth - narrowed > 100, `${startWidth} -> ${narrowed}`);
  check('information cards keep their width while the preview resizes', Math.abs(await cardWidth() - 280) <= 1);
  const settled = await previewWidth();
  const second = await page.getByRole('separator', { name: /Resize the file preview/ }).boundingBox();
  if (!second) throw new Error('The split separator lost its geometry after dragging.');
  const secondX = second.x + second.width / 2;
  await page.mouse.move(secondX, y);
  await page.mouse.down();
  await page.mouse.move(secondX - 90, y, { steps: 6 });
  const during = await previewWidth();
  await page.keyboard.press('Escape');
  const restored = await previewWidth();
  await page.mouse.up();
  check('Escape restores the ratio captured before the drag', during > settled + 40 && Math.abs(restored - settled) <= 2, `${settled} -> ${during} -> ${restored}`);
  const keyboardBefore = await previewWidth();
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(width => Math.abs(document.querySelector('.split-right')?.getBoundingClientRect().width - width) > 5, keyboardBefore);
  check('arrow keys resize the preview when the separator has focus', await previewWidth() > keyboardBefore + 5);
  await capture('desktop-ui-cards-preview-1600x900.png');
  await preview.getByRole('button', { name: 'Close preview' }).click();
  await preview.waitFor({ state: 'detached' });
  check('closing the preview leaves the information cards in place', await cards.isVisible() && Math.abs(await cardWidth() - 280) <= 1);
  await page.locator('.output-row').filter({ hasText: 'fixture-write.md' }).first().click();
  await page.locator('.preview-panel').waitFor();
  check('an Outputs row reopens the preview while the cards stay open', await cards.isVisible());
  await setContentSize(electronApp, page, 1280, 840);
  // Medium width: the conversation and preview keep their split, the cards float beside it.
  await page.locator('.workspace-overlay.is-cards').waitFor();
  check('a medium workspace keeps the preview split while the cards float', await page.locator('.split-pane').count() === 1
    && await page.locator('.workspace-overlay.is-cards').count() === 1
    && await preview.isVisible());
  const floatingCards = await page.locator('.workspace-overlay.is-cards').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { right: rect.right };
  });
  const splitPreview = await preview.evaluate(el => el.getBoundingClientRect().left);
  check('floating cards stay inside the left pane', floatingCards.right <= splitPreview + 0.5,
    `${floatingCards.right} > ${splitPreview}`);
  check('the narrow layer never blocks the composer', await page.evaluate(() => {
    const composer = document.querySelector('.composer-slot');
    if (!composer) return false;
    const rect = composer.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!hit && composer.contains(hit);
  }));
  await capture('desktop-ui-medium-cards-preview-1280x840.png');
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.locator('.workspace-overlay.is-cards').waitFor({ state: 'detached' });
  check('closing the floating cards leaves the split preview in place', await page.locator('.split-pane').count() === 1
    && await preview.isVisible());
  await page.getByRole('button', { name: /^Context usage:/ }).click();
  await page.getByRole('button', { name: 'View in session details', exact: true }).click();
  await page.locator('.workspace-overlay.is-cards').waitFor();
  check('Context brings the fixed cards forward without dropping the preview selection', await page.locator('.workspace-overlay.is-cards .info-card').count() > 0
    && await preview.isVisible());
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.locator('.workspace-overlay.is-cards').waitFor({ state: 'detached' });
  check('closing the cards returns to the preview selected earlier', await page.locator('.preview-panel').count() === 1);

  // Narrow width: one foreground layer; opening Context swaps the cards in and closing swaps back.
  await setContentSize(electronApp, page, 800, 600);
  await page.locator('.workspace-overlay.is-preview').waitFor();
  check('a narrow workspace shows one foreground layer', await page.locator('.split-pane').count() === 0
    && await page.locator('.workspace-overlay').count() === 1);
  await page.getByRole('button', { name: /^Context usage:/ }).click();
  await page.getByRole('button', { name: 'View in session details', exact: true }).click();
  await page.locator('.workspace-overlay.is-cards').waitFor();
  check('a narrow Context swaps the cards in without dropping the preview selection', await page.locator('.workspace-overlay').count() === 1
    && await page.locator('.workspace-overlay .info-card').count() > 0);
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.locator('.workspace-overlay.is-preview').waitFor();
  check('closing the narrow cards returns to the same preview file', await page.locator('.preview-panel-path').filter({ hasText: 'fixture-write.md' }).count() === 1);
  await capture('desktop-ui-narrow-preview-800x600.png');
  // Closing the preview while the cards were opened from Context must not orphan the card layer.
  await page.getByRole('button', { name: /^Context usage:/ }).click();
  await page.getByRole('button', { name: 'View in session details', exact: true }).click();
  await page.locator('.workspace-overlay.is-cards').waitFor();
  await page.locator('.output-row').filter({ hasText: 'fixture-write.md' }).first().click();
  await page.locator('.workspace-overlay.is-preview').waitFor();
  check('an Outputs row opens the preview above the narrow cards', await page.locator('.workspace-overlay.is-preview').count() === 1);
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.locator('.workspace-overlay.is-preview').waitFor({ state: 'detached' });
  check('closing the preview returns to the still-open narrow cards', await page.locator('.workspace-overlay.is-cards').count() === 1);
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.locator('.workspace-overlay.is-cards').waitFor({ state: 'detached' });
  check('closing the cards after the preview leaves the conversation', await page.locator('.workspace-overlay').count() === 0);
  await setContentSize(electronApp, page, 1280, 840);
}

export async function verifySidebar({ page, check }) {
  const nav = page.getByRole('navigation', { name: 'Code navigation' });
  const starts = await nav.locator('.nav-item > span:not([data-cds-part])').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().left)));
  check('New, Open folder and More share one text start', starts.length >= 3 && Math.max(...starts) - Math.min(...starts) <= 1, starts.join(', '));
  const iconWidth = await nav.locator('.nav-icon').first().evaluate(el => el.getBoundingClientRect().width);
  check('navigation icons use one 14px slot', Math.abs(iconWidth - 14) <= 0.5, String(iconWidth));
  const selected = page.locator('.session-row.selected');
  check('the active session has a visible selected surface', await selected.count() === 1
    && await selected.evaluate(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'));
  const toggle = page.locator('.session-heading-toggle').first();
  const requests = () => page.evaluate(() => window.__asterTestWire.requests.length);
  const before = await requests();
  await toggle.click();
  check('a project group collapses without a session request', await toggle.getAttribute('aria-expanded') === 'false'
    && await page.locator('.session-open').count() === 0
    && await requests() === before);
  await toggle.press('Enter');
  check('a project group reopens with the keyboard', await toggle.getAttribute('aria-expanded') === 'true'
    && await page.locator('.session-open').count() > 0);
}

export async function verifyLoading({ page, check, capture, createSessionFromUi, waitReady }) {
  await page.evaluate(() => sessionStorage.setItem('aster-test-hold-conversation', '1'));
  await page.reload();
  await page.locator('.conversation-loading [data-cds="SkeletonGroup"][data-motion="lockstep"]').waitFor();
  await page.waitForFunction(() => window.__asterTestWire.held.length > 0);
  check('conversation loading uses a real pending reply and lockstep skeleton', await page.locator('.conversation-loading').getAttribute('aria-busy') === 'true');
  await capture('desktop-ui-conversation-loading-1280x840.png');
  await page.evaluate(() => window.__asterTestWire.release());
  await waitReady();
  await page.getByText('ASTER_HOST_ANSWER', { exact: true }).waitFor();
  await page.evaluate(() => { window.__asterTestWire.holdMethod = 'usage.getSummary'; });
  await createSessionFromUi();
  await page.locator('.usage-skeleton [data-cds="SkeletonGroup"][data-motion="wave"]').waitFor();
  await page.waitForFunction(() => window.__asterTestWire.held.length > 0);
  check('usage loading uses staggered wave placeholders', await page.locator('.usage-skeleton [data-cds="Skeleton"]').count() === 7);
  await capture('desktop-ui-usage-loading-1280x840.png');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('reduced motion removes skeleton animations', await page.locator('.usage-skeleton [data-cds="Skeleton"]').first().evaluate(el => getComputedStyle(el, '::after').animationName === 'none'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.__asterTestWire.release());
  await page.locator('.usage-skeleton').waitFor({ state: 'detached' });
  await page.locator('.session-open').filter({ hasText: 'UI integration' }).click();
  await waitReady();
}

export async function verifyDraftRecovery({ page, check, capture, provider, waitReady }) {
  const composer = page.getByRole('textbox', { name: 'Message Aster' });
  const requests = provider.requests.length;
  await page.evaluate(() => { window.__asterTestWire.interruptText = 'AUDIT_UNCONFIRMED_DRAFT_A'; });
  await composer.fill('AUDIT_UNCONFIRMED_DRAFT_A');
  await composer.press('Enter');
  await page.waitForFunction(() => window.__asterTestWire.interruptedSocket !== null);
  await composer.fill('AUDIT_NEWER_DRAFT_B');
  await page.evaluate(() => window.__asterTestWire.interruptedSocket.close());
  await page.getByRole('button', { name: 'Restore saved draft', exact: true }).waitFor();
  await waitReady();
  check('transport failure preserves newer input', await composer.inputValue() === 'AUDIT_NEWER_DRAFT_B');
  await page.getByRole('button', { name: 'Restore saved draft', exact: true }).click();
  check('unconfirmed draft can be restored without losing newer input', await composer.inputValue() === 'AUDIT_UNCONFIRMED_DRAFT_A');
  check('a never-sent newer draft is identified as unsent', (await page.locator('.composer-recovery').textContent()).includes('1 unsent draft saved'));
  await page.getByRole('button', { name: 'Restore saved draft', exact: true }).click();
  check('the newer draft remains recoverable', await composer.inputValue() === 'AUDIT_NEWER_DRAFT_B');
  check('an interrupted send is never replayed automatically', provider.requests.length === requests);
  await capture('desktop-ui-draft-recovery-1280x840.png');
  await composer.fill('');
  await page.getByRole('button', { name: 'Restore saved draft', exact: true }).click();
  await composer.fill('AUDIT_UNCONFIRMED_EMPTY_EDITOR');
  await page.evaluate(() => { window.__asterTestWire.interruptedSocket = null; window.__asterTestWire.interruptText = 'AUDIT_UNCONFIRMED_EMPTY_EDITOR'; });
  await composer.press('Enter');
  await page.waitForFunction(() => window.__asterTestWire.interruptedSocket !== null);
  await page.evaluate(() => window.__asterTestWire.interruptedSocket.close());
  await page.getByRole('button', { name: 'Restore saved draft', exact: true }).waitFor();
  await waitReady();
  check('a failed send stays recoverable when the editor is empty', await composer.inputValue() === '');
  await page.getByRole('button', { name: 'Restore saved draft', exact: true }).click();
  check('restoring into an empty editor keeps its unconfirmed warning', await composer.inputValue() === 'AUDIT_UNCONFIRMED_EMPTY_EDITOR'
    && (await page.locator('.composer-recovery').textContent()).includes('Message delivery is unconfirmed'));
  check('empty-editor recovery never calls the provider', provider.requests.length === requests);
}
