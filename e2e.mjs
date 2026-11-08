#!/usr/bin/env node
// Drives the built app in a real browser and writes what happened to e2e-results.json.
//
//   npx ng build --configuration development
//   node e2e.mjs
//
// BROWSER_CHANNEL picks the installed browser (msedge by default, or chrome).
// The browser is closed in `finally`, which also removes the temporary profile
// folder Playwright made for it.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = join(process.cwd(), 'dist', 'angular-signal-forms-submit-pending-demo', 'browser');
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`No build at ${ROOT}. Run: npx ng build --configuration development`);
  process.exit(2);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  let file = join(ROOT, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const channel = process.env.BROWSER_CHANNEL ?? 'msedge';
const results = {};

async function scenario(page, name, query, drive, settleMs = 900) {
  await page.goto(`${base}?${query}`);
  await page.waitForSelector('#username');
  await page.evaluate(() => {
    window.timeline ??= [];
    const add = (what) => window.timeline.push({ t: performance.now(), what });
    document.addEventListener('click', () => add('click'), true);
    document.addEventListener('submit', () => add('submit event'), true);
    document.querySelector('#username').addEventListener('input', () => add('input'), true);
  });
  const during = (await drive(page)) ?? null;
  await page.waitForTimeout(settleMs);
  const timeline = await page.evaluate(() => window.timeline);
  const seen = await page.evaluate(() => ({
    error: document.querySelector('#error')?.textContent ?? null,
    result: document.querySelector('#result')?.textContent ?? '',
    disabled: document.querySelector('#send').disabled,
    value: document.querySelector('#username').value,
  }));
  const origin = timeline.find((m) => m.what === 'click' || m.what === 'submit event') ?? timeline[0];
  const t0 = origin ? origin.t : 0;
  const rel = timeline.map((m) => ({ t: Math.round(m.t - t0), what: m.what }));
  results[name] = { timeline: rel, seen, during };
  console.log(`\n--- ${name}   (?${query})`);
  for (const m of rel) console.log(`  ${String(m.t).padStart(5)} ms  ${m.what}`);
  console.log(`  on screen: error=${JSON.stringify(seen.error)} result=${JSON.stringify(seen.result)}`);
  if (during !== null) console.log(`  during: ${JSON.stringify(during)}`);
}

async function clickButton(page) {
  const box = await page.locator('#send').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function type(page, text) {
  await page.locator('#username').focus();
  await page.keyboard.type(text);
}
async function typeThenClick(page, text) {
  await type(page, text);
  await clickButton(page);
}
async function typeThenEnter(page, text) {
  await type(page, text);
  await page.keyboard.press('Enter');
}
// A person's hand: a pause after the last letter, and a mouse button held down
// for about as long as a real click.
const HUMAN_PAUSE_MS = 80;
const HUMAN_PRESS_MS = 100;
async function press(page) {
  const box = await page.locator('#send').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(HUMAN_PRESS_MS);
  await page.mouse.up();
}
async function retype(page, text) {
  await page.waitForTimeout(400);
  await page.locator('#username').focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
}
const buttonState = (page) =>
  page.evaluate(() => ({
    disabled: document.querySelector('#send').disabled,
    checking: document.querySelector('#checking') !== null,
  }));

const browser = await chromium.launch({ channel, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });

  // The three ignoreValidators modes, clicking straight after typing.
  await scenario(page, 'default click taken', 'strategy=default', (p) => typeThenClick(p, 'khaled'));
  await scenario(page, 'none click taken', 'strategy=none', (p) => typeThenClick(p, 'khaled'));
  await scenario(page, 'none click free', 'strategy=none', async (p) => {
    await typeThenClick(p, 'layla');
    return buttonState(p);
  });
  await scenario(page, 'all click taken', 'strategy=all', (p) => typeThenClick(p, 'khaled'));

  // Disabling the button while pending.
  await scenario(page, 'disabled click free', 'strategy=disabled', async (p) => {
    await typeThenClick(p, 'layla');
    return buttonState(p);
  });
  await scenario(page, 'disabled enter free fast', 'strategy=disabled', (p) => typeThenEnter(p, 'layla'));
  await scenario(page, 'disabled click free human', 'strategy=disabled&checkMs=400', async (p) => {
    await type(p, 'layla');
    await p.waitForTimeout(HUMAN_PAUSE_MS);
    const before = await buttonState(p);
    await press(p);
    return before;
  });
  await scenario(page, 'disabled enter free human', 'strategy=disabled&checkMs=400', async (p) => {
    await type(p, 'layla');
    await p.waitForTimeout(HUMAN_PAUSE_MS);
    const before = await buttonState(p);
    await p.keyboard.press('Enter');
    return before;
  });

  // Waiting for the check to finish, then submitting.
  await scenario(page, 'wait click taken', 'strategy=wait', (p) => typeThenClick(p, 'khaled'));
  await scenario(page, 'wait click free human', 'strategy=wait&checkMs=400', async (p) => {
    await type(p, 'layla');
    await p.waitForTimeout(HUMAN_PAUSE_MS);
    await press(p);
  });
  await scenario(page, 'wait click free', 'strategy=wait', (p) => typeThenClick(p, 'layla'));
  await scenario(page, 'wait enter free', 'strategy=wait', (p) => typeThenEnter(p, 'layla'));
  await scenario(page, 'wait double click free', 'strategy=wait', async (p) => {
    await type(p, 'layla');
    const box = await p.locator('#send').boundingBox();
    await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  });
  await scenario(page, 'wait server says taken', 'strategy=wait', (p) => typeThenClick(p, 'raced'));

  // The exact component the post shows.
  await scenario(page, 'recommended click taken', 'page=recommended', (p) => typeThenClick(p, 'khaled'));
  await scenario(page, 'recommended click free', 'page=recommended', (p) => typeThenClick(p, 'layla'));
  await scenario(page, 'recommended enter free', 'page=recommended', (p) => typeThenEnter(p, 'layla'));
  await scenario(page, 'recommended server says taken', 'page=recommended', (p) => typeThenClick(p, 'raced'));

  // The debounce option on the validator.
  await scenario(page, 'validator debounce default enter taken', 'strategy=default&validatorDebounceMs=300', (p) => typeThenEnter(p, 'khaled'), 1200);
  await scenario(page, 'validator debounce disabled click free', 'strategy=disabled&validatorDebounceMs=300', async (p) => {
    await type(p, 'layla');
    await p.waitForTimeout(HUMAN_PAUSE_MS);
    const before = await buttonState(p);
    await press(p);
    return before;
  }, 1200);

  // Text and click in one script task: nothing can render between them, so this is
  // the one tick before the validator's debounce has started.
  const sameTask = (name) => (p) =>
    p.evaluate((value) => {
      const input = document.querySelector('#username');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#send').click();
    }, name);
  await scenario(page, 'validator debounce none same task', 'strategy=none&validatorDebounceMs=300', sameTask('khaled'), 1200);
  await scenario(page, 'validator debounce wait same task', 'strategy=wait&validatorDebounceMs=300', sameTask('khaled'), 1200);
  await scenario(page, 'validator debounce wait click taken', 'strategy=wait&validatorDebounceMs=300', (p) => typeThenClick(p, 'khaled'), 1200);

  await scenario(page, 'validator debounce wait enter taken', 'strategy=wait&validatorDebounceMs=300', (p) => typeThenEnter(p, 'khaled'), 1200);

  // The debounce() rule on the field, from a field that was already valid.
  await scenario(page, 'field debounce default enter', 'strategy=default&fieldDebounceMs=300&start=layla', async (p) => {
    await retype(p, 'khaled');
    await p.keyboard.press('Enter');
  }, 1200);
  await scenario(page, 'field debounce none enter', 'strategy=none&fieldDebounceMs=300&start=layla', async (p) => {
    await retype(p, 'khaled');
    await p.keyboard.press('Enter');
  }, 1200);
  await scenario(page, 'field debounce wait enter', 'strategy=wait&fieldDebounceMs=300&start=layla', async (p) => {
    await retype(p, 'khaled');
    await p.keyboard.press('Enter');
  }, 1200);
  await scenario(page, 'field debounce disabled enter', 'strategy=disabled&fieldDebounceMs=300&start=layla', async (p) => {
    await retype(p, 'khaled');
    const before = await buttonState(p);
    await p.keyboard.press('Enter');
    return before;
  }, 1200);
  await scenario(page, 'field debounce default click', 'strategy=default&fieldDebounceMs=300&start=layla', async (p) => {
    await retype(p, 'khaled');
    await clickButton(p);
  }, 1200);
  await scenario(page, 'field debounce disabled click human', 'strategy=disabled&fieldDebounceMs=300&start=layla', async (p) => {
    await retype(p, 'khaled');
    await p.waitForTimeout(40);
    const before = await buttonState(p);
    await press(p);
    return before;
  }, 1200);
  await scenario(page, 'field debounce wait flush enter', 'strategy=wait&fieldDebounceMs=300&start=layla&flush=1', async (p) => {
    await retype(p, 'khaled');
    await p.keyboard.press('Enter');
  }, 1200);
} finally {
  await browser.close();
  server.close();
}

writeFileSync('e2e-results.json', JSON.stringify(results, null, 2));
