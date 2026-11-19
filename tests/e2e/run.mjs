// End-to-end check of the built extension against a local fake Pinterest (server.py).
// Chromium is pointed at the fake server with --host-resolver-rules, so nothing reaches
// the real pinterest.com. Run: npm run build && python3 tests/e2e/setup.py &&
// (python3 tests/e2e/server.py &) && node tests/e2e/run.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const HERE = path.join(ROOT, 'tests/e2e/.work');
const EXT = path.join(ROOT, '.output/chrome-mv3');
const PROFILE = path.join(HERE, 'profile');
const DL = path.join(HERE, 'downloads');
const SHOTS = path.join(HERE, 'shots');
const scale = Number(process.env.SCALE ?? 1);

fs.rmSync(PROFILE, { recursive: true, force: true });
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(path.join(PROFILE, 'Default'), { recursive: true });
fs.mkdirSync(DL, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'Default', 'Preferences'),
  JSON.stringify({ download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true }, savefile: { default_directory: DL } }),
);

const chrome = spawn(process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', [
  '--headless=new', '--no-sandbox', '--remote-debugging-port=9333', `--user-data-dir=${PROFILE}`,
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--host-resolver-rules=MAP www.pinterest.com 127.0.0.1:8443, MAP i.pinimg.com 127.0.0.1:8443',
  '--ignore-certificate-errors', '--no-proxy-server', '--no-first-run', '--window-size=1440,900',
  `--force-device-scale-factor=${scale}`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => (chromeErr += d));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listFiles = (dir) => {
  const out = [];
  const walk = (d) => fs.existsSync(d) && fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.relative(DL, path.join(d, e.name)))));
  walk(dir);
  return out.sort();
};

try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
    } catch {
      await sleep(250);
    }
  }
  if (!browser) throw new Error('chrome did not start: ' + chromeErr.slice(-2000));
  const context = browser.contexts()[0];
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  const ID = 'mkbabhikjbjlgcchkjmilpbfnliogiin';
  let sw = context.serviceWorkers().find((w) => w.url().includes(ID));
  for (let i = 0; i < 120 && !sw; i++) {
    await sleep(250);
    sw = context.serviceWorkers().find((w) => w.url().includes(ID));
  }
  check('extension service worker started', sw.url().includes('background.js'), sw.url());

  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto('https://www.pinterest.com/jane/interior-refs/');
  await page.waitForSelector('[data-grid-item] img');
  await sleep(500);

  // Inactive by default: nothing injected.
  check('nothing shown before turning on', (await page.locator('.heist-pin-host').count()) === 0 && (await page.locator('pinterest-heist-ui').count()) === 0);

  // Turn on, as the toolbar button would.
  const activate = (on) =>
    sw.evaluate(async (on) => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.pinterest.com/*' });
      await chrome.storage.session.set({ [`active:${tab.id}`]: on });
      await chrome.tabs.sendMessage(tab.id, { type: 'heist:set-active', active: on });
    }, on);
  await activate(true);
  await page.waitForSelector('pinterest-heist-ui', { state: 'attached' });
  await sleep(600);
  const ui = page.locator('pinterest-heist-ui');
  check('dock appears after turning on', await ui.locator('.dock').isVisible());
  check('first-run tips show', await ui.locator('.tips').isVisible());
  const circles = await page.locator('.heist-pin-host[data-kind="pin"]').count();
  const secCircles = await page.locator('.heist-pin-host[data-kind="section"]').count();
  check('a circle is attached to every pin', circles === 5, `${circles} pins`);
  check('section cards get circles', secCircles === 2, `${secCircles} sections`);
  await page.screenshot({ path: path.join(SHOTS, '01-on.png') });
  await ui.locator('.tips .btn').click();

  // Hover shows the circle; click selects without navigating.
  const firstCard = page.locator('[data-grid-item]').nth(0);
  await firstCard.hover();
  await sleep(250);
  const opacity = await page.locator('.heist-pin-host[data-kind="pin"]').nth(0).evaluate((h) => getComputedStyle(h.shadowRoot.querySelector('.pick')).opacity);
  check('hovering a pin shows its circle', Number(opacity) > 0.9, `opacity ${opacity}`);
  await page.locator('.heist-pin-host[data-kind="pin"]').nth(0).locator('.pick').click();
  await sleep(150);
  const count = () => ui.locator('.count b').textContent();
  check('clicking the circle selects the pin', (await count()) === '1');
  check('clicking the circle does not open the pin', !(await page.evaluate(() => window.__navigated)));
  // Shift+click range.
  await page.locator('[data-grid-item]').nth(3).hover();
  await page.locator('.heist-pin-host[data-kind="pin"]').nth(3).locator('.pick').click({ modifiers: ['Shift'] });
  await sleep(150);
  check('Shift+click selects a range', (await count()) === '4', `count ${await count()}`);
  await page.mouse.move(700, 120);
  await page.screenshot({ path: path.join(SHOTS, '02-selected.png') });

  // Esc clears; Deselect all button; S selection mode.
  await page.keyboard.press('Escape');
  await sleep(100);
  check('Esc deselects all', (await count()) === '0');
  await page.keyboard.press('s');
  await sleep(150);
  check('S turns on selection mode', await ui.locator('.mode-pill').isVisible());
  await page.locator('[data-grid-item] img').nth(1).click();
  await sleep(150);
  check('plain click selects in selection mode', (await count()) === '1');
  check('…and does not open the pin', !(await page.evaluate(() => window.__navigated)));
  await ui.locator('.dock .btn', { hasText: 'Deselect all' }).click();
  check('Deselect all button clears', (await count()) === '0');
  await page.keyboard.press('s');
  await sleep(100);
  check('S turns selection mode off', !(await ui.locator('.mode-pill').count()));
  await page.locator('[data-grid-item] img').nth(1).click();
  await sleep(100);
  check('outside selection mode, clicks reach Pinterest', (await page.evaluate(() => window.__navigated)) === 1);

  // Ctrl+drag box select.
  const b0 = await page.locator('[data-grid-item]').nth(0).boundingBox();
  const b2 = await page.locator('[data-grid-item]').nth(2).boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.move(b0.x - 5, b0.y + 20);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width + 5, b0.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await sleep(150);
  check('Ctrl+drag box-selects pins', (await count()) === '3', `count ${await count()}`);
  await page.keyboard.press('Escape');

  // Shortcut sheet.
  await page.keyboard.press('?');
  await sleep(150);
  check('? opens the shortcut sheet', await ui.locator('.keys').isVisible());
  await page.screenshot({ path: path.join(SHOTS, '03-shortcuts.png') });
  await page.keyboard.press('Escape');
  await sleep(100);

  // Ctrl+A on the board: whole board via the API.
  await page.locator('h1').click();
  await page.keyboard.press('Control+a');
  await sleep(500);
  check('Ctrl+A selects the whole board (9 pins)', (await count()) === '9', `count ${await count()}`);
  const selectedHosts = await page.locator('.heist-pin-host[data-selected]').count();
  check('every pin and section shows as selected', selectedHosts === 7, `${selectedHosts} marked`);

  // Download sheet: Files.
  await ui.locator('.dock .btn.primary').click();
  await ui.locator('.panel .form').waitFor();
  await sleep(400);
  const where = await ui.locator('.loc span').textContent();
  check('sheet shows the Downloads location', where === 'Downloads\\Pinterest Heist\\Interior Refs\\', where);
  const secRows = await ui.locator('.checks .check').count();
  check('sheet lists sections to include', secRows === 3, `${secRows} rows`);
  await page.screenshot({ path: path.join(SHOTS, '04-sheet.png') });
  await ui.locator('.foot .btn.primary').click();
  await ui.locator('.toast.done').waitFor({ timeout: 30000 });
  await sleep(1500);
  const files = listFiles(DL);
  console.log('    files:', files.join(' | '));
  const expect = [
    'Pinterest Heist/Interior Refs/Interior Refs_001.jpg',
    'Pinterest Heist/Interior Refs/Interior Refs_003.png',
    'Pinterest Heist/Interior Refs/Kitchens/Interior Refs_Kitchens_001.jpg',
    'Pinterest Heist/Interior Refs/Lighting/Interior Refs_Lighting_001a.jpg',
    'Pinterest Heist/Interior Refs/Lighting/Interior Refs_Lighting_001b.jpg',
    'Pinterest Heist/Interior Refs/Lighting/Interior Refs_Lighting_002.jpg',
    'Pinterest Heist/Interior Refs/metadata.json',
    'Pinterest Heist/Interior Refs/metadata.csv',
  ];
  check('files land in Downloads with section sub-folders', expect.every((f) => files.includes(f)), `${files.length} files`);
  const orig = fs.statSync(path.join(DL, 'Pinterest Heist/Interior Refs/Interior Refs_001.jpg')).size;
  const thumb = fs.statSync(path.join(HERE, 'img/1001-236.jpg')).size;
  check('downloads are the original size, not the thumbnail', orig > thumb * 5, `${orig} vs thumb ${thumb} bytes`);
  const fallback = fs.statSync(path.join(DL, 'Pinterest Heist/Interior Refs/Lighting/Interior Refs_Lighting_002.jpg')).size;
  check('missing originals fall back to 736px', Math.abs(fallback - fs.statSync(path.join(HERE, 'img/3002-736.jpg')).size) < 10);
  const meta = JSON.parse(fs.readFileSync(path.join(DL, 'Pinterest Heist/Interior Refs/metadata.json'), 'utf8'));
  check('metadata lists every file with its source', meta.items.length === 10 && meta.items[0].sourceUrl.startsWith('https://example.com'), `${meta.items.length} items`);
  await page.screenshot({ path: path.join(SHOTS, '05-done.png') });

  // ZIP of two sections only.
  await ui.locator('.dock .btn.primary').click();
  await ui.locator('.panel .form').waitFor();
  await sleep(400);
  await ui.locator('.seg button', { hasText: 'ZIP' }).click();
  await ui.locator('#heist-name').fill('Refs ZIP');
  await ui.locator('.checks .check').nth(0).locator('input').uncheck();
  await ui.locator('.foot .btn.primary').click();
  await ui.locator('.toast.done', { hasText: 'ZIP' }).waitFor({ timeout: 30000 });
  await sleep(1000);
  const zip = path.join(DL, 'Pinterest Heist/Refs ZIP.zip');
  check('ZIP is saved to Downloads/Pinterest Heist', fs.existsSync(zip));
  if (fs.existsSync(zip)) {
    const { execSync } = await import('node:child_process');
    const listing = execSync(`python3 -c "import zipfile,sys;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))" "${zip}"`).toString().trim().split('\n');
    console.log('    zip:', listing.join(' | '));
    check('ZIP has one sub-folder per section and no unsorted pins', listing.includes('Kitchens/Refs ZIP_Kitchens_001.jpg') === false && listing.some((n) => n.startsWith('Kitchens/')) && listing.some((n) => n.startsWith('Lighting/')) && !listing.some((n) => /^Interior Refs_00\d/.test(n)) && listing.includes('metadata.json'));
  }

  // PureRef handoff with one pin.
  await page.keyboard.press('Escape');
  await page.locator('[data-grid-item]').nth(4).hover();
  await page.locator('.heist-pin-host[data-kind="pin"]').nth(4).locator('.pick').click();
  await ui.locator('.dock .btn', { hasText: 'Send to PureRef' }).click();
  await ui.locator('.toast.done', { hasText: 'PureRef' }).waitFor({ timeout: 20000 });
  await sleep(500);
  const pr = listFiles(path.join(DL, 'Pinterest Heist/_PureRef'));
  check('Send to PureRef saves into _PureRef', pr.length === 1, pr.join(', '));
  await page.screenshot({ path: path.join(SHOTS, '06-pureref.png') });

  // Turn off removes everything.
  await ui.locator('.dock .btn[aria-label="Turn off"]').click();
  await sleep(300);
  check('turning off removes the dock and circles', (await page.locator('pinterest-heist-ui').count()) === 0 && (await page.locator('.heist-pin-host').count()) === 0);
  const badge = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.pinterest.com/*' });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
  check('toolbar badge clears when turned off', badge === '', `badge "${badge}"`);
  const realErrors = consoleErrors.filter((t) => !t.includes('Failed to load resource'));
  check('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' / '));

  await browser.close().catch(() => {});
} catch (e) {
  console.log('ERROR', e);
  results.push({ name: 'run', ok: false });
} finally {
  chrome.kill('SIGKILL');
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
