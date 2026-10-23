import { collectSample } from './playback-probe.mjs';
import { readFile, writeFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { Innertube, Platform, Constants, Log } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes, Logger } from 'googlevideo/utils';
import { getChallenge } from 'bgutils-js/botguard';
import { buildURL, getHeaders } from 'bgutils-js/utils';
import cases from './cases.json' with { type: 'json' };

export async function collectTrack(stream, signal, expectedBytes) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 16 * 1024 * 1024) throw new Error('Unsupported track size');
  const bytes = await collectSample(stream, signal, expectedBytes + 1, Infinity);
  if (bytes.length !== expectedBytes) throw new Error('Incomplete or excess media');
  return bytes;
}

async function main() {
  Log.setLevel(); Logger.getInstance().setLogLevels();
  const report = { date: new Date().toISOString(), account: 'anonymous; no Premium session',
    client: 'YTMUSIC', checks: [], published: false, phoneTested: false, continuousListeningTested: false };
  const controller = new AbortController();
  const boundedFetch = (input, options) => fetch(input, { ...options,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000), options?.signal].filter(Boolean)) });
  let browser, stream, timer, stage = 'output-directory';
  try {
    const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
    report.libraries = Object.fromEntries(['youtubei.js', 'googlevideo', 'bgutils-js', 'esbuild', 'playwright'].map(name => [name, lock.packages[`node_modules/${name}`].version]));
    if (!process.env.CODA_MUSIC_DIR || !isAbsolute(process.env.CODA_MUSIC_DIR)) throw new Error('An absolute output directory is required');
    const directory = resolve(process.env.CODA_MUSIC_DIR);
    const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const pathFromRoot = relative(root, await realpath(directory));
    if (pathFromRoot !== '..' && !pathFromRoot.startsWith('../') && !isAbsolute(pathFromRoot)) throw new Error('Music must stay outside the checkout');
    if ((await readdir(directory)).length) throw new Error('Output directory must be empty');
    stage = 'browser';
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'], timeout: 15000 });
    report.browserVersion = browser.version();
    timer = setTimeout(() => { controller.abort(); void stream?.abort(); void browser.close().catch(() => {}); }, 180000);
    const interpreter = await browser.newContext();
    await interpreter.setOffline(true);
    const page = await interpreter.newPage();
    Platform.shim.eval = data => page.evaluate(source => new Function(source)(), data.output);
    const tokenContext = await browser.newContext({ bypassCSP: true });
    const tokenPage = await tokenContext.newPage();
    stage = 'attestation';
    await tokenPage.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const bundle = await build({ stdin: { contents: "export { BotGuardClient } from 'bgutils-js/botguard'; export { WebPoMinter } from 'bgutils-js/webpo';",
      resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'CodaBg', logLevel: 'silent' });
    const requestKey = 'O43z0dpjhgX20SCx4KAo'; // Public client identifier used by the upstream example.
    const challenge = await getChallenge({ fetchFunction: boundedFetch, requestKey });
    const code = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!code) throw new Error('Challenge interpreter missing');
    await tokenPage.addScriptTag({ content: bundle.outputFiles[0].text });
    await tokenPage.addScriptTag({ content: code });
    const snapshot = await tokenPage.evaluate(async ({ program, globalName }) => {
      window.codaSignals = [];
      const bot = await CodaBg.BotGuardClient.create({ program, globalName, globalObject: window });
      return bot.snapshot({ webPoSignalOutput: window.codaSignals });
    }, { program: challenge.program, globalName: challenge.globalName });
    const integrityResponse = await boundedFetch(buildURL('GenerateIT', true), { method: 'POST', headers: getHeaders(),
      body: JSON.stringify([requestKey, snapshot]) });
    if (!integrityResponse.ok) throw new Error('Integrity request failed');
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await integrityResponse.json();
    await tokenPage.evaluate(async data => { window.codaMinter = await CodaBg.WebPoMinter.create(data, window.codaSignals); },
      { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken });
    const yt = await Innertube.create({ lang: 'en', location: 'MY', retrieve_player: true, enable_session_cache: false, fetch: boundedFetch });
    for (const id of cases.playbackIds) {
      stage = `track:${id}`;
      const info = await yt.getBasicInfo(id, { client: 'YTMUSIC' });
      if (info.playability_status?.status !== 'OK') throw new Error('Track unavailable');
      const mint = async () => new Uint8Array(await tokenPage.evaluate(async id => Array.from(await window.codaMinter.mint(id)), id));
      stream = new SabrStream({ videoId: id,
        serverAbrStreamingUrl: await yt.session.player.decipher(info.streaming_data?.server_abr_streaming_url),
        videoPlaybackUstreamerConfig: info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config,
        formats: info.streaming_data.adaptive_formats.map(buildSabrFormat),
        clientInfo: { clientName: Number(Constants.CLIENT_NAME_IDS.WEB_REMIX), clientVersion: Constants.CLIENTS.YTMUSIC.VERSION },
        poToken: Buffer.from(await mint()).toString('base64url'), callbacks: { onMintPoToken: mint }, fetchFunction: boundedFetch });
      const protectionStatuses = [];
      let streamError = false;
      stream.on('error', () => { streamError = true; });
      stream.on('streamProtectionStatusUpdate', status => { if (!protectionStatuses.includes(status.status)) protectionStatuses.push(status.status); });
      const { audioStream, selectedFormats } = stream.start({ enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
        audioPreferences: { container: 'webm' }, isPostLiveDvr: false, maxRetries: 0, stallDetectionMs: 10000 });
      const bytes = await collectTrack(audioStream, controller.signal, selectedFormats.audioFormat.contentLength);
      await stream.abort(); stream = null;
      if (streamError) throw new Error('Media request failed');
      const seconds = info.basic_info.duration;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 900) throw new Error('Unsupported duration');
      await page.setContent('<button>Play</button><audio controls></audio>');
      await page.evaluate(base64 => {
        const audio = document.querySelector('audio');
        audio.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'audio/webm' }));
        document.querySelector('button').onclick = () => audio.play().catch(() => {});
      }, bytes.toString('base64'));
      await page.click('button');
      await page.waitForFunction(() => document.querySelector('audio').currentTime > 1, null, { timeout: 10000 });
      await page.locator('audio').evaluate((audio, seconds) => { audio.currentTime = seconds / 2; }, seconds);
      await page.waitForFunction(seconds => document.querySelector('audio').currentTime > seconds / 2 + 0.5, seconds, { timeout: 5000 });
      await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - 2; });
      await page.waitForFunction(() => document.querySelector('audio').ended, null, { timeout: 8000 });
      const decoded = await page.locator('audio').evaluate(audio => ({ duration: audio.duration, ended: audio.ended, mediaError: audio.error?.code ?? null }));
      if (decoded.mediaError || Math.abs(decoded.duration - seconds) > 2) throw new Error('Incomplete decode');
      const track = { id, title: String(info.basic_info.title ?? id).slice(0, 200), artist: String(info.basic_info.author ?? '').slice(0, 200),
        seconds, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'audio/webm' };
      await writeFile(join(directory, `${id}.webm`), bytes, { flag: 'wx', mode: 0o600 });
      report.checks.push({ ...track, status: 'PASS', protectionStatuses, decoded });
    }
    const manifest = { version: 1, complete: true, preparedAt: new Date().toISOString(),
      tracks: report.checks.map(({ status, protectionStatuses, decoded, ...track }) => track) };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    report.published = true;
  } catch (error) {
    report.failure = { stage, errorType: controller.signal.aborted ? 'DeadlineExceeded' : error.name };
  } finally {
    clearTimeout(timer); controller.abort(); await stream?.abort(); await browser?.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.published ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
