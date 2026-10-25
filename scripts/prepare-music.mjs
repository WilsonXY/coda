import { collectSample } from './playback-probe.mjs';
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  readdir,
} from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openMusicSession } from './music-session.mjs';
import cases from './cases.json' with { type: 'json' };

export async function collectTrack(stream, signal, expectedBytes) {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > 16 * 1024 * 1024
  )
    throw new Error('Unsupported track size');
  const bytes = await collectSample(
    stream,
    signal,
    expectedBytes + 1,
    Infinity,
  );
  if (bytes.length !== expectedBytes)
    throw new Error('Incomplete or excess media');
  return bytes;
}

async function main() {
  const report = {
    date: new Date().toISOString(),
    account: 'anonymous; no Premium session',
    client: 'YTMUSIC',
    checks: [],
    published: false,
    phoneTested: false,
    continuousListeningTested: false,
  };
  const controller = new AbortController();
  let session,
    stream,
    timer,
    stage = 'output-directory';
  try {
    const lock = JSON.parse(
      await readFile(new URL('../package-lock.json', import.meta.url)),
    );
    report.libraries = Object.fromEntries(
      ['youtubei.js', 'googlevideo', 'bgutils-js', 'esbuild', 'playwright'].map(
        (name) => [name, lock.packages[`node_modules/${name}`].version],
      ),
    );
    if (!process.env.CODA_MUSIC_DIR || !isAbsolute(process.env.CODA_MUSIC_DIR))
      throw new Error('An absolute output directory is required');
    const directory = resolve(process.env.CODA_MUSIC_DIR);
    const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const pathFromRoot = relative(root, await realpath(directory));
    if (
      pathFromRoot !== '..' &&
      !pathFromRoot.startsWith('../') &&
      !isAbsolute(pathFromRoot)
    )
      throw new Error('Music must stay outside the checkout');
    if ((await readdir(directory)).length)
      throw new Error('Output directory must be empty');
    stage = 'session';
    timer = setTimeout(() => controller.abort(), 180000);
    session = await openMusicSession(controller.signal);
    report.browserVersion = session.browserVersion;
    const page = session.decoderPage;
    for (const id of cases.playbackIds) {
      stage = `track:${id}`;
      stream = await session.open(id);
      const info = stream.info;
      const protectionStatuses = stream.protectionStatuses;
      const bytes = await collectTrack(
        stream.stream,
        controller.signal,
        stream.bytes,
      );
      await stream.close();
      if (stream.hasError()) throw new Error('Media request failed');
      stream = null;
      const seconds = info.basic_info.duration;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 900)
        throw new Error('Unsupported duration');
      await page.setContent('<button>Play</button><audio controls></audio>');
      await page.evaluate((base64) => {
        const audio = document.querySelector('audio');
        audio.src = URL.createObjectURL(
          new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], {
            type: 'audio/webm',
          }),
        );
        document.querySelector('button').onclick = () =>
          audio.play().catch(() => {});
      }, bytes.toString('base64'));
      await page.click('button');
      await page.waitForFunction(
        () => document.querySelector('audio').currentTime > 1,
        null,
        { timeout: 10000 },
      );
      await page.locator('audio').evaluate((audio, seconds) => {
        audio.currentTime = seconds / 2;
      }, seconds);
      await page.waitForFunction(
        (seconds) =>
          document.querySelector('audio').currentTime > seconds / 2 + 0.5,
        seconds,
        { timeout: 5000 },
      );
      await page.locator('audio').evaluate((audio) => {
        audio.currentTime = audio.duration - 2;
      });
      await page.waitForFunction(
        () => document.querySelector('audio').ended,
        null,
        { timeout: 8000 },
      );
      const decoded = await page.locator('audio').evaluate((audio) => ({
        duration: audio.duration,
        ended: audio.ended,
        mediaError: audio.error?.code ?? null,
      }));
      if (decoded.mediaError || Math.abs(decoded.duration - seconds) > 2)
        throw new Error('Incomplete decode');
      const track = {
        id,
        title: String(info.basic_info.title ?? id).slice(0, 200),
        artist: String(info.basic_info.author ?? '').slice(0, 200),
        seconds,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mime: 'audio/webm',
      };
      await writeFile(join(directory, `${id}.webm`), bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      report.checks.push({
        ...track,
        status: 'PASS',
        protectionStatuses,
        decoded,
      });
    }
    const manifest = {
      version: 1,
      complete: true,
      preparedAt: new Date().toISOString(),
      tracks: report.checks.map(
        ({ status, protectionStatuses, decoded, ...track }) => track,
      ),
    };
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    report.published = true;
  } catch (error) {
    report.failure = {
      stage,
      errorType: controller.signal.aborted ? 'DeadlineExceeded' : error.name,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
    await stream?.close();
    await session?.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.published ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
