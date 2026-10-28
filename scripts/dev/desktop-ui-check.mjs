#!/usr/bin/env node
// Real Electron acceptance: page-only actions, loopback SSE fixture and on-disk evidence are the only side channels.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fixtureModelsJson, FIXTURE_MARKERS, startFixtureProvider } from '../../tests/fixtures/fixture-provider.mjs';
import { installWireObserver, verifyEffort, verifyCompactWindow, verifyShellMenus, verifyFonts, verifyCodeHighlight, verifyRightCards, verifyPreviewContext, verifyWorkspaceLayout, verifySidebar, verifyLoading, verifyDraftRecovery } from './desktop-ui-alignment.mjs';

const require = createRequire(import.meta.url);
const repo = resolve(import.meta.dirname, '../..');
const mainEntry = join(repo, 'out/desktop/main/index.cjs');
const rendererEntry = join(repo, 'out/desktop/renderer/index.html');
const localTempRoot = join(repo, '.tmp');
mkdirSync(localTempRoot, { recursive: true });
const testRoot = mkdtempSync(join(localTempRoot, 'desktop-ui-'));
const repoPath = join(testRoot, 'repo');
const dataDir = join(testRoot, 'data');
const piDir = join(testRoot, 'pi');
const homeDir = join(testRoot, 'home');
const tempDir = join(testRoot, 'temp');
const appDataDir = join(homeDir, 'AppData', 'Roaming');
const localAppDataDir = join(homeDir, 'AppData', 'Local');
const claudeHomeDir = join(homeDir, '.claude');
const codexHomeDir = join(homeDir, '.codex');
const geminiHomeDir = join(homeDir, '.gemini');
const outputPath = resolve(process.env.ASTER_DESKTOP_UI_OUTPUT || join(localTempRoot, 'desktop-ui-evidence'));
mkdirSync(outputPath, { recursive: true });
const ownTempPath = relative(localTempRoot, testRoot);
assert(ownTempPath.startsWith('desktop-ui-') && !isAbsolute(ownTempPath), 'Temporary directory must stay under this harness-owned root.');
for (const directory of [
  repoPath, dataDir, piDir, homeDir, tempDir, appDataDir, localAppDataDir, claudeHomeDir, codexHomeDir, geminiHomeDir,
  join(homeDir, '.config'), join(homeDir, '.cache'), join(homeDir, '.local', 'share'), join(homeDir, '.local', 'state'),
]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(join(repoPath, 'fixture-read.txt'), 'ASTER_HOST_READ_OK\n');
const startupLogPath = join(testRoot, 'startup-dialogs.jsonl');
const gitConfigGlobalPath = join(homeDir, '.gitconfig');
writeFileSync(gitConfigGlobalPath, '');

const env = {};
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'SystemDrive', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'ALLUSERSPROFILE', 'CommonProgramFiles', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERDOMAIN', 'COMPUTERNAME', 'SESSIONNAME']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  HOME: homeDir,
  APPDATA: appDataDir,
  LOCALAPPDATA: localAppDataDir,
  TEMP: tempDir,
  TMP: tempDir,
  XDG_CONFIG_HOME: join(homeDir, '.config'),
  XDG_CACHE_HOME: join(homeDir, '.cache'),
  XDG_DATA_HOME: join(homeDir, '.local', 'share'),
  XDG_STATE_HOME: join(homeDir, '.local', 'state'),
  THINKRAIL_DATA_DIR: dataDir,
  PI_CODING_AGENT_DIR: piDir,
  THINKRAIL_PICK_DIR: repoPath,
  NODE_ENV: 'test',
  PI_OFFLINE: '1',
  CLAUDE_CONFIG_DIR: claudeHomeDir,
  CODEX_HOME: codexHomeDir,
  GEMINI_CLI_HOME: geminiHomeDir,
  GIT_CONFIG_GLOBAL: gitConfigGlobalPath,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
});
// Chromium needs the real Windows profile identity. Its data, app config and Pi remain isolated above.

function runGit(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd: repoPath, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(`git ${args.join(' ')} exited ${code}: ${output.slice(-1000)}`)));
  });
}

const delay = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

function execFileText(file, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout);
    });
  });
}

/** Finds the PID listening on the loopback port without touching any other process. */
async function findListenerPid(port) {
  try {
    if (process.platform === 'win32') {
      const stdout = await execFileText('netstat', ['-ano', '-p', 'TCP']);
      for (const line of stdout.split(/\r?\n/)) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 5 || fields[0] !== 'TCP' || fields[3] !== 'LISTENING') continue;
        if (!fields[1].endsWith(`:${port}`)) continue;
        const pid = Number(fields[4]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
      return null;
    }
    const stdout = await execFileText('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    const pid = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    console.error(`Listener lookup for port ${port} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Existence probe only: signal 0 never terminates the process. */
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    return true;
  }
}

/** Resolves only from a real Electron close/exit event, never from an endpoint probe. */
function waitForElectronExit(timeout) {
  const child = electronApp.process();
  let cancel = () => {};
  const promise = new Promise((resolvePromise, reject) => {
    let settled = false;
    const finish = (via, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      electronApp.off('close', onClose);
      child?.off('exit', onExit);
      resolvePromise({ via, code: code ?? null });
    };
    const onClose = () => finish('electronApp close event', child?.exitCode);
    const onExit = code => finish('Electron child process exit event', code);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      electronApp.off('close', onClose);
      child?.off('exit', onExit);
      reject(new Error(`Electron did not exit within ${timeout} ms after app.quit().`));
    }, timeout);
    cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      electronApp.off('close', onClose);
      child?.off('exit', onExit);
      resolvePromise({ via: 'wait cancelled', code: null });
    };
    electronApp.once('close', onClose);
    if (child) child.once('exit', onExit);
  });
  return { promise, cancel };
}

function walk(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function tokenize(path) {
  return path.replaceAll(testRoot, '<temp>');
}

let electronApp;
let page;
let provider;
let closed = false;
let electronExited = false;
let hostExitConfirmed = false;
let testRootRemovable = false;
const consoleErrors = [];
const pageErrors = [];
const screenshots = [];
const checks = [];
const fail = message => { throw new Error(message); };

function check(name, condition, detail) {
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
  checks.push(name);
}

async function capture(name) {
  const path = join(outputPath, name);
  // Let menu/drawer entry finish; loading skeletons and stream indicators remain animated.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter(animation => animation.playState === 'running'
      && Number.isFinite(animation.effect?.getComputedTiming().iterations));
    await Promise.allSettled(finite.map(animation => animation.finished));
  });
  await page.screenshot({ path, fullPage: false });
  const png = readFileSync(path);
  const windowBounds = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const view = await page.evaluate(() => {
    const composer = document.querySelector('[aria-label="Message Aster"]');
    return {
      title: document.title,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      theme: getComputedStyle(document.documentElement).colorScheme,
      fonts: {
        shell: getComputedStyle(document.body).fontFamily,
        composer: composer ? getComputedStyle(composer).fontFamily : null,
      },
      composerPresent: Boolean(composer),
    };
  });
  screenshots.push({ file: name, pixelWidth: png.readUInt32BE(16), pixelHeight: png.readUInt32BE(20), windowBounds, ...view });
  writeFileSync(join(outputPath, 'capture-progress.json'), JSON.stringify(screenshots, null, 2), 'utf8');
  console.log(`Captured ${name}`);
}

async function waitReady(timeout = 60_000) {
  await page.locator('.sidebar-brand > .sr-only').filter({ hasText: 'Ready' }).waitFor({ timeout });
}

/** Cancellation markers arrive on the fixture stream after the UI settles; wait for this turn's own events. */
async function waitForProviderEvents(mark, types, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const seen = new Set(provider.events.slice(mark).map(event => event.type));
    if (types.every(type => seen.has(type))) return;
    await delay(100);
  }
  throw new Error(`The fixture provider did not record ${types.join(', ')} within ${timeout} ms.`);
}

const STARTUP_TITLES = ['Aster fixture startup confirm A', 'Aster fixture startup confirm B'];

/** Native Pi extension in the isolated agent dir: two concurrent session_start confirms answered only from the page. */
function writeStartupExtension() {
  const directory = join(piDir, 'extensions', 'aster-startup-confirm');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'index.ts'), `import { appendFileSync } from "node:fs";

const logPath = ${JSON.stringify(startupLogPath)};
const titles = ${JSON.stringify(STARTUP_TITLES)};
let batchSeq = 0;
const record = entry => appendFileSync(logPath, JSON.stringify({ at: Date.now(), ...entry }) + "\\n");

export default function (pi) {
  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup" && event.reason !== "new") return;
    if (!ctx.hasUI) return;
    const batch = event.reason + "-" + Date.now() + "-" + (++batchSeq);
    record({ batch, step: "request", reason: event.reason, title: titles[0] });
    const first = ctx.ui.confirm(titles[0], "Fixture startup confirmation A from a native Pi extension.");
    record({ batch, step: "request", reason: event.reason, title: titles[1] });
    const second = ctx.ui.confirm(titles[1], "Fixture startup confirmation B from a native Pi extension.");
    const [a, b] = await Promise.all([first, second]);
    record({ batch, step: "answered", reason: event.reason, title: titles[0], value: a });
    record({ batch, step: "answered", reason: event.reason, title: titles[1], value: b });
  });
}
`);
}

function startupDialog(title) {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

async function answerStartupDialogs() {
  for (const title of STARTUP_TITLES) {
    const dialog = startupDialog(title);
    await dialog.waitFor({ state: 'visible', timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 20_000 });
  }
}

/** The composer draft survives a turn but is cleared when the active session identity changes. */
async function createSessionFromUi(preserveDraft = false) {
  const composer = page.getByRole('textbox', { name: 'Message Aster' });
  if (!preserveDraft) await composer.fill('pending session switch');
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await answerStartupDialogs();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Message Aster"]')?.value === '',
    undefined,
    { timeout: 60_000 },
  );
  await page.locator('.new-session-title').waitFor({ timeout: 60_000 });
  await page.locator('.busy-edge').waitFor({ state: 'hidden', timeout: 60_000 });
  await waitReady();
}

/** Hold real file I/O long enough to exercise text editing and a completed session switch. */
async function verifyAttachmentOwnership() {
  const composer = page.getByRole('textbox', { name: 'Message Aster' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5kAAAAASUVORK5CYII=', 'base64');
  const hold = async () => {
    await page.evaluate(() => {
      const original = FileReader.prototype.readAsDataURL;
      window.__asterResumeImageRead = null;
      FileReader.prototype.readAsDataURL = function(file) {
        window.__asterResumeImageRead = () => new Promise(resolveRead => {
          this.addEventListener('loadend', () => resolveRead(), { once: true });
          FileReader.prototype.readAsDataURL = original;
          original.call(this, file);
        });
      };
    });
    await page.locator('.composer-file-input').setInputFiles({ name: 'ownership-test.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => typeof window.__asterResumeImageRead === 'function');
  };
  const resume = async () => {
    await page.evaluate(async () => {
      await window.__asterResumeImageRead();
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
  };
  await composer.fill('Before reading an image');
  await hold();
  await composer.fill('Latest text typed while reading an image');
  await resume();
  await page.getByRole('button', { name: 'Preview ownership-test.png', exact: true }).waitFor();
  await createSessionFromUi(true);
  await page.locator('.session-open').filter({ hasText: 'UI integration' }).click();
  await page.locator('.workspace.has-transcript').waitFor();
  await page.locator('.busy-edge').waitFor({ state: 'hidden' });
  check('image read preserves the latest text in the original session draft', await composer.inputValue() === 'Latest text typed while reading an image');
  await page.getByRole('button', { name: 'Remove ownership-test.png', exact: true }).click();
  await hold();
  await createSessionFromUi(true);
  await resume();
  check('in-flight image cannot cross a completed session switch', await page.locator('.composer-attachment').count() === 0);
  await page.locator('.composer-file-input').setInputFiles({ name: 'new-session.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Preview new-session.png', exact: true }).waitFor();
  check('new session can attach its own image after the previous read is discarded', await page.locator('.composer-attachment').count() === 1);
  await page.getByRole('button', { name: 'Remove new-session.png', exact: true }).click();
}

function startupLog() {
  if (!existsSync(startupLogPath)) return [];
  return readFileSync(startupLogPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function waitStartupBatch(timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const answered = startupLog().filter(entry => entry.step === 'answered');
    if (answered.length >= 2) {
      const batch = answered[0].batch;
      const entries = startupLog().filter(entry => entry.batch === batch);
      if (entries.filter(entry => entry.step === 'answered').length === 2) return entries;
    }
    await delay(100);
  }
  throw new Error('The native extension did not record both startup confirm answers.');
}

function toolContents(messages) {
  return (messages ?? [])
    .filter(message => message?.role === 'tool')
    .map(message => typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content) ? message.content.map(part => part?.text ?? '').join('') : '');
}

async function openToolDetails() {
  // A turn can group several tools; every collapsed group has to be opened
  // before the individual cards exist in the DOM.
  const summaries = page.locator('.activity-summary');
  const count = await summaries.count();
  for (let index = 0; index < count; index += 1) {
    const summary = summaries.nth(index);
    if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
  }
}

function sessionFiles() {
  const sessionsRoot = join(piDir, 'sessions');
  return existsSync(sessionsRoot) ? walk(sessionsRoot).filter(path => path.endsWith('.jsonl')) : [];
}

async function main() {
  if (!existsSync(mainEntry)) fail('Desktop main build is missing. Run npm run build:desktop first.');
  if (!existsSync(rendererEntry)) fail('Desktop renderer build is missing. Run npm run build:desktop first.');
  await runGit(['init', '-q']);
  await runGit(['add', '.']);
  await runGit([
    '-c', 'user.email=aster-ui-fixture@example.invalid',
    '-c', 'user.name=Aster UI Fixture',
    'commit', '-q', '-m', 'fixture repository',
  ]);

  provider = await startFixtureProvider();
  writeFileSync(join(piDir, 'models.json'), JSON.stringify(fixtureModelsJson(provider.baseUrl), null, 2));
  mkdirSync(join(piDir, 'skills', 'greet'), { recursive: true });
  writeFileSync(join(piDir, 'skills', 'greet', 'SKILL.md'), '---\nname: greet\ndescription: Fixture greeting skill\n---\n\nASTER_SKILL_FIXTURE_MARKER\n');
  writeStartupExtension();

  const playwrightPath = process.env.ASTER_PLAYWRIGHT_MODULE
    ? resolve(process.env.ASTER_PLAYWRIGHT_MODULE)
    : [
        resolve(repo, 'node_modules/playwright'),
        join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
      ].find(candidate => existsSync(candidate));
  if (!playwrightPath) fail('Playwright is unavailable. Set ASTER_PLAYWRIGHT_MODULE to an installed module path.');
  const { _electron } = require(playwrightPath);
  const electronPath = require('electron');
  if (typeof electronPath !== 'string' || !existsSync(electronPath)) fail('The installed Electron executable could not be resolved.');

  electronApp = await _electron.launch({
    executablePath: electronPath,
    // Keep Chromium/Electron profile locks and DevToolsActivePort out of the user's existing Aster profile.
    args: [`--user-data-dir=${join(testRoot, 'electron-user-data')}`, mainEntry],
    cwd: repo,
    env,
    timeout: 90_000,
  });
  page = await electronApp.firstWindow({ timeout: 90_000 });
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => pageErrors.push(error.message.slice(0, 240)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240)); });
  await page.waitForLoadState('domcontentloaded');
  await page.addInitScript(installWireObserver);
  // Install before the first socket handler is assigned so replies are observed too.
  await page.reload();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 840));
  await page.waitForFunction(() => window.innerWidth >= 1270 && window.innerHeight >= 800);

  await page.getByRole('navigation', { name: 'Code navigation' }).waitFor();
  assert.equal(await page.title(), 'Aster');
  assert.equal(await page.locator('vite-error-overlay').count(), 0, 'No development error overlay should be present.');
  await capture('desktop-ui-initial-1280x840.png');

  await page.getByRole('button', { name: 'Open folder' }).first().click();
  const openFolderDialog = startupDialog(STARTUP_TITLES[0]);
  await openFolderDialog.waitFor({ state: 'visible', timeout: 60_000 });
  check('startup confirm is answerable before session.create returns', await openFolderDialog.getByText('Session initialization request').count() === 1);
  await capture('desktop-ui-startup-confirm-1280x840.png');
  await answerStartupDialogs();
  const startupBatch = await waitStartupBatch();
  const startupRequests = startupBatch.filter(entry => entry.step === 'request');
  const startupAnswers = startupBatch.filter(entry => entry.step === 'answered');
  check('one session_start raised two concurrent confirms', startupRequests.length === 2 && Math.max(...startupRequests.map(entry => entry.at)) <= Math.min(...startupAnswers.map(entry => entry.at)));
  check('both startup confirms completed through the page', startupAnswers.length === 2 && startupAnswers.every(entry => entry.value === true));

  await page.getByRole('textbox', { name: 'Message Aster' }).waitFor();
  await page.locator('.mode-switch').waitFor();
  await waitReady();
  check('open folder creates a default workspace through WS', await page.locator('.session-heading').filter({ hasText: 'repo' }).count() > 0);
  const modeLabels = await page.locator('.mode-switch').innerText();
  check('the sidebar offers exactly the two workspaces the product has', await page.locator('.mode-switch [role="radio"]').count() === 2
    && ['Chat', 'Code'].every(label => modeLabels.includes(label)));

  await createSessionFromUi();
  check('New starts a real session directly without a settings drawer', await page.locator('.new-session-drawer').count() === 0
    && await page.evaluate(() => window.__asterTestWire.requests.filter(item => item.method === 'session.create').length) >= 2);
  await capture('desktop-ui-new-session-1280x840.png');
  await verifyEffort({ page, check, capture });
  await verifyCompactWindow({ page, electronApp, check, capture });

  const composer = page.getByRole('textbox', { name: 'Message Aster' });
  await composer.fill('Please read the test fixture file. ASTER_HOST_TOOL_FIXTURE');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText('Generating', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).waitFor({ timeout: 60_000 });
  await waitReady();
  check('Pi thinking is rendered from the stream', await page.getByText('Fixture reasoning', { exact: false }).count() > 0);
  await openToolDetails();
  const readCard = page.locator('.tool-card').filter({ hasText: 'fixture-read.txt' });
  await readCard.waitFor({ timeout: 15_000 });
  check('read tool card comes from the Pi tool call',
    (await readCard.locator('.tool-label').textContent()) === 'Read'
    && ((await readCard.getAttribute('class')) ?? '').includes('succeeded'));
  const writeCard = page.locator('.tool-card').filter({ hasText: 'fixture-write.md' });
  await writeCard.waitFor({ timeout: 15_000 });
  check('write tool card comes from the Pi tool call',
    (await writeCard.locator('.tool-label').textContent()) === 'Wrote'
    && ((await writeCard.getAttribute('class')) ?? '').includes('succeeded'));
  check('write tool wrote the fixture file on disk',
    readFileSync(join(repoPath, 'fixture-write.md'), 'utf8').includes(FIXTURE_MARKERS.writeDone));
  await readCard.locator('.tool-summary').click();
  const readResult = readCard.getByText(FIXTURE_MARKERS.readDone, { exact: false });
  await readResult.waitFor({ timeout: 10_000 });
  check('tool result shows the real file contents', (await readResult.count()) > 0);
  check('read details put the file result before the raw arguments', await readCard.locator('.tool-detail .tool-section-head span').first().textContent() === 'Result'
    && await readCard.locator('.tool-arguments').count() === 1);
  await capture('desktop-ui-completed-1280x840.png');
  await verifyShellMenus({ page, check });
  await verifyFonts({ page, check });
  await verifyCodeHighlight({ page, check, capture });

  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename session', exact: true }).click();
  await page.getByRole('textbox', { name: 'Session title' }).fill('UI integration');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.pane-title').filter({ hasText: 'UI integration' }).waitFor();
  check('rename is confirmed by the host session summary', await page.locator('.session-open').filter({ hasText: 'UI integration' }).count() > 0);
  await verifyRightCards({ page, electronApp, check, capture });
  await verifyPreviewContext({ page, electronApp, check, capture, createSessionFromUi, waitReady });
  await verifyWorkspaceLayout({ page, electronApp, check, capture });
  await verifySidebar({ page, check });
  await verifyLoading({ page, check, capture, createSessionFromUi, waitReady });

  await page.reload();
  await page.getByRole('navigation', { name: 'Code navigation' }).waitFor();
  await waitReady();
  if (await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).count() === 0) {
    await page.locator('.session-open').filter({ hasText: 'UI integration' }).click();
    await waitReady();
  }
  await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).waitFor({ timeout: 30_000 });
  check('refresh restores the native transcript', (await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).count()) > 0);
  await openToolDetails();
  await page.locator('.tool-card').filter({ hasText: 'fixture-read.txt' }).waitFor({ timeout: 15_000 });
  await capture('desktop-ui-reloaded-1280x840.png');

  await createSessionFromUi();
  await page.locator('.session-open').filter({ hasText: 'UI integration' }).click();
  await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).waitFor({ timeout: 15_000 });
  check('sidebar reopen returns to the same native session', (await page.getByText(FIXTURE_MARKERS.answer, { exact: true }).count()) > 0);

  await verifyAttachmentOwnership();

  await createSessionFromUi();
  const answeredQuestionMark = provider.requests.length;
  const answeredQuestionFiles = new Set(sessionFiles());
  await composer.fill('ASTER_HOST_QUESTION_FIXTURE multi select');
  await page.getByRole('button', { name: 'Send message' }).click();
  const answerDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Pi needs your input' }) });
  await answerDialog.waitFor({ state: 'visible', timeout: 30_000 });
  await answerDialog.locator('label').filter({ hasText: '选项A' }).click();
  await answerDialog.getByRole('textbox', { name: 'Other answer for Fixture pick' }).fill('自填答案');
  await capture('desktop-ui-question-answer-1280x840.png');
  await answerDialog.getByRole('button', { name: 'Send answers' }).click();
  await answerDialog.waitFor({ state: 'detached', timeout: 20_000 });
  await page.getByText(FIXTURE_MARKERS.questionDone, { exact: false }).waitFor({ timeout: 60_000 });
  await waitReady();
  const questionToolText = provider.requests.slice(answeredQuestionMark)
    .flatMap(request => toolContents(request.messages))
    .find(text => text.includes('User has answered your questions:'));
  check('question tool result separates the selected option from the free text',
    Boolean(questionToolText)
    && questionToolText.includes('="选项A"')
    && questionToolText.includes('user\'s own answer: "自填答案"')
    && !questionToolText.includes('选项A, 自填答案'),
    questionToolText);
  const answeredQuestionNative = sessionFiles()
    .filter(file => !answeredQuestionFiles.has(file))
    .map(file => readFileSync(file, 'utf8'))
    .join('\n');
  check('native JSONL records selected and the free-text answer separately',
    /"selected":\s*\[\s*"选项A"\s*\]/.test(answeredQuestionNative)
    && /"answer":\s*"自填答案"/.test(answeredQuestionNative)
    && /"toolName":\s*"ask_user_question"/.test(answeredQuestionNative));

  await createSessionFromUi();
  const cancelledQuestionMark = provider.requests.length;
  const cancelledQuestionFiles = new Set(sessionFiles());
  await composer.fill('ASTER_HOST_QUESTION_FIXTURE cancel run');
  await page.getByRole('button', { name: 'Send message' }).click();
  const cancelDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Pi needs your input' }) });
  await cancelDialog.waitFor({ state: 'visible', timeout: 30_000 });
  await cancelDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await cancelDialog.waitFor({ state: 'detached', timeout: 20_000 });
  await page.getByText(FIXTURE_MARKERS.questionDone, { exact: false }).waitFor({ timeout: 60_000 });
  await waitReady();
  const declinedToolText = provider.requests.slice(cancelledQuestionMark)
    .flatMap(request => toolContents(request.messages))
    .find(text => text.includes('User declined to answer questions'));
  check('cancelled question returns the real decline result to the model', Boolean(declinedToolText));
  const cancelledQuestionNative = sessionFiles()
    .filter(file => !cancelledQuestionFiles.has(file))
    .map(file => readFileSync(file, 'utf8'))
    .join('\n');
  check('native JSONL records cancelled=true', /"cancelled":\s*true/.test(cancelledQuestionNative));

  const cancelMark = provider.events.length;
  await composer.fill('ASTER_HOST_CANCEL_FIXTURE keep streaming');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText('Generating', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText(FIXTURE_MARKERS.cancelBegin, { exact: false }).waitFor({ timeout: 30_000 });
  // Stop requested can be a single render commit; observe every DOM mutation instead of slowing the product down.
  await page.evaluate(() => {
    window.__asterStopRequestedObserved = false;
    const record = () => {
      const pill = document.querySelector('.sidebar-brand > .sr-only');
      const notice = document.querySelector('.runtime-notice');
      if (pill?.textContent?.trim() === 'Stop requested' || notice?.textContent?.includes('Stop requested. Waiting for Pi')) {
        window.__asterStopRequestedObserved = true;
      }
    };
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true });
    record();
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await waitReady(60_000);
  const stopRequestedObserved = await page.evaluate(() => window.__asterStopRequestedObserved === true);
  check('UI surfaces the stop-requested state for the aborting turn', stopRequestedObserved, 'the runtime pill never rendered Stop requested');
  await page.getByText('Request was aborted', { exact: false }).waitFor({ timeout: 15_000 });
  await waitForProviderEvents(cancelMark, ['cancel-request', 'cancel-stream-closed']);
  const cancelEvents = provider.events.slice(cancelMark);
  check('UI stop reaches the provider stream', cancelEvents.some(event => event.type === 'cancel-request'));
  check('Pi closes the stalled provider stream on stop', cancelEvents.some(event => event.type === 'cancel-stream-closed'));
  await capture('desktop-ui-stopped-1280x840.png');

  const files = sessionFiles();
  assert.ok(files.length >= 2, 'Each UI session should have its own native Pi JSONL.');
  const nativeText = files.map(file => readFileSync(file, 'utf8')).join('\n');
  const turnMarkers = [FIXTURE_MARKERS.answer, FIXTURE_MARKERS.readDone, FIXTURE_MARKERS.writeDone, FIXTURE_MARKERS.cancelBegin, 'UI integration'];
  check('native JSONL holds the real turn and rename',
    turnMarkers.every(marker => nativeText.includes(marker))
    && (nativeText.includes('"type":"session_info"') || nativeText.includes('"type": "session_info"')));
  const sqlite = [dataDir, piDir, repoPath]
    .flatMap(root => walk(root))
    .filter(path => /\.(sqlite3?|db)(-wal|-shm)?$/i.test(path));
  assert.deepEqual(sqlite, [], 'No SQLite store should appear under the host data, Pi agent or workspace roots.');
  await verifyDraftRecovery({ page, check, capture, provider, waitReady });
  check('no SQLite is produced', sqlite.length === 0);

  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(pageErrors, [], 'Renderer must not raise uncaught page errors.');
  assert.deepEqual(consoleErrors, [], 'Renderer must not emit console errors.');

  const origin = new URL(page.url()).origin;
  const hostPort = Number(new URL(origin).port);
  const runtime = await electronApp.evaluate(({ app, BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0]?.getBounds() ?? null;
    return {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      application: app.getVersion(),
      windowBounds: bounds,
      displayScaleFactor: screen.getDisplayMatching(bounds ?? { x: 0, y: 0, width: 1, height: 1 }).scaleFactor,
    };
  });
  const hostListenerPid = Number.isInteger(hostPort) && hostPort > 0 ? await findListenerPid(hostPort) : null;
  const electronPid = electronApp.process()?.pid ?? null;
  const electronExitWaiter = waitForElectronExit(25_000);
  let electronExit;
  try {
    await electronApp.evaluate(({ app }) => app.quit());
    electronExit = await electronExitWaiter.promise;
  } catch (error) {
    electronExitWaiter.cancel();
    throw error;
  }
  electronExited = true;
  closed = true;
  let hostProcessExited = null;
  if (hostListenerPid !== null) {
    const deadline = Date.now() + 8_000;
    while (processAlive(hostListenerPid) && Date.now() < deadline) await delay(100);
    hostProcessExited = !processAlive(hostListenerPid);
  }
  let endpointClosed = false;
  try {
    await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
  } catch {
    endpointClosed = true;
  }
  hostExitConfirmed = hostProcessExited === true;
  writeFileSync(join(outputPath, 'desktop-ui-evidence.json'), JSON.stringify({
    runtime,
    hostLifecycle: {
      electronPid,
      electronExit,
      hostListenerPid,
      hostListenerSource: hostListenerPid === null ? null : 'listening process for the page origin port (netstat/lsof)',
      hostProcessExited,
      hostEndpointClosed: endpointClosed,
      confirmed: hostExitConfirmed,
    },
    screenshots,
    abort: { stopRequestedObserved },
    consoleErrors,
    pageErrors,
    provider: { baseUrl: tokenize(provider.baseUrl), requests: provider.requests.length, events: provider.events.map(event => event.type) },
    nativeSessions: files.map(tokenize),
    tempRoot: tokenize(testRoot),
    checks,
    syntheticProvider: 'loopback 127.0.0.1 OpenAI-compatible SSE fixture; no external model provider used',
    rendererApi: 'page-only interactions over the host WebSocket; window.aster is not used',
  }, null, 2), 'utf8');
  if (hostListenerPid === null) fail(`Host process exit could not be verified: no listener PID was resolved for ${origin}. hostEndpointClosed=${endpointClosed}. The isolated test root is retained.`);
  if (!hostExitConfirmed) fail(`Host process ${hostListenerPid} was still alive after Electron exited. hostEndpointClosed=${endpointClosed}. The isolated test root is retained.`);
  if (!endpointClosed) fail(`Host endpoint ${origin}/health still responds after Electron exited, so host shutdown is not confirmed.`);
  testRootRemovable = electronExited && hostExitConfirmed;
  console.log(`PASS: real Electron main entry → Bun ThinkRail host → WS → real Pi 1.2.0 → local SSE fixture.`);
  console.log(`Checks: ${checks.join('; ')}`);
  console.log(`Evidence: ${outputPath}`);
  console.log(`Host lifecycle: Electron exit via ${electronExit.via} (code ${electronExit.code}); host pid ${hostListenerPid} exited=${hostProcessExited}; endpoint closed=${endpointClosed}.`);
  console.log('Provider is synthetic and local; paid providers, hardware IME and Claude visual comparison are not covered here.');
}

try {
  await main();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : 'unknown UI integration failure'}`);
  try {
    writeFileSync(join(outputPath, 'desktop-ui-failure.json'), JSON.stringify({
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      checks,
      screenshots,
      consoleErrors,
      pageErrors,
      pageUrl: page && !page.isClosed() ? page.url() : null,
      provider: provider ? { requests: provider.requests.length, events: provider.events.map(event => event.type) } : null,
      tempRoot: tokenize(testRoot),
    }, null, 2), 'utf8');
  } catch (evidenceError) {
    console.error(`Failure evidence could not be written: ${evidenceError instanceof Error ? evidenceError.message : String(evidenceError)}`);
  }
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: join(outputPath, 'desktop-ui-failure.png'), fullPage: false }); }
    catch { console.error('Failure screenshot unavailable; the original integration failure is retained.'); }
    try {
      console.error(`Page URL: ${page.url()}`);
      console.error(`Page title: ${await page.title()}`);
      console.error(`Visible alerts: ${(await page.locator('[role="alert"]').allTextContents()).join(' | ').slice(0, 500)}`);
    } catch (diagnosticError) { console.error(`Failure diagnostics unavailable: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}`); }
  }
  console.error('If the renderer is still being migrated, rebuild out/desktop (npm run build:desktop) and rerun this script.');
  process.exitCode = 1;
} finally {
  if (!closed && electronApp) {
    try { await electronApp.close(); closed = true; }
    catch (error) {
      console.error(`Electron test process closure was not confirmed (${error instanceof Error ? error.message : String(error)}); retaining the isolated test root.`);
      process.exitCode = 1;
    }
  }
  try {
    await provider?.close();
  } catch (error) {
    console.error(`Fixture provider cleanup failed: ${error instanceof Error ? error.message : String(error)}. Any earlier failure remains the primary error.`);
    process.exitCode = 1;
  }
  const resolvedRoot = resolve(testRoot);
  const safeRelative = relative(resolve(localTempRoot), resolvedRoot);
  if (testRootRemovable && safeRelative.startsWith('desktop-ui-') && !isAbsolute(safeRelative)) {
    try {
      rmSync(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.error(`Cleanup failed for ${resolvedRoot}: ${error instanceof Error ? error.message : String(error)}. Any earlier failure remains the primary error.`);
      process.exitCode = 1;
    }
  } else if (!testRootRemovable) {
    console.error(`Isolated test root retained because host exit was not confirmed: ${resolvedRoot}`);
  }
}
