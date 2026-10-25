import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';

let calls = 0,
  outcome = 'PASS_API_READBACK';
const app = createServer({
  accountOptions: {
    owner: 'owner@example.test',
    authFile: '/private/fixture.json',
    python: 'unused',
    testJournal: '/private/fixture-journal.json',
    execute: async (request) => {
      assert.deepEqual(request, { operation: 'playlist-test' });
      calls++;
      if (outcome === 'ERROR') throw new Error('synthetic-private-secret');
      return {
        status: outcome,
        playlistId: 'PLWEPAqmCfbhY',
        steps:
          outcome === 'PASS_API_READBACK'
            ? [
                {
                  action: 'inspect test playlist',
                  order: ['4D7u5KF7SP8', 'Rgrt_8mXrK8'],
                },
                {
                  action: 'add duplicate',
                  order: ['4D7u5KF7SP8', 'Rgrt_8mXrK8', '4D7u5KF7SP8'],
                },
                {
                  action: 'move duplicate',
                  order: ['4D7u5KF7SP8', '4D7u5KF7SP8', 'Rgrt_8mXrK8'],
                },
                {
                  action: 'remove duplicate',
                  order: ['4D7u5KF7SP8', 'Rgrt_8mXrK8'],
                },
              ]
            : [],
        note: 'Inspect the disposable test playlist; do not retry.',
      };
    },
  },
});
const tls = await mkdtemp(join(tmpdir(), 'coda-playlist-tls-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-noenc',
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
    '-keyout',
    join(tls, 'key.pem'),
    '-out',
    join(tls, 'cert.pem'),
  ],
  { stdio: 'ignore' },
);
const server = createHttpsServer(
  {
    key: await readFile(join(tls, 'key.pem')),
    cert: await readFile(join(tls, 'cert.pem')),
  },
  app.listeners('request')[0],
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `https://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Tailscale-User-Login': 'owner@example.test' },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator('#play').click();
  await page.waitForFunction(
    () => document.querySelector('audio').currentTime > 0.2,
  );
  await page.locator('#show-account').click();
  assert.equal(calls, 0, 'Navigation never starts writes');
  await page.locator('#account-test').click({ timeout: 2000 });
  await page.waitForFunction(() =>
    document
      .querySelector('#account-test-status')
      .textContent.includes('PASS_API_READBACK'),
  );
  assert.equal(calls, 1);
  assert.equal(await page.locator('#account-test').isDisabled(), true);
  assert.equal(await page.locator('#account-test-steps li').count(), 4);
  const t = await page.locator('audio').evaluate((a) => a.currentTime);
  await page.waitForFunction(
    (t) => document.querySelector('audio').currentTime > t + 0.2,
    t,
  );
  for (const width of [390, 728]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `artifacts/playlist-test-${width}.png`,
      fullPage: true,
    });
  }
  for (const next of ['FAIL_STOP', 'ALREADY_STARTED', 'ERROR']) {
    outcome = next;
    await page.reload();
    await page.locator('#show-account').click();
    await page.locator('#account-test').click();
    await page.waitForFunction(
      (next) =>
        document
          .querySelector('#account-test-status')
          .textContent.includes(next === 'ERROR' ? 'unconfirmed' : next),
      next,
    );
    assert.equal(await page.locator('#account-test').isDisabled(), true);
    assert.equal(
      (await page.locator('body').textContent()).includes(
        'synthetic-private-secret',
      ),
      false,
    );
  }
  const denied = await browser.newPage({ ignoreHTTPSErrors: true });
  await denied.goto(base);
  await denied.locator('#show-account').click();
  const before = calls;
  await denied.locator('#account-test').click();
  await denied.waitForFunction(() =>
    document
      .querySelector('#account-test-status')
      .textContent.includes('unconfirmed'),
  );
  assert.equal(calls, before, 'No owner identity means no worker call');
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/playlist-test-browser-check.json',
    JSON.stringify(
      {
        status: 'PASS',
        source:
          'synthetic worker; simulated Serve identity; real HTTPS fixture with an ephemeral self-signed test certificate',
        explicitClickOnly: true,
        successAndStoppedOutcomes: true,
        buttonStaysDisabled: true,
        denialBeforeUpstream: true,
        playbackContinues: true,
        layouts: [390, 728],
        realAccountWrites: 'NOT RUN',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: explicit one-time test controls, all outcomes, denied identity, ongoing playback and390/728 layouts; fixtures only.',
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(tls, { recursive: true, force: true });
}
