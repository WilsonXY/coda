import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';
import { openMusicSession } from '../scripts/music-session.mjs';

if (!process.env.CODA_MUSIC_DIR) throw new Error('Prepared manifest required for fixed-track metadata');
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 180000);
const report = { date: new Date().toISOString(), source: 'fresh anonymous YouTube SABR → progressive same-origin HTTP',
  status: 'FAIL', checks: [], phone: 'NOT RUN', fullContinuousSongs: 'NOT RUN', renewal: 'NOT RUN' };
let session, browser, server, stage = 'session';
try {
  session = await openMusicSession(controller.signal);
  report.sessionBrowser = session.browserVersion;
  server = createServer({ liveMusic: (id, signal) => session.open(id, signal) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const catalog = await (await fetch(base + '/api/live')).json();
  assert.equal(catalog.retrievals.length, 0);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  controller.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
  report.playbackBrowser = browser.version();
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.name));
  await page.goto(base); await page.click('#live');
  await page.waitForFunction(() => document.querySelector('#delivery-status').textContent.includes('Ready: live music'));
  await page.locator('audio').evaluate(audio => {
    window.firstById = {};
    audio.addEventListener('playing', () => {
      const id = new URL(audio.src).pathname.match(/\/live\/([\w-]{11})/)?.[1];
      if (id) window.firstById[id] ??= new Date().toISOString();
    });
  });
  await page.click('#play');
  for (const track of catalog.tracks) {
    stage = `track:${track.id}`;
    await page.waitForFunction(title => document.querySelector('#now').textContent === title && document.querySelector('audio').currentTime > 0.25, track.title, { timeout: 30000 });
    const firstPlayingAt = await page.evaluate(id => window.firstById[id], track.id);
    const until = Date.now() + 30000;
    for (;;) {
      const state = await (await fetch(base + '/api/live/status')).json();
      const current = state.tracks.find(job => job.id === track.id);
      if (current?.failure) throw new Error('Source failed');
      if (current?.completedAt) break;
      if (Date.now() > until) throw new Error('Completion deadline');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const job = (await (await fetch(base + '/api/live/status')).json()).tracks.find(job => job.id === track.id);
    report.current = { id: track.id, firstPlayingAt, retrieval: job, preparedSha256: track.sha256, preparedBytes: track.bytes };
    stage = `hash:${track.id}`;
    assert.equal(job.sha256, track.sha256, 'Fresh bytes match the independently prepared file');
    assert.equal(job.receivedBytes, track.bytes);
    const early = Date.parse(firstPlayingAt) < Date.parse(job.completedAt);
    assert.equal(early, true, 'Cold playback must precede complete upstream retrieval');
    await page.locator('audio').evaluate((audio, seconds) => { audio.currentTime = seconds / 2; }, track.seconds);
    await page.waitForFunction(seconds => document.querySelector('audio').currentTime > seconds / 2 + 0.25, track.seconds);
    report.checks.push({ id: track.id, status: 'PASS', firstPlayingAt, playbackBeforeCompletion: early,
      requestToPlayingSeconds: (Date.parse(firstPlayingAt) - Date.parse(job.startedAt)) / 1000,
      retrieval: job, middleSeek: 'PASS' });
    await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - 0.2; });
  }
  await page.waitForFunction(title => document.querySelector('#now').textContent === title && document.querySelector('audio').currentTime > 0.25, catalog.tracks[0].title);
  assert.deepEqual(pageErrors, []);
  const download = page.waitForEvent('download'); await page.click('#export');
  await (await download).saveAs('artifacts/live-upstream-export.json');
  const exported = JSON.parse(await readFile('artifacts/live-upstream-export.json', 'utf8'));
  assert.equal(exported.audioDelivery, 'live');
  assert.equal(exported.liveRunId, exported.liveStatus.runId);
  assert.ok(exported.events.filter(event => event.event === 'ended').length >= 3);
  report.inducedTransitions = 3; report.status = 'PASS';
} catch (error) { report.failure = { stage, errorType: controller.signal.aborted ? 'DeadlineExceeded' : error.name }; }
finally { clearTimeout(timer); controller.abort(); await browser?.close(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await session?.close(); }
await writeFile('artifacts/live-upstream.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
