import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { Innertube, Platform, Log, Constants } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes, Logger } from 'googlevideo/utils';

export async function collectSample(
  stream,
  signal,
  maxBytes = 1024 * 1024,
  maxChunks = 4,
) {
  const reader = stream.getReader(),
    chunks = [];
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  let bytes = 0;
  try {
    signal.throwIfAborted();
    signal.addEventListener('abort', cancel, { once: true });
    while (bytes < maxBytes && chunks.length < maxChunks) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      const length = Math.min(value.byteLength, maxBytes - bytes);
      chunks.push(Buffer.from(value.buffer, value.byteOffset, length));
      bytes += length;
    }
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function probe(browser, id) {
  const result = {
    id,
    status: 'FAIL',
    stage: 'session',
    protectionStatuses: [],
  };
  const context = await browser.newContext();
  // Player JavaScript runs in a fresh, offline browser, never in the Node server.
  await context.setOffline(true);
  const page = await context.newPage();
  const originalEvaluator = Platform.shim.eval;
  Platform.shim.eval = (data) =>
    page.evaluate((source) => new Function(source)(), data.output);
  const controller = new AbortController();
  let stream;
  const timer = setTimeout(() => {
    controller.abort();
    void stream?.abort();
    void context.close().catch(() => {});
  }, 45000);
  try {
    const boundedFetch = (input, options) =>
      fetch(input, {
        ...options,
        signal: AbortSignal.any(
          [
            controller.signal,
            AbortSignal.timeout(15000),
            options?.signal,
          ].filter(Boolean),
        ),
      });
    const yt = await Innertube.create({
      lang: 'en',
      location: 'MY',
      retrieve_player: true,
      enable_session_cache: false,
      fetch: boundedFetch,
    });
    result.stage = 'player';
    const info = await yt.getBasicInfo(id, { client: 'WEB' });
    result.playerStatus = info.playability_status?.status ?? 'UNKNOWN';
    if (result.playerStatus !== 'OK') throw new Error('Unplayable');
    const formats = info.streaming_data?.adaptive_formats ?? [];
    result.audioFormats = formats.filter(
      (format) => format.has_audio && !format.has_video,
    ).length;
    result.directAudioUrls = formats.filter(
      (format) => format.has_audio && !format.has_video && format.url,
    ).length;
    result.hasSabr = Boolean(info.streaming_data?.server_abr_streaming_url);
    result.stage = 'decipher';
    const url = await yt.session.player.decipher(
      info.streaming_data?.server_abr_streaming_url,
    );
    const config =
      info.player_config?.media_common_config.media_ustreamer_request_config
        ?.video_playback_ustreamer_config;
    if (!config) throw new Error('Missing streaming config');
    result.stage = 'media';
    stream = new SabrStream({
      videoId: id,
      serverAbrStreamingUrl: url,
      videoPlaybackUstreamerConfig: config,
      formats: formats.map(buildSabrFormat),
      clientInfo: {
        clientName: Number(Constants.CLIENT_NAME_IDS.WEB),
        clientVersion: yt.session.context.client.clientVersion,
      },
      fetchFunction: boundedFetch,
    });
    stream.on('error', (error) => {
      result.streamErrorType = error.name;
    });
    stream.on('streamProtectionStatusUpdate', (status) => {
      if (!result.protectionStatuses.includes(status.status))
        result.protectionStatuses.push(status.status);
    });
    const { audioStream, selectedFormats } = stream.start({
      enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
      audioPreferences: { container: 'webm' },
      isPostLiveDvr: false,
      maxRetries: 0,
      stallDetectionMs: 10000,
    });
    result.mime = selectedFormats.audioFormat.mimeType;
    result.itag = selectedFormats.audioFormat.itag;
    const sample = await collectSample(audioStream, controller.signal);
    await stream.abort();
    result.sampleBytes = sample.length;
    result.stage = 'decode';
    await page.setContent(
      '<button id="play">Play sample</button><audio id="audio" controls></audio>',
    );
    await page.evaluate(
      ({ base64, mime }) => {
        const audio = document.querySelector('audio');
        audio.src = URL.createObjectURL(
          new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], {
            type: mime,
          }),
        );
        document.querySelector('button').onclick = () =>
          audio.play().catch(() => {});
      },
      { base64: sample.toString('base64'), mime: result.mime },
    );
    await page.click('#play', { timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelector('audio').currentTime > 1,
      null,
      { timeout: 10000 },
    );
    result.browser = await page.locator('audio').evaluate((audio) => ({
      secondsPlayed: audio.currentTime,
      paused: audio.paused,
      mediaError: audio.error?.code ?? null,
    }));
    if (
      result.browser.paused ||
      result.browser.mediaError ||
      result.streamErrorType
    )
      throw new Error('Playback failed');
    result.status = 'PASS';
    result.stage = 'complete';
  } catch (error) {
    // Upstream exception messages can contain signed URLs, tokens or response bodies.
    result.errorType = controller.signal.aborted
      ? 'DeadlineExceeded'
      : error.name;
  } finally {
    clearTimeout(timer);
    controller.abort();
    await stream?.abort();
    Platform.shim.eval = originalEvaluator;
    await context.close().catch(() => {});
  }
  return result;
}

async function main() {
  // Suppress library messages: some log complete signed streaming URLs.
  Log.setLevel();
  Logger.getInstance().setLogLevels();
  const lock = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url)),
  );
  const cases = JSON.parse(
    await readFile(new URL('./cases.json', import.meta.url)),
  );
  const report = {
    date: new Date().toISOString(),
    source: 'actual YouTube audio samples',
    location: 'MY',
    libraries: Object.fromEntries(
      ['youtubei.js', 'googlevideo', 'playwright'].map((name) => [
        name,
        lock.packages[`node_modules/${name}`].version,
      ]),
    ),
    account: 'NOT RUN: no cookies, login or Premium session supplied',
    limits:
      'At most four chunks and 1 MiB retained per track; 45-second deadline per track. Upstream buffering may transfer more bytes. Samples stay in memory.',
    phonePlaybackTested: false,
    fullTrackTested: false,
    integratedCodaPlaybackTested: false,
    checks: [],
  };
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
      timeout: 15000,
    });
    report.browserVersion = browser.version();
    for (const id of cases.playbackIds)
      report.checks.push(await probe(browser, id));
  } catch (error) {
    report.setupErrorType = error.name;
  } finally {
    await browser?.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode =
    report.setupErrorType ||
    report.checks.length !== cases.playbackIds.length ||
    report.checks.some((check) => check.status !== 'PASS')
      ? 1
      : 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
