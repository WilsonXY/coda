import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';

let calls = 0,
  fail = false,
  hostile = false;
const server = createServer({
  accountOptions: {
    owner: 'owner@example.test',
    authFile: '/private/fixture.json',
    python: 'unused',
    execute: async (request) => {
      calls++;
      if (fail) throw new Error('synthetic-private-secret');
      return request.operation === 'library'
        ? {
            items: [
              { id: 'PLfixture123', title: 'Coda fixture playlist' },
              {
                id: 'LM',
                title: hostile
                  ? '<img src=x onerror=alert(1)>' + 'x'.repeat(200)
                  : 'Liked music fixture',
              },
            ],
            limit: 50,
            complete: false,
          }
        : {
            id: request.id,
            title: 'Coda fixture playlist',
            privacy: 'PRIVATE',
            items: [
              {
                id: 'aaaaaaaaaaa',
                title: 'Fixture song A',
                artists: 'Fixture artist',
              },
              { id: null, title: 'Unavailable fixture song', artists: '' },
            ],
            limit: 100,
            total: 2,
            complete: true,
          };
    },
  },
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'Tailscale-User-Login': 'owner@example.test' },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('#play').click();
  await page.waitForFunction(
    () => document.querySelector('audio').currentTime > 0.25,
  );
  await page.locator('#show-account').click({ timeout: 2000 });
  await page.locator('#account-load').click();
  await page.waitForFunction(
    () => document.querySelectorAll('#account-playlists li').length === 2,
  );
  await page
    .locator('#account-playlists li')
    .first()
    .getByRole('button', { name: 'Open playlist' })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('#account-tracks li').length === 2,
  );
  assert.ok(
    (await page.locator('#account-playlist-status').textContent()).includes(
      'PRIVATE',
    ),
  );
  const position = await page
    .locator('audio')
    .evaluate((audio) => audio.currentTime);
  await page.waitForFunction(
    (before) => document.querySelector('audio').currentTime > before + 0.25,
    position,
  );
  assert.equal(
    await page.locator('audio').evaluate((audio) => audio.paused),
    false,
    'Library navigation does not interrupt playback',
  );
  for (const width of [390, 728]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `artifacts/account-library-${width}.png`,
      fullPage: true,
    });
  }
  hostile = true;
  await page.locator('#account-load').click();
  await page.waitForFunction(() =>
    document.querySelector('#account-playlists').textContent.includes('<img'),
  );
  assert.equal(await page.locator('#account-playlists img').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const denied = await browser.newPage();
  denied.on('pageerror', (error) => errors.push(error.message));
  const before = calls;
  await denied.goto(base);
  await denied.locator('#show-account').click();
  await denied.locator('#account-load').click();
  await denied.waitForFunction(() =>
    document.querySelector('#account-status').textContent.includes('owner'),
  );
  assert.equal(calls, before, 'Denied identity never runs the account reader');
  assert.equal(await denied.locator('#account-playlists li').count(), 0);
  await denied.close();
  fail = true;
  await page.locator('#account-load').click();
  await page.waitForFunction(() =>
    document.querySelector('#account-status').textContent.includes('failed'),
  );
  assert.equal(await page.locator('#account-tracks li').count(), 0);
  assert.equal(await page.locator('#account-playlists li').count(), 0);
  assert.equal(
    (await page.locator('body').textContent()).includes(
      'synthetic-private-secret',
    ),
    false,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/account-browser-check.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        status: 'PASS',
        source:
          'synthetic library data; simulated Serve identity header, not live account',
        libraryAndPrivatePlaylist: 'PASS',
        accessDeniedBeforeUpstream: 'PASS',
        literalRenderingAndLongTitles: 'PASS',
        failureClearsPrivateData: 'PASS',
        playbackWhileBrowsing: 'PASS',
        layouts: [390, 728],
        realAccount: 'NOT RUN',
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: owner-gated library/private playlist UI, persistent playback, literal rendering, errors and layouts. Live account not used by this fixture.',
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
