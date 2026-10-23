import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import cases from './scripts/cases.json' with { type: 'json' };
import { createLiveMusic } from './live-music.mjs';
import { search, playlist, playability } from './youtube.mjs';

const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const hosts = new Set(['localhost', '127.0.0.1', ...(process.env.CODA_ALLOWED_HOSTS ?? '').split(',').filter(Boolean)]);

// Generated quiet PCM tones: no downloads or third-party recordings.
function tone(index) {
  const rate = 16000, seconds = 20, samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const pulse = (i % rate) / rate;
    const fade = Math.min(1, pulse * 30, (1 - pulse) * 30);
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * [220, 330, 440][index] * i / rate) * 1500 * fade), 44 + i * 2);
  }
  return wav;
}
const tones = [0, 1, 2].map(tone);

async function musicManifest(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.complete !== true || !Number.isFinite(Date.parse(manifest.preparedAt)) ||
      !Array.isArray(manifest.tracks) || manifest.tracks.length !== cases.playbackIds.length) throw new Error('Invalid music manifest');
  const tracks = manifest.tracks.map((track, index) => {
    if (track.id !== cases.playbackIds[index] || track.mime !== 'audio/webm' ||
        typeof track.title !== 'string' || !track.title.length || track.title.length > 200 ||
        typeof track.artist !== 'string' || track.artist.length > 200 ||
        !Number.isFinite(track.seconds) || track.seconds <= 0 || track.seconds > 900 ||
        !Number.isSafeInteger(track.bytes) || track.bytes <= 0 || track.bytes > 16 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(track.sha256)) throw new Error('Invalid prepared track');
    return { id: track.id, title: track.title, artist: track.artist, seconds: track.seconds,
      bytes: track.bytes, sha256: track.sha256, mime: track.mime };
  });
  return { preparedAt: manifest.preparedAt, tracks };
}

export function createServer({ musicDirectory = process.env.CODA_MUSIC_DIR, liveMusic } = {}) {
  const live = liveMusic ? createLiveMusic(liveMusic) : null;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!hosts.has(url.hostname)) return json(403, { error: 'Host not allowed.' });
      if (req.headers.origin && (!URL.canParse(req.headers.origin) || new URL(req.headers.origin).host !== req.headers.host)) return json(403, { error: 'Cross-site request rejected.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Read-only experiment.' });
      if (url.pathname.startsWith('/api/') && req.method === 'HEAD') return json(405, { error: 'GET required.' });
      if (url.pathname === '/api/search') {
        const q = url.searchParams.get('q')?.trim();
        const type = url.searchParams.get('type') ?? 'song';
        if (!q || q.length > 120 || !['song', 'playlist'].includes(type)) return json(400, { error: 'Enter a query of 1–120 characters and a supported type.' });
        return json(200, await search(q, type));
      }
      if (url.pathname === '/api/playlist') {
        const id = url.searchParams.get('id');
        if (!id || !/^(VL)?(PL|RD|OL)[\w-]{5,120}$/.test(id)) return json(400, { error: 'Enter a public playlist ID.' });
        return json(200, await playlist(id));
      }
      if (url.pathname === '/api/playability') {
        const id = url.searchParams.get('id');
        if (!id || !/^[\w-]{11}$/.test(id)) return json(400, { error: 'Enter an 11-character video ID.' });
        return json(200, await playability(id));
      }
      if (url.pathname === '/api/live' || url.pathname === '/api/live/status') {
        if (!live) return json(503, { error: 'Live music is not enabled. Start the optional live experiment.' });
        if (url.pathname.endsWith('/status')) return json(200, live.status());
        if (!musicDirectory) return json(503, { error: 'Fixed-track metadata is not configured.' });
        const status = live.status();
        return json(200, { ...await musicManifest(musicDirectory), runId: status.runId, retrievals: status.tracks });
      }
      const liveTrack = url.pathname.match(/^\/live\/([\w-]{11})\.webm$/);
      if (liveTrack) {
        if (!cases.playbackIds.includes(liveTrack[1])) return json(404, { error: 'Not a fixed test track.' });
        if (!live) return json(503, { error: 'Live music is not enabled.' });
        return await live.serve(liveTrack[1], req, res);
      }
      if (url.pathname === '/api/music') {
        if (!musicDirectory) return json(503, { error: 'Prepared music is not available. Run the local preparation command first.' });
        return json(200, await musicManifest(musicDirectory));
      }
      const audio = url.pathname.match(/^\/audio\/([0-2])\.wav$/);
      const music = url.pathname.match(/^\/music\/([\w-]{11})\.webm$/);
      if (audio || music) {
        let data, mime;
        if (audio) { data = tones[Number(audio[1])]; mime = 'audio/wav'; }
        else {
          if (!cases.playbackIds.includes(music[1])) return json(404, { error: 'Not a fixed test track.' });
          if (!musicDirectory) return json(503, { error: 'Prepared music is not available.' });
          const manifest = await musicManifest(musicDirectory);
          const track = manifest.tracks.find(track => track.id === music[1]);
          // ponytail: fixed small test files; use streaming reads if the catalog grows.
          if ((await stat(join(musicDirectory, `${track.id}.webm`))).size !== track.bytes) throw new Error('Unexpected prepared file size');
          data = await readFile(join(musicDirectory, `${track.id}.webm`));
          if (data.length !== track.bytes || createHash('sha256').update(data).digest('hex') !== track.sha256) throw new Error('Corrupt prepared music');
          mime = track.mime;
        }
        let start = 0, end = data.length - 1, status = 200;
        if (req.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          start = match ? Number(match[1]) : NaN;
          end = match?.[2] ? Math.min(Number(match[2]), end) : end;
          if (!Number.isSafeInteger(start) || start > end || start >= data.length) {
            res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); return res.end();
          }
          status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
        }
        res.writeHead(status, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        return res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
      }
      if (files[url.pathname]) {
        const [name, mime] = files[url.pathname];
        const data = await readFile(new URL(`./public/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Content-Length': data.length });
        return res.end(req.method === 'HEAD' ? undefined : data);
      }
      json(404, { error: 'Not found.' });
    } catch {
      if (res.headersSent) { res.destroy(); return; }
      for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) res.removeHeader(name);
      // Never expose upstream bodies: they can contain session or signed-media data.
      json(502, { error: 'Experiment request failed. Check local setup or upstream availability. This is a failed check, not an empty result.' });
    }
  });
  server.on('close', () => live?.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8493);
  createServer().listen(port, '127.0.0.1', () => console.log(`Coda experiment: http://127.0.0.1:${port}`));
}
