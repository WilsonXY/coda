import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
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

export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!hosts.has(url.hostname)) return json(403, { error: 'Host not allowed.' });
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(403, { error: 'Cross-site request rejected.' });
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
      const audio = url.pathname.match(/^\/audio\/([0-2])\.wav$/);
      if (audio) {
        const data = tones[Number(audio[1])];
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
        res.writeHead(status, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
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
      // Never expose upstream bodies: they can contain session or signed-media data.
      json(502, { error: 'Upstream request failed or timed out. This is a failed check, not an empty result. Try again once; inspect the library separately if it persists.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8493);
  createServer().listen(port, '127.0.0.1', () => console.log(`Coda experiment: http://127.0.0.1:${port}`));
}
