import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';
import { openMusicSession } from '../scripts/music-session.mjs';
const id = 'Rgrt_8mXrK8'; // Public song outside the original three-track test allowlist.
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120000);
let session,
  server,
  browser,
  stage = 'session';
const report = {
  date: new Date().toISOString(),
  status: 'FAIL',
  id,
  source:
    'fresh anonymous upstream audio; synthetic library metadata and Serve identity',
  realAccountRead: 'NOT RUN',
  physicalPhone: 'NOT RUN',
  renewal: 'NOT RUN',
};
try {
  session = await openMusicSession(controller.signal);
  server = createServer({
    liveMusic: (id, signal) => session.open(id, signal),
    accountOptions: {
      owner: 'owner@example.test',
      authFile: '/fixture',
      python: 'unused',
      execute: async (r) =>
        r.operation === 'library'
          ? {
              items: [{ id: 'PLfixture123', title: 'Public song probe' }],
              limit: 50,
            }
          : {
              title: 'Public song probe',
              privacy: 'UNKNOWN',
              total: 1,
              limit: 100,
              items: [
                {
                  id,
                  title: 'Public radio edit probe',
                  artists: 'Public test song',
                },
              ],
            },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  controller.signal.addEventListener(
    'abort',
    () => {
      void browser.close();
    },
    { once: true },
  );
  const page = await browser.newPage({
    extraHTTPHeaders: { 'Tailscale-User-Login': 'owner@example.test' },
  });
  stage = 'library-controls';
  await page.goto(base);
  await page.locator('#show-account').click();
  await page.locator('#account-load').click();
  await page
    .getByRole('button', { name: 'Open playlist', exact: true })
    .click();
  stage = 'real-playback';
  await page
    .locator('#account-tracks li')
    .first()
    .getByRole('button', { name: 'Play', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('audio').currentTime > 1 &&
      !document.querySelector('audio').paused,
    null,
    { timeout: 45000 },
  );
  report.firstPlayback = await page.locator('audio').evaluate((a) => ({
    seconds: a.currentTime,
    mediaError: a.error?.code ?? null,
  }));
  stage = 'middle-seek';
  await page.locator('audio').evaluate((a) => (a.currentTime = 60));
  await page.waitForFunction(
    () => document.querySelector('audio').currentTime > 60.25,
    null,
    { timeout: 45000 },
  );
  report.seek = 'PASS';
  report.browser = browser.version();
  report.status = 'PASS';
} catch (e) {
  report.failure = {
    stage,
    type: controller.signal.aborted ? 'DeadlineExceeded' : e.name,
  };
} finally {
  clearTimeout(timer);
  controller.abort();
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise((r) => server.close(r));
  await session?.close();
}
await writeFile(
  'artifacts/library-upstream.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
process.exitCode = report.status === 'PASS' ? 0 : 1;
