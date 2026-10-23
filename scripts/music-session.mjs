import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { Innertube, Platform, Constants, Log } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes, Logger } from 'googlevideo/utils';
import { getChallenge } from 'bgutils-js/botguard';
import { buildURL, getHeaders } from 'bgutils-js/utils';

// Runs upstream player/challenge code in fresh browser contexts, never in Node.
export async function openMusicSession(signal) {
  Log.setLevel(); Logger.getInstance().setLogLevels();
  const boundedFetch = (input, options) => fetch(input, { ...options,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000), options?.signal].filter(Boolean)) });
  let browser;
  signal.throwIfAborted();
  const aborted = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener('abort', aborted, { once: true });
  const previousEvaluator = Platform.shim.eval;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'], timeout: 15000 });
    const interpreter = await browser.newContext();
    await interpreter.setOffline(true);
    const page = await interpreter.newPage();
    Platform.shim.eval = data => page.evaluate(source => new Function(source)(), data.output);
    const tokenContext = await browser.newContext({ bypassCSP: true });
    const tokenPage = await tokenContext.newPage();
    await tokenPage.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const bundle = await build({ stdin: { contents: "export { BotGuardClient } from 'bgutils-js/botguard'; export { WebPoMinter } from 'bgutils-js/webpo';",
      resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'iife', globalName: 'CodaBg', logLevel: 'silent' });
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

    return {
      browserVersion: browser.version(), decoderPage: page,
      async open(id, trackSignal = signal) {
        const info = await yt.getBasicInfo(id, { client: 'YTMUSIC' });
        if (info.playability_status?.status !== 'OK') throw new Error('Track unavailable');
        const mint = async () => new Uint8Array(await tokenPage.evaluate(async id => Array.from(await window.codaMinter.mint(id)), id));
        const stream = new SabrStream({ videoId: id,
          serverAbrStreamingUrl: await yt.session.player.decipher(info.streaming_data?.server_abr_streaming_url),
          videoPlaybackUstreamerConfig: info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config,
          formats: info.streaming_data.adaptive_formats.map(buildSabrFormat),
          clientInfo: { clientName: Number(Constants.CLIENT_NAME_IDS.WEB_REMIX), clientVersion: Constants.CLIENTS.YTMUSIC.VERSION },
          poToken: Buffer.from(await mint()).toString('base64url'), callbacks: { onMintPoToken: mint }, fetchFunction: (input, options) => boundedFetch(input, { ...options, signal: AbortSignal.any([trackSignal, options?.signal].filter(Boolean)) }) });

        const protectionStatuses = [];
        let failed = false;
        stream.on('error', () => { failed = true; });
        stream.on('streamProtectionStatusUpdate', status => { if (!protectionStatuses.includes(status.status)) protectionStatuses.push(status.status); });
        const { audioStream, selectedFormats } = stream.start({ enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
          audioPreferences: { container: 'webm' }, isPostLiveDvr: false, maxRetries: 0, stallDetectionMs: 10000 });
        return { stream: audioStream, bytes: selectedFormats.audioFormat.contentLength, info,
          protectionStatuses, hasError: () => failed, close: () => stream.abort() };
      },
      async close() { signal.removeEventListener('abort', aborted); Platform.shim.eval = previousEvaluator; await browser.close(); },
    };
  } catch (error) { signal.removeEventListener('abort', aborted); Platform.shim.eval = previousEvaluator; await browser?.close(); throw error; }
}
