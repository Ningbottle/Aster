#!/usr/bin/env node
// Round-3 UI evidence: real Electron → Bun ThinkRail host → WS → Pi → loopback SSE fixture.
// Covers only what this round changed; the full acceptance run stays in desktop-ui-check.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixtureModelsJson, FIXTURE_MARKERS, startFixtureProvider } from '../../tests/fixtures/fixture-provider.mjs';
import { installWireObserver } from './desktop-ui-alignment.mjs';

const require = createRequire(import.meta.url);
const repo = resolve(import.meta.dirname, '../..');
const mainEntry = join(repo, 'out/desktop/main/index.cjs');
if (!existsSync(mainEntry)) throw new Error('Build the desktop app first: npm run build:desktop');

const testRoot = mkdtempSync(join(repo, '.tmp', 'round3-ui-'));
const repoPath = join(testRoot, 'repo');
const dataDir = join(testRoot, 'data');
const piDir = join(testRoot, 'pi');
const homeDir = join(testRoot, 'home');
const tempDir = join(testRoot, 'temp');
const outputPath = resolve(process.env.ASTER_DESKTOP_UI_OUTPUT || join(repo, '.tmp', 'round3-ui-evidence'));
mkdirSync(outputPath, { recursive: true });
for (const directory of [repoPath, dataDir, piDir, homeDir, tempDir, join(homeDir, 'AppData', 'Roaming'), join(homeDir, 'AppData', 'Local'), join(homeDir, '.config'), join(homeDir, '.cache'), join(homeDir, '.local', 'share'), join(homeDir, '.local', 'state')]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(join(repoPath, 'fixture-read.txt'), 'ASTER_HOST_READ_OK\n');

/** A real two-page PDF, so the preview has to render and navigate actual pages. */
function buildTwoPagePdf() {
  const stream = text => `BT /F1 20 Tf 32 120 Td (${text}) Tj ET`;
  const first = stream('Aster PDF page one');
  const second = stream('Aster PDF page two');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = bodies.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
writeFileSync(join(repoPath, 'sample.pdf'), buildTwoPagePdf());
writeFileSync(join(homeDir, '.gitconfig'), '');

const env = {};
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'SystemDrive', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'ALLUSERSPROFILE', 'CommonProgramFiles', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERDOMAIN', 'COMPUTERNAME', 'SESSIONNAME']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  HOME: homeDir, APPDATA: join(homeDir, 'AppData', 'Roaming'), LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
  TEMP: tempDir, TMP: tempDir, XDG_CONFIG_HOME: join(homeDir, '.config'), XDG_CACHE_HOME: join(homeDir, '.cache'),
  XDG_DATA_HOME: join(homeDir, '.local', 'share'), XDG_STATE_HOME: join(homeDir, '.local', 'state'),
  THINKRAIL_DATA_DIR: dataDir, PI_CODING_AGENT_DIR: piDir, THINKRAIL_PICK_DIR: repoPath,
  NODE_ENV: 'test', PI_OFFLINE: '1', GIT_CONFIG_GLOBAL: join(homeDir, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
});

function git(args) {
  return new Promise((done, reject) => {
    const child = spawn('git', args, { cwd: repoPath, env, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? done() : reject(new Error(`git ${args.join(' ')} exited ${code}`)));
  });
}

const checks = [];
function check(name, condition, detail) {
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
  checks.push(name);
  console.log(`ok - ${name}`);
}

/** Polls the profile file so a restart test never races the renderer's IPC write. */
async function waitForProfile(path, predicate, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const prefs = JSON.parse(readFileSync(path, 'utf8'));
      if (predicate(prefs)) return prefs;
    } catch { /* the file may not exist yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
}

async function waitForStableFileBytes(path, timeout = 10_000) {
  const started = Date.now();
  let previous;
  let sameReads = 0;
  while (Date.now() - started < timeout) {
    const current = readFileSync(path);
    if (previous?.equals(current)) sameReads += 1;
    else { previous = current; sameReads = 0; }
    if (sameReads >= 3) return current;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Preference file did not settle: ${path}`);
}

function findNativeSessionFile(sessionId) {
  const sessionsRoot = join(piDir, 'sessions');
  if (!existsSync(sessionsRoot)) return null;
  const pending = [sessionsRoot];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`)) return path;
    }
  }
  return null;
}

let provider;
let electronApp;
let page;
try {
  provider = await startFixtureProvider();
  const modelsJson = fixtureModelsJson(provider.baseUrl);
  // A second model proves the new-chat choice really becomes the session's model.
  const [firstModel] = modelsJson.providers.fixture.models;
  modelsJson.providers.fixture.models.push({ ...firstModel, id: 'fixture-model-two', name: 'Fixture model two' });
  writeFileSync(join(piDir, 'models.json'), JSON.stringify(modelsJson, null, 2));
  await git(['init', '-q']);
  await git(['add', '.']);
  await git(['-c', 'user.email=aster-ui-fixture@example.invalid', '-c', 'user.name=Aster UI Fixture', 'commit', '-q', '-m', 'fixture']);

  const playwrightPath = process.env.ASTER_PLAYWRIGHT_MODULE
    ? resolve(process.env.ASTER_PLAYWRIGHT_MODULE)
    : [resolve(repo, 'node_modules/playwright'), join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].find(candidate => existsSync(candidate));
  if (!playwrightPath) throw new Error('Playwright is unavailable. Set ASTER_PLAYWRIGHT_MODULE to an installed module path.');
  const { _electron } = require(playwrightPath);
  const electronPath = require('electron');
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [`--user-data-dir=${join(testRoot, 'electron-user-data')}`, mainEntry],
    cwd: repo, env, timeout: 90_000,
  });
  page = await electronApp.firstWindow({ timeout: 90_000 });
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message.slice(0, 240)));
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.desktop-shell').waitFor({ timeout: 60_000 });
  await page.addInitScript(installWireObserver);
  await page.reload();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 840));
  await page.waitForFunction(() => window.innerWidth >= 1270 && window.innerHeight >= 800);
  await page.locator('.sidebar-brand > .sr-only').filter({ hasText: 'Ready' }).waitFor({ timeout: 60_000 });
  const capture = name => page.screenshot({ path: join(outputPath, name), fullPage: false });

  // Navigation: exactly two workspaces, one Settings entry, one resize handle.
  const modes = page.locator('.mode-switch [role="radio"]');
  const modeText = await modes.allInnerTexts();
  check('the navigation offers exactly Chat and Code', await modes.count() === 2 && modeText.join('|').includes('Chat') && modeText.join('|').includes('Code'), modeText.join('|'));
  const footer = page.locator('.sidebar-footer');
  check('the footer holds only the Settings entry', await footer.locator('button:visible, a:visible, [role="button"]:visible').count() === 1
    && await footer.getByRole('button', { name: 'Settings', exact: true }).count() === 1);
  check('the brand sits above the mode switch', await page.locator('.sidebar-brand').evaluate(el => el.getBoundingClientRect().bottom <= el.parentElement.querySelector('.mode-switch').getBoundingClientRect().top));

  const resizer = page.getByRole('separator', { name: /Resize the navigation/ });
  const sidebarWidth = () => page.evaluate(() => getComputedStyle(document.querySelector('.desktop-shell')).getPropertyValue('--sidebar-width').trim());
  const initialWidth = await sidebarWidth();
  await resizer.focus();
  await resizer.press('ArrowRight');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-shell')).getPropertyValue('--sidebar-width').trim() === '296px');
  const widened = await sidebarWidth();
  check('the navigation resizes from the keyboard and persists to the layout', /^288px$/.test(initialWidth) && /^296px$/.test(widened), `${initialWidth} -> ${widened}`);
  await resizer.press('Enter');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-shell')).getPropertyValue('--sidebar-width').trim() === '288px');
  check('Enter restores the default navigation width', /^288px$/.test(await sidebarWidth()));

  // Settings is a real dialog over real state, and Escape closes it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.waitFor();
  check('Settings exposes the real session controls', await settings.getByRole('radiogroup', { name: 'Tool access' }).count() === 1
    && await settings.getByText('Light theme only.', { exact: false }).count() === 1);
  await capture('round3-settings-1280x840.png');
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });

  // The new-chat screen already knows the model a new session would get.
  const newChatTrigger = page.locator('.model-switcher-trigger');
  await newChatTrigger.waitFor({ timeout: 30_000 });
  const newChatText = (await newChatTrigger.innerText()).replace(/\s+/g, ' ').trim();
  check('the new-chat screen names the model a session would use', /Fixture model/.test(newChatText)
    && await newChatTrigger.getAttribute('aria-disabled') === 'false', newChatText);
  await capture('round3-newchat-model-1280x840.png');
  await newChatTrigger.click();
  const newChatMenu = page.getByRole('menu', { name: 'Model', exact: true });
  await newChatMenu.waitFor();
  check('the new-chat picker opens on the model row and its effort', await newChatMenu.locator('.model-switcher-current').count() === 1
    && await newChatMenu.locator('.effort-inline').count() === 1);
  await capture('round3-newchat-picker-1280x840.png');
  await newChatMenu.locator('.model-switcher-current').click();
  await newChatMenu.getByRole('menuitemradio', { name: 'Fixture model two fixture' }).click();
  check('choosing another model on the new-chat screen updates the control', /Fixture model two/.test(await newChatTrigger.innerText()));
  await capture('round3-newchat-chosen-1280x840.png');

  // A real turn through the host: tool call, answer, turn-level timeline.
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message Aster' });
  await composer.waitFor({ timeout: 60_000 });
  check('the model chosen on the new-chat screen becomes the session model', /Fixture model two/.test(await newChatTrigger.innerText()));
  await composer.fill(`Please read the fixture. ${FIXTURE_MARKERS.toolPrompt}`);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).waitFor({ timeout: 60_000 });
  await page.locator('.sidebar-brand > .sr-only').filter({ hasText: 'Ready' }).waitFor({ timeout: 60_000 });

  // Delayed metadata must not replace an already loaded conversation or lock input.
  await page.evaluate(() => window.__asterTestWire.hold(['session.getCommands', 'session.getStats']));
  await page.locator('.session-row.selected .session-open').click();
  await page.waitForFunction(() => window.__asterTestWire.held.length >= 2, undefined, { timeout: 60_000 });
  check('real commands and stats replies are held in the transport', await page.evaluate(() => window.__asterTestWire.held.length >= 2));
  check('delayed commands or stats do not skeleton over loaded messages', await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).isVisible()
    && await page.locator('.conversation-loading').count() === 0);
  check('delayed commands or stats leave the composer editable', await page.getByRole('textbox', { name: 'Message Aster' }).isEnabled());
  await page.evaluate(() => window.__asterTestWire.release());

  const metas = page.locator('.message.assistant .message-meta');
  const metaCount = await metas.count();
  const opacityHidden = await metas.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === '0'));
  check('assistant timelines are hidden until hovered', metaCount > 0 && opacityHidden, String(metaCount));
  const toolOnlyOwnsMeta = await page.evaluate(() => [...document.querySelectorAll('.message.assistant')]
    .filter(node => node.querySelector('.assistant-body .tool-card, .assistant-body .activity-group') && !node.querySelector('.assistant-body p, .assistant-body h1, .assistant-body h2, .assistant-body li'))
    .every(node => !node.querySelector('.message-meta')));
  check('a tool-only assistant message owns no timeline', toolOnlyOwnsMeta);
  const lastAssistant = page.locator('.message.assistant').last();
  await lastAssistant.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.message.assistant:last-of-type .message-meta')).opacity !== '0', undefined, { timeout: 5_000 });
  check('hovering a turn reveals its timeline', true);

  // Tool cards from this round: result copy on the header, own row for a command.
  const group = page.locator('.activity-group').first();
  if (await group.count()) await group.locator('.activity-summary').click();
  const readCard = page.locator('.tool-card').filter({ hasText: 'fixture-read.txt' }).first();
  await readCard.waitFor({ timeout: 15_000 });
  await readCard.locator('.tool-summary').click();
  await readCard.locator('.tool-section-head').first().waitFor();
  check('a read card puts a copy action on the result header', await readCard.getByRole('button', { name: 'Copy result', exact: true }).count() === 1);

  await composer.fill(`Run the long command. ${FIXTURE_MARKERS.longPrompt}`);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText(FIXTURE_MARKERS.longDone, { exact: false }).waitFor({ timeout: 90_000 });
  await page.locator('.sidebar-brand > .sr-only').filter({ hasText: 'Ready' }).waitFor({ timeout: 60_000 });
  const bashCard = page.locator('.tool-card').filter({ hasText: 'node -e' }).last();
  await bashCard.waitFor({ timeout: 30_000 });
  await bashCard.locator('.tool-summary').click();
  await bashCard.locator('.bash-command').waitFor();
  check('a bash card keeps the command on its own row with a copy action',
    await bashCard.getByRole('button', { name: 'Copy command', exact: true }).count() === 1
    && await bashCard.locator('.bash-output').count() === 1);

  // The information cards are a sticky column inside the conversation scroller.
  const before = await page.evaluate(() => window.__asterTestWire.requests.filter(entry => entry.method === 'session.create').length);
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.locator('.information-rail').waitFor();
  const geometry = await page.evaluate(() => {
    const scroll = document.querySelector('.conversation-scroll').getBoundingClientRect();
    const rail = document.querySelector('.information-rail').getBoundingClientRect();
    const column = document.querySelector('.conversation-column').getBoundingClientRect();
    return { scrollRight: scroll.right, railRight: rail.right, columnRight: column.right, scrollbar: document.querySelector('.conversation-scroll').offsetWidth - document.querySelector('.conversation-scroll').clientWidth };
  });
  check('the scrollbar sits to the right of the cards, not between them', Math.abs((geometry.scrollRight - geometry.railRight) - geometry.scrollbar) <= 1 && geometry.railRight > geometry.columnRight, JSON.stringify(geometry));
  await capture('round3-cards-1280x840.png');

  // Switching to Chat hides Code surfaces without creating or cancelling a session.
  await page.locator('.mode-switch [role="radio"]').first().click();
  check('Chat hides the Code surfaces', await page.locator('.information-rail').count() === 0);
  await capture('round3-chat-1280x840.png');
  const after = await page.evaluate(() => window.__asterTestWire.requests.filter(entry => entry.method === 'session.create').length);
  check('switching workspace mode never creates a session', before === after, `${before} -> ${after}`);
  await page.locator('.mode-switch [role="radio"]').nth(1).click();
  await page.locator('.information-rail').waitFor();
  check('switching back restores the cards that were open', await page.locator('.information-rail').count() === 1);

  // Preview tabs: two real files, neighbour selection on close, keyboard walk.
  await page.locator('.details-panel').getByRole('button', { name: /fixture-write\.md/ }).click();
  const panel = page.locator('.preview-panel');
  await panel.waitFor({ timeout: 30_000 });
  check('opening an output creates the first preview tab', await page.getByRole('tab').count() === 1);
  // With the preview open at 1280 the cards can no longer sit inline; they must
  // become a dismissable overlay rather than an undismissable cover over the text.
  const overlayClose = page.locator('.workspace-overlay.is-cards').getByRole('button', { name: 'Close details', exact: true });
  check('a displaced card column keeps a visible close control', await overlayClose.isVisible());
  const overlayBox = await page.locator('.workspace-overlay.is-cards').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width }; });
  check('the displaced card column keeps its own width', Math.abs(overlayBox.width - 304) <= 2, JSON.stringify(overlayBox));
  await overlayClose.click();
  check('closing the displaced column gives the text its full width back', await page.locator('.workspace-overlay.is-cards').count() === 0
    && await page.locator('.details-panel').count() === 0);
  await page.locator('.local-file-reference').filter({ hasText: 'fixture-read.txt' }).first().click();
  await page.getByRole('tab').filter({ hasText: 'fixture-read.txt' }).waitFor({ timeout: 30_000 });
  check('a second file becomes its own tab', await page.getByRole('tab').count() === 2);
  await page.getByRole('tab').filter({ hasText: 'fixture-read.txt' }).focus();
  await page.keyboard.press('ArrowLeft');
  check('arrow keys walk the tab strip', await page.getByRole('tab', { selected: true }).filter({ hasText: 'fixture-write.md' }).count() === 1);
  await page.getByRole('button', { name: 'Close fixture-write.md', exact: true }).click();
  check('closing a tab hands the pane to its neighbour', await page.getByRole('tab').count() === 1
    && await page.getByRole('tab', { selected: true }).filter({ hasText: 'fixture-read.txt' }).count() === 1);
  check('the path row names the file relative to the workspace', (await page.locator('.preview-panel-path').innerText()).replace(/\\/g, '/') === 'fixture-read.txt');
  // The screenshot must show the file itself, not the loading skeleton.
  await page.locator('.preview-panel-body .details-preview-text').waitFor({ timeout: 30_000 });
  const loadedText = await page.locator('.preview-panel-body .details-preview-text').innerText();
  check('the preview renders the file instead of staying on its loading state', await page.locator('.preview-skeleton').count() === 0
    && loadedText.trim().length > 0, JSON.stringify({ skeletons: await page.locator('.preview-skeleton').count(), length: loadedText.trim().length }));
  await capture('round3-preview-1280x840.png');
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  check('closing the panel clears its tabs', await page.locator('.preview-panel').count() === 0);
  await capture('round3-code-1280x840.png');

  // PDF: canvas rendering, page navigation and zoom against fit width.
  await page.locator('.local-file-reference').filter({ hasText: 'sample.pdf' }).first().click();
  const pdfPane = page.locator('.pdf-preview');
  await pdfPane.waitFor({ timeout: 30_000 });
  const pdfCanvas = pdfPane.locator('canvas');
  // A canvas always reports its default 300x150 size; wait for the page count or a visible failure.
  await page.waitForFunction(() => {
    if (!document.querySelector('.pdf-preview')) return true;
    return Boolean(document.querySelector('.pdf-page-count')?.textContent?.includes('/ 2'));
  }, null, { timeout: 30_000 });
  const pdfFailed = await pdfPane.count() === 0;
  check('the PDF renders instead of failing silently', !pdfFailed,
    pdfFailed ? await page.locator('[role="alert"]').first().innerText() : '');
  if (pdfFailed) throw new Error('PDF preview failed: ' + await page.locator('[role="alert"]').first().innerText());
  await page.waitForFunction(() => {
    const element = document.querySelector('.pdf-preview canvas');
    return Boolean(element && element.width > 200 && element.style.width);
  }, null, { timeout: 30_000 });
  check('the PDF renders into a canvas with real page pixels', await pdfCanvas.evaluate(element => element.width > 200 && element.height > 100));
  check('the PDF toolbar replaces the redundant path row', await page.locator('.preview-panel-path').count() === 0
    && await pdfPane.getByRole('button', { name: 'Open in the system editor', exact: true }).count() === 1);
  check('the PDF bar reports both pages', (await pdfPane.locator('.pdf-page-count').innerText()).trim() === '1 / 2');
  const fitWidth = await pdfCanvas.evaluate(element => parseFloat(element.style.width));
  await pdfPane.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForFunction(width => {
    const element = document.querySelector('.pdf-preview canvas');
    return Boolean(element && parseFloat(element.style.width) > width);
  }, fitWidth);
  check('zoom in widens the rendered page', await pdfCanvas.evaluate(element => parseFloat(element.style.width)) > fitWidth);
  await pdfPane.getByRole('button', { name: 'Fit to width' }).click();
  await page.waitForFunction(width => {
    const element = document.querySelector('.pdf-preview canvas');
    return Boolean(element && Math.abs(parseFloat(element.style.width) - width) <= 1);
  }, fitWidth);
  check('Fit returns the page to the panel width', Math.abs(await pdfCanvas.evaluate(element => parseFloat(element.style.width)) - fitWidth) <= 1);
  await pdfPane.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-page-count')?.textContent?.trim() === '2 / 2');
  check('the next page is rendered and reported', (await pdfPane.locator('.pdf-page-count').innerText()).trim() === '2 / 2');
  await capture('round3-pdf-1280x840.png');
  await page.getByRole('button', { name: 'Close sample.pdf', exact: true }).click();

  // Thinking effort is the first thing the model control opens, and every level
  // the model reports lives on the same track instead of a separate row below.
  await page.getByRole('button', { name: /^Model:/ }).click();
  const modelMenu = page.getByRole('menu', { name: 'Model', exact: true });
  await modelMenu.waitFor();
  check('the picker opens on the current model and its effort', await modelMenu.locator('.model-switcher-current').isVisible()
    && await modelMenu.locator('.effort-inline').isVisible());
  check('the model list stays closed until the model row is used', await modelMenu.locator('.model-switcher-options').count() === 0);
  check('the model row sits above the effort track', await page.evaluate(() => {
    const row = document.querySelector('.model-switcher-current');
    const effort = document.querySelector('.effort-inline');
    return Boolean(row && effort && row.compareDocumentPosition(effort) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  const effortLevels = await modelMenu.locator('[data-effort-level]').evaluateAll(nodes => nodes.map(node => node.dataset.effortLevel));
  check('every reported level gets a tick on the same track', effortLevels.length >= 2
    && await modelMenu.locator('.effort-tick').count() === effortLevels.length);
  check('the track has no separate row of level labels below it', await modelMenu.locator('.effort-labels').count() === 0);
  check('no effort level is pushed below the track', await modelMenu.locator('.effort-additional').count() === 0);
  await capture('round3-effort-1280x840.png');
  await modelMenu.getByRole('menuitem', { name: /Fixture model/ }).click();
  check('the model row opens the model list', await modelMenu.locator('.model-switcher-options').count() === 1
    && await modelMenu.locator('.model-switcher-row').count() >= 1);
  await capture('round3-model-list-1280x840.png');
  await modelMenu.getByRole('button', { name: 'Back to thinking effort', exact: true }).click();
  check('going back restores the effort track', await modelMenu.locator('.effort-inline').isVisible()
    && await modelMenu.locator('.model-switcher-options').count() === 0);
  const effortSent = () => page.evaluate(() => window.__asterTestWire.requests.filter(item => item.method === 'session.setThinkingLevel').length);
  const effortBefore = await effortSent();
  await modelMenu.getByRole('slider', { name: 'Thinking effort', exact: true }).press('Home');
  await page.waitForFunction(level => window.__asterTestWire.replies.some(item => item.method === 'session.setThinkingLevel' && item.frame.result?.thinkingLevel === level), effortLevels[0]);
  check('choosing a level sends exactly one request', await effortSent() === effortBefore + 1);
  check('the picker stays open so effort and model can be changed in one visit', await modelMenu.isVisible());
  await page.keyboard.press('Escape');
  check('Escape closes the model picker', await modelMenu.count() === 0);

  // Typography: prose and code keep distinct bundled faces and a reading rhythm.
  const typography = await page.evaluate(() => {
    const style = selector => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el) : null;
    };
    const prose = style('.assistant-body p');
    const code = style('.assistant-body pre code');
    return {
      prose: prose?.fontFamily ?? '',
      proseSize: prose?.fontSize ?? '0px',
      lineHeight: prose?.lineHeight ?? '0px',
      code: code?.fontFamily ?? '',
    };
  });
  // "Aster Sans" is the bundled Inter Variable face (styles.css @font-face).
  check('prose uses the bundled face with a reading line height', /Aster Sans/.test(typography.prose)
    && parseFloat(typography.lineHeight) / parseFloat(typography.proseSize) > 1.4, JSON.stringify(typography));
  check('code keeps the bundled mono face', /Cascadia/.test(typography.code), typography.code);

  // The edge fade covers with the complement of the content mask.
  const fade = await page.evaluate(() => {
    const el = document.querySelector('.conversation-fade.top');
    return { background: el ? getComputedStyle(el).backgroundImage : '' };
  });
  // The edge fade covers with the complement of the content mask. Chromium rounds
  // the computed colour stops, so compare with a half-step tolerance.
  const fadeAlphas = [...fade.background.matchAll(/rgba?\(252, 252, 251(?:,\s*([0-9.]+))?\)/g)]
    .map(match => match[1] === undefined ? 1 : Number(match[1]));
  const maskAlphas = [1, 0.949, 0.851, 0.698, 0.498, 0.298, 0.149, 0];
  check('the fade stops mirror the content mask alphas', fadeAlphas.length === maskAlphas.length
    && maskAlphas.every((value, index) => Math.abs(fadeAlphas[index] - value) <= 0.006), JSON.stringify(fadeAlphas));

  // The context card reads the live session stats instead of a constant.
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.locator('.details-panel').waitFor();
  const context = await page.evaluate(() => {
    const meter = document.querySelector('.details-panel .context-bar');
    const mini = document.querySelector('.details-panel .context-mini > span');
    return { meter: meter?.getAttribute('aria-valuenow') ?? null, miniWidth: mini?.style.width ?? '' };
  });
  check('the context card is driven by the live session stats', context.meter !== null && /%$/.test(context.miniWidth), JSON.stringify(context));
  await page.getByRole('button', { name: 'Session details', exact: true }).click();

  check('no page error was raised during the round', pageErrors.length === 0, pageErrors.join(' | '));

  // The profile keeps the window width, the open session and the model choice across a restart.
  const resizerForRestart = page.getByRole('separator', { name: /Resize the navigation/ });
  await resizerForRestart.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-shell')).getPropertyValue('--sidebar-width').trim() === '304px');
  const widenedAgain = await page.evaluate(() => getComputedStyle(document.querySelector('.desktop-shell')).getPropertyValue('--sidebar-width').trim());
  check('the navigation width commits before the restart', /^304px$/.test(widenedAgain), widenedAgain);
  // The preview split remembers its share even though the tab itself is not restored.
  await page.locator('.local-file-reference').filter({ hasText: 'fixture-read.txt' }).first().click();
  const splitHandle = page.getByRole('separator', { name: /Resize the file preview/ });
  await splitHandle.waitFor({ timeout: 30_000 });
  const splitBefore = await splitHandle.getAttribute('aria-valuenow');
  await splitHandle.focus();
  await page.keyboard.press('ArrowRight');
  const splitAfter = await splitHandle.getAttribute('aria-valuenow');
  check('the preview split moves by one step', Number(splitAfter) === Number(splitBefore) - 2, `${splitBefore} -> ${splitAfter}`);
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  // Leave in Chat with the navigation collapsed, so one restart proves both.
  await page.locator('.mode-switch').getByRole('radio', { name: 'Chat', exact: true }).click();
  const chatMode = (await page.locator('.mode-switch [aria-checked="true"]').innerText()).trim();
  check('the shell switches to Chat before the restart', chatMode === 'Chat', chatMode);
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.locator('.desktop-shell.sidebar-collapsed').waitFor({ timeout: 10_000 });
  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  const profilePath = join(userDataPath, 'ui-preferences.json');
  const storedBefore = await waitForProfile(profilePath, prefs => prefs.mode === 'chat' && prefs.sidebarOpen === false && prefs.sidebarWidth === 304
    && Math.abs((prefs.previewRatio ?? 0) - 0.52) < 0.0001);
  check('the mode, the collapsed navigation, the width and the split ratio reach the profile', storedBefore !== null, `${profilePath}: ${JSON.stringify(storedBefore)}`);
  await electronApp.close().catch(() => undefined);
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [`--user-data-dir=${join(testRoot, 'electron-user-data')}`, mainEntry],
    cwd: repo, env, timeout: 90_000,
  });
  page = await electronApp.firstWindow({ timeout: 90_000 });
  page.setDefaultTimeout(30_000);
  const relaunchErrors = [];
  page.on('pageerror', error => relaunchErrors.push(error.message.slice(0, 240)));
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.desktop-shell').waitFor({ timeout: 60_000 });
  await page.addInitScript(installWireObserver);
  await page.reload();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 840));
  await page.locator('.desktop-shell').waitFor({ timeout: 60_000 });
  check('the collapsed navigation survives the restart', await page.locator('.desktop-shell.sidebar-collapsed').count() === 1);
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.desktop-shell')?.classList.contains('sidebar-collapsed'));
  check('the navigation reopens after the restart', await page.locator('.sidebar').isVisible());
  await page.locator('.sidebar-brand > .sr-only').filter({ hasText: 'Ready' }).waitFor({ timeout: 60_000 });
  const relaunchedWidth = await page.evaluate(() => getComputedStyle(document.querySelector('.desktop-shell')).getPropertyValue('--sidebar-width').trim());
  check('the navigation width survives the restart', /^304px$/.test(relaunchedWidth), relaunchedWidth);
  const relaunchedMode = (await page.locator('.mode-switch [aria-checked="true"]').innerText()).trim();
  check('the Chat/Code mode survives the restart', relaunchedMode === 'Chat', relaunchedMode);
  await page.locator('.mode-switch').getByRole('radio', { name: 'Code', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mode-switch [aria-checked="true"]')?.textContent?.trim() === 'Code');
  await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).waitFor({ timeout: 60_000 });
  check('a restart reopens the session that was open', await page.locator('.session-row.selected').count() === 1
    && await page.locator('.message.assistant').count() > 0);
  await page.locator('.local-file-reference').filter({ hasText: 'fixture-read.txt' }).first().click();
  const relaunchedHandle = page.getByRole('separator', { name: /Resize the file preview/ });
  await relaunchedHandle.waitFor({ timeout: 30_000 });
  const relaunchedSplit = await relaunchedHandle.getAttribute('aria-valuenow');
  check('the preview split ratio survives the restart', Number(relaunchedSplit) === Number(splitAfter), `${splitAfter} -> ${relaunchedSplit}`);
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  const relaunchedTrigger = page.locator('.model-switcher-trigger');
  await relaunchedTrigger.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => /Fixture model two/.test(document.querySelector('.model-switcher-trigger')?.textContent ?? ''), undefined, { timeout: 20_000 }).catch(() => undefined);
  check('the model chosen before the restart is still the new-chat model', /Fixture model two/.test(await relaunchedTrigger.innerText()));

  // Choose effort explicitly in this run. A restored session's old effort does
  // not overwrite the separate global new-chat default.
  const priorSelection = await waitForProfile(profilePath, prefs => typeof prefs.selection?.sessionId === 'string');
  check('the existing conversation selection is persisted before New+', typeof priorSelection?.selection?.sessionId === 'string');
  const newChatModelMenu = page.getByRole('menu', { name: 'Model', exact: true });
  await relaunchedTrigger.click();
  await newChatModelMenu.waitFor();
  const selectedModelName = await newChatModelMenu.locator('.model-switcher-current .model-switcher-name').innerText();
  const newChatEffort = newChatModelMenu.locator('[role="slider"][aria-label="Thinking effort"]');
  await newChatEffort.press('End');
  await page.waitForFunction(() => window.__asterTestWire.replies.some(reply => reply.method === 'session.setThinkingLevel'
    && reply.frame.ok && reply.frame.result?.thinkingLevel === 'high'));
  const selectedThinking = await newChatEffort.getAttribute('aria-valuetext');
  await page.keyboard.press('Escape');
  const beforeNew = await page.evaluate(() => window.__asterTestWire.requests.length);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.waitForFunction(from => window.__asterTestWire.replies.some(reply => reply.method === 'session.create'
    && reply.frame.ok === true && window.__asterTestWire.requests.some((request, index) => request.method === 'session.create'
      && request.id === reply.frame.id && index >= from)), beforeNew, { timeout: 60_000 });
  const newCreate = await page.evaluate(from => {
    const request = window.__asterTestWire.requests.slice(from).find(item => item.method === 'session.create');
    const reply = window.__asterTestWire.replies.find(item => item.method === 'session.create' && item.frame.id === request?.id);
    return { request, reply: reply?.frame };
  }, beforeNew);
  const newSessionId = newCreate.reply?.result?.sessionId;
  check('New+ succeeds with a session ID different from the previously selected session', newCreate.reply?.ok === true
    && typeof newSessionId === 'string' && newSessionId !== priorSelection.selection.sessionId,
  JSON.stringify({ newSessionId, oldSessionId: priorSelection?.selection?.sessionId }));
  check('the created session uses the actual new-chat model and thinking choice', newCreate.reply?.result?.model?.name === selectedModelName
    && newCreate.reply?.result?.thinkingLevel === ({ Off: 'off', Minimal: 'minimal', Low: 'low', Medium: 'medium', High: 'high', Extra: 'xhigh', Max: 'max' })[selectedThinking]
    && (!newCreate.request?.params?.model || newCreate.request.params.model.id === newCreate.reply.result.model.id)
    && (!newCreate.request?.params?.thinkingLevel || newCreate.request.params.thinkingLevel === newCreate.reply.result.thinkingLevel),
  JSON.stringify({ selectedModelName, selectedThinking, params: newCreate.request?.params, result: newCreate.reply?.result }));
  const emptySelection = await waitForProfile(profilePath, prefs => prefs.selection?.sessionId === newSessionId);
  check('the newly created session is the persisted selection', emptySelection?.selection?.sessionId === newSessionId, JSON.stringify(emptySelection?.selection));
  await page.waitForFunction(id => window.__asterTestWire.replies.some(reply => reply.method === 'session.getMessages'
    && reply.frame.ok === true && window.__asterTestWire.requests.some(request => request.method === 'session.getMessages'
      && request.id === reply.frame.id && request.params?.sessionId === id)), newSessionId, { timeout: 30_000 });
  check('the selected empty session has an editable composer', await page.getByRole('textbox', { name: 'Message Aster' }).isEnabled()
    && await page.locator('.conversation-scroll .message').count() === 0);
  const emptyNativeFile = findNativeSessionFile(newSessionId);
  check('the empty session is saved as native Pi JSONL', emptyNativeFile !== null
    && existsSync(emptyNativeFile) && readFileSync(emptyNativeFile, 'utf8').includes(newSessionId), emptyNativeFile ?? 'no matching JSONL under isolated Pi data root');
  await capture('round3-relaunch-1280x840.png');
  check('no page error was raised after the restart', relaunchErrors.length === 0, relaunchErrors.join(' | '));

  await electronApp.close();
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [`--user-data-dir=${join(testRoot, 'electron-user-data')}`, mainEntry],
    cwd: repo, env, timeout: 90_000,
  });
  page = await electronApp.firstWindow({ timeout: 90_000 });
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.desktop-shell').waitFor({ timeout: 60_000 });
  await page.addInitScript(installWireObserver);
  await page.reload();
  await page.locator('.sidebar-brand > .sr-only').filter({ hasText: 'Ready' }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(id => window.__asterTestWire.replies.some(reply => reply.method === 'session.getMessages'
    && reply.frame.ok === true && window.__asterTestWire.requests.some(request => request.method === 'session.getMessages'
      && request.id === reply.frame.id && request.params?.sessionId === id)), newSessionId, { timeout: 60_000 });
  const restoredEmpty = await waitForProfile(profilePath, prefs => prefs.selection?.sessionId === newSessionId);
  check('restarting restores the same empty session ID', restoredEmpty?.selection?.sessionId === newSessionId);
  check('restarting keeps the selected session empty and the composer editable', await page.locator('.conversation-scroll .message').count() === 0
    && await page.getByRole('textbox', { name: 'Message Aster' }).isEnabled());
  const restoredModel = page.locator('.model-switcher-trigger');
  const restoredModelText = await restoredModel.innerText();
  check('restarting keeps the empty session model', selectedModelName === newCreate.reply.result.model.name
    && selectedModelName.split(/\s+/).every(part => restoredModelText.includes(part)));
  await restoredModel.click();
  const restoredMenu = page.getByRole('menu', { name: 'Model', exact: true });
  await restoredMenu.waitFor();
  const restoredEffort = await restoredMenu.locator('[role="slider"][aria-label="Thinking effort"]').getAttribute('aria-valuetext');
  check('restarting keeps the empty session thinking level', restoredEffort === selectedThinking
    && newCreate.reply.result.thinkingLevel === ({ Off: 'off', Minimal: 'minimal', Low: 'low', Medium: 'medium', High: 'high', Extra: 'xhigh', Max: 'max' })[restoredEffort],
  `${restoredEffort} != ${selectedThinking}`);
  await page.keyboard.press('Escape');
  check('restarting keeps the default access mode', await page.locator('.permission-control').innerText() === 'Auto accept edits');
  check('the empty session JSONL remains present after restart', findNativeSessionFile(newSessionId) === emptyNativeFile
    && existsSync(emptyNativeFile));

  // Exercise the real renderer -> preload -> main validation path against only
  // this run's isolated Electron profile. A valid write is the queue barrier.
  const profileBackup = readFileSync(profilePath);
  const profileBeforeBarrier = JSON.parse(profileBackup.toString('utf8'));
  const barrierResult = await page.evaluate(width => window.asterNative.writePreferences({ sidebarWidth: width }), profileBeforeBarrier.sidebarWidth);
  check('a valid preference write drains earlier profile writes', barrierResult.ok === true, JSON.stringify(barrierResult));
  await waitForStableFileBytes(profilePath);
  const beforeInvalidWrite = readFileSync(profilePath);
  const invalidWrite = await page.evaluate(() => window.asterNative.writePreferences({ sidebarWidth: 120 }));
  check('invalid preferences return a structured IPC failure', invalidWrite.ok === false
    && typeof invalidWrite.error === 'string', JSON.stringify(invalidWrite));
  const afterInvalidWrite = await waitForStableFileBytes(profilePath);
  check('invalid preferences leave the isolated profile bytes unchanged', afterInvalidWrite.equals(beforeInvalidWrite));

  // Corrupt only the isolated fixture profile while the application is closed.
  await electronApp.close();
  electronApp = null;
  const malformedProfile = Buffer.from('{ invalid isolated preferences fixture }\n', 'utf8');
  writeFileSync(profilePath, malformedProfile);
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [`--user-data-dir=${join(testRoot, 'electron-user-data')}`, mainEntry],
    cwd: repo, env, timeout: 90_000,
  });
  page = await electronApp.firstWindow({ timeout: 90_000 });
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.desktop-shell').waitFor({ timeout: 60_000 });
  const readError = 'Saved interface preferences could not be read.';
  await page.getByRole('alert').filter({ hasText: readError }).waitFor({ timeout: 30_000 });
  check('malformed preferences show the generic read error while the shell remains usable',
    await page.locator('.desktop-shell').isVisible()
    && await page.locator('.mode-switch').getByRole('radio', { name: 'Chat', exact: true }).isEnabled()
    && await page.locator('.mode-switch').getByRole('radio', { name: 'Code', exact: true }).isEnabled());
  await capture('round3-preferences-read-error.png');

  const writeError = 'Interface preferences could not be saved. Check that the preferences file is readable and writable.';
  await page.locator('.mode-switch').getByRole('radio', { name: 'Chat', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: writeError }).waitFor({ timeout: 30_000 });
  check('switching to Chat reports the generic preference write error', await page.locator('.mode-switch [aria-checked="true"]').innerText() === 'Chat');
  await page.locator('.mode-switch').getByRole('radio', { name: 'Code', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: writeError }).waitFor({ timeout: 30_000 });
  check('switching back to Code remains operable and reports the write error', await page.locator('.mode-switch [aria-checked="true"]').innerText() === 'Code');
  const failedWriteBarrier = await page.evaluate(() => window.asterNative.writePreferences({ mode: 'code' }));
  check('the write IPC failure is returned without throwing', failedWriteBarrier.ok === false && failedWriteBarrier.error === writeError, JSON.stringify(failedWriteBarrier));
  check('failed writes preserve the malformed fixture bytes', readFileSync(profilePath).equals(malformedProfile));
  await capture('round3-preferences-write-error.png');

  await electronApp.close();
  electronApp = null;
  writeFileSync(profilePath, profileBackup);
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [`--user-data-dir=${join(testRoot, 'electron-user-data')}`, mainEntry],
    cwd: repo, env, timeout: 90_000,
  });
  page = await electronApp.firstWindow({ timeout: 90_000 });
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.desktop-shell').waitFor({ timeout: 60_000 });
  await page.addInitScript(installWireObserver);
  await page.reload();
  await page.locator('.sidebar-brand > .sr-only').filter({ hasText: 'Ready' }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(id => window.__asterTestWire.replies.some(reply => reply.method === 'session.getMessages'
    && reply.frame.ok === true && window.__asterTestWire.requests.some(request => request.method === 'session.getMessages'
      && request.id === reply.frame.id && request.params?.sessionId === id)), newSessionId, { timeout: 60_000 });
  check('restoring the isolated profile bytes restores the same empty session', JSON.parse(readFileSync(profilePath, 'utf8')).selection?.sessionId === newSessionId
    && await page.locator('.conversation-scroll .message').count() === 0
    && await page.getByRole('textbox', { name: 'Message Aster' }).isEnabled());

  console.log(`PASS: ${checks.length} round-3 checks against the real Electron app.`);
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined);
  if (provider) await provider.close();
}
