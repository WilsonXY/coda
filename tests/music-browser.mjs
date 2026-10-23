import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../server.mjs';

if (!process.env.CODA_MUSIC_DIR) throw new Error('Set CODA_MUSIC_DIR to a prepared private cache');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const catalogResponse = await fetch(base + '/api/music');
assert.equal(catalogResponse.status, 200, 'Prepare all three complete tracks first');
const catalog = await catalogResponse.json();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let musicRequests = 0;
  page.on('request', request => { if (request.url().includes('/music/')) musicRequests++; });
  await page.goto(base);
  await page.locator('#music').click({ timeout: 2000 });
  await page.waitForFunction(() => document.querySelector('#delivery-status').textContent.includes('Ready: three complete music tracks'), null, { timeout: 20000 });
  assert.equal(musicRequests, 3);
  await page.context().setOffline(true);
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 1);
  assert.ok((await page.locator('audio').getAttribute('src')).startsWith('blob:'));
  assert.equal(await page.locator('#music').isDisabled(), true);
  assert.equal(await page.locator('#preload').isDisabled(), true);
  await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration / 2; });
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 185.5);
  await page.locator('#show-search').click();
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  await page.locator('#show-player').click();
  for (const track of [catalog.tracks[1], catalog.tracks[2], catalog.tracks[0]]) {
    await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - 0.3; });
    await page.waitForFunction(title => document.querySelector('#now').textContent === title, track.title);
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 0.2 && !document.querySelector('audio').paused);
  }
  assert.equal(musicRequests, 3, 'Real-music transitions use only the fully loaded files');
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  await (await download).saveAs('artifacts/music-export.json');
  const result = JSON.parse(await readFile('artifacts/music-export.json', 'utf8'));
  assert.equal(result.source, 'prepared YouTube audio; anonymous retrieval; fully buffered');
  assert.equal(result.audioDelivery, 'preloaded');
  assert.deepEqual(result.musicTrackIds, catalog.tracks.map(track => track.id));
  assert.equal(result.musicPreparedAt, catalog.preparedAt);
  assert.ok(result.events.filter(event => event.event === 'ended').length >= 3);
  assert.ok(result.checks.every(check => check.status === 'NOT RUN'));
  await page.screenshot({ path: 'artifacts/music-390.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 728, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'artifacts/music-728.png', fullPage: true });
  const report = { date: new Date().toISOString(), browser: browser.version(), source: result.source,
    byteVerifiedTrackIds: result.musicTrackIds, offlineTransitions: 3, middleSeek: 'PASS', normalSpeedFullTrack: 'NOT RUN', phone: 'NOT RUN' };
  const failed = await browser.newPage();
  await failed.route(`**/music/${catalog.tracks[1].id}.webm`, route => route.fulfill({ status: 503, body: 'unavailable' }));
  await failed.goto(base);
  await failed.locator('#music').click();
  await failed.waitForFunction(() => document.querySelector('#delivery-status').textContent.includes('Could not load all music tracks'));
  assert.equal(await failed.locator('#music').isDisabled(), false);
  await failed.locator('#play').click();
  await failed.waitForFunction(() => document.querySelector('audio').currentTime > 0.2);
  assert.equal(await failed.locator('audio').getAttribute('src'), '/audio/0.wav');
  await failed.close();
  report.partialPreparationFailure = 'PASS: original tones remain usable';
  if (process.env.CODA_LONG_PLAY === '1') {
    await page.locator('audio').evaluate(audio => { audio.currentTime = 0; });
    const start = Date.now();
    assert.equal(await page.locator('audio').evaluate(audio => audio.playbackRate), 1);
    await page.waitForFunction(title => document.querySelector('#now').textContent === title, catalog.tracks[1].title, { timeout: 420000 });
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 1);
    report.normalSpeedFullTrack = 'PASS';
    report.fullTrackWallSeconds = (Date.now() - start) / 1000;
    assert.ok(report.fullTrackWallSeconds >= catalog.tracks[0].seconds - 2, 'No premature end-of-track counted as a full song');
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/music-browser.json', JSON.stringify(report, null, 2));
  console.log('PASS: prepared real music, byte-verified HTTP delivery, offline browser playback/seek/three transitions, source-labelled export and 390px/728px layouts. Physical phone NOT RUN.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
