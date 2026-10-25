import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';

let code = null, calls = 0;
const server = createServer({ accountOptions: { owner: 'owner@example.test', authFile: '/private/fixture.json', python: 'unused', execute: async request => {
  calls++;
  if (code) throw Object.assign(new Error('synthetic-private-secret'), { code });
  if (request.operation === 'status') return { state: 'connected' };
  return { items: [{ id: 'PLfixture123', title: 'Fixture playlist' }], limit: 50, complete: false };
} } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, extraHTTPHeaders: { 'Tailscale-User-Login': 'owner@example.test' } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .25);
  await page.locator('#show-account').click();
  assert.equal(calls, 0, 'Opening library does not poll the account');
  await page.getByRole('button', { name: 'Check connection', exact: true }).click({ timeout: 2000 });
  await page.waitForFunction(() => document.querySelector('#account-connection').textContent.startsWith('Connected'));
  await page.locator('#account-load').click();
  await page.waitForFunction(() => document.querySelectorAll('#account-playlists li').length === 1);
  const queueBefore = await page.locator('#queue').textContent();
  code = 'ACCOUNT_REAUTH_REQUIRED';
  await page.locator('#account-check').click();
  await page.waitForFunction(() => document.querySelector('#account-connection').textContent.includes('Reconnect'));
  assert.equal(await page.locator('#account-playlists li').count(), 0, 'Rejected reads clear private browsing data');
  assert.equal(await page.locator('#queue').textContent(), queueBefore, 'Rejected reads preserve the playback queue');
  assert.equal(await page.locator('#account-recovery').isVisible(), true);
  await page.locator('#account-recovery summary').click();
  for (const width of [390, 728]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `artifacts/account-recovery-${width}.png`, fullPage: true });
  }
  const position = await page.locator('audio').evaluate(audio => audio.currentTime);
  await page.waitForFunction(before => document.querySelector('audio').currentTime > before + .25, position);
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false, 'Reauthentication does not stop the current audio');
  code = null;
  await page.locator('#account-check').click();
  await page.waitForFunction(() => document.querySelector('#account-connection').textContent.startsWith('Connected'));
  assert.equal(await page.locator('#account-recovery').isVisible(), false);
  code = 'ACCOUNT_SETUP_REQUIRED';
  await page.locator('#account-check').click();
  await page.waitForFunction(() => document.querySelector('#account-connection').textContent.includes('setup'));
  assert.equal(await page.locator('#account-recovery').isVisible(), true);
  code = 'UNKNOWN';
  await page.locator('#account-check').click();
  await page.waitForFunction(() => document.querySelector('#account-connection').textContent.includes('unverified'));
  assert.equal(await page.locator('#account-recovery').isVisible(), false, 'Transient errors do not prescribe a credential refresh');
  const denied = await browser.newPage();
  await denied.goto(`http://127.0.0.1:${server.address().port}`); await denied.locator('#show-account').click();
  const before = calls;
  await denied.locator('#account-check').click();
  await denied.waitForFunction(() => document.querySelector('#account-connection').textContent.includes('owner'));
  assert.equal(calls, before);
  assert.equal((await page.locator('body').textContent()).includes('synthetic-private-secret'), false);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/account-session-browser-check.json', JSON.stringify({ date: new Date().toISOString(), status: 'PASS', browser: browser.version(), source: 'Synthetic account responses and Serve identity; generated tone playback', states: ['connected', 'reconnect', 'setup', 'unverified', 'owner-required'], failureClearsPrivateView: true, playbackContinues: true, checkAfterRefreshRecovers: true, noAutomaticPolling: true, layouts: [390, 728], realAccount: 'NOT USED' }, null, 2));
  console.log('PASS: connection states, local recovery, owner rejection and uninterrupted player; synthetic fixtures only.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
