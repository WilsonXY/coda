import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import cases from '../scripts/cases.json' with { type: 'json' };

async function serve(t, options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('only intended public files are readable', async t => {
  const base = await serve(t);
  assert.equal((await fetch(base)).status, 200);
  for (const path of ['/package.json', '/.git/config', '/docs/investigation.md', '/%2e%2e/package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('prepared music is opt-in and serves only verified fixed tracks with seeking', async t => {
  assert.equal((await fetch(await serve(t) + '/api/music')).status, 503);
  const directory = await mkdtemp(join(tmpdir(), 'coda-music-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = Buffer.from('test media bytes');
  const tracks = cases.playbackIds.map(id => ({ id, title: 'Test', artist: 'Fixture', seconds: 20,
    bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), mime: 'audio/webm' }));
  for (const track of tracks) await writeFile(join(directory, `${track.id}.webm`), data);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 1, complete: true,
    preparedAt: new Date().toISOString(), tracks, secretField: 'must not be served' }));
  const base = await serve(t, { musicDirectory: directory });
  const catalog = await fetch(base + '/api/music');
  assert.equal(catalog.status, 200);
  const manifest = await catalog.json();
  assert.equal(manifest.tracks.length, 3);
  assert.equal('secretField' in manifest, false);
  const path = `/music/${tracks[0].id}.webm`;
  const range = await fetch(base + path, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-type'), 'audio/webm');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), data.subarray(2, 6));
  assert.equal((await fetch(base + '/music/aaaaaaaaaaa.webm')).status, 404);
  assert.equal((await fetch(base + '/manifest.json')).status, 404);
  await writeFile(join(directory, `${tracks[0].id}.webm`), Buffer.alloc(data.length));
  assert.equal((await fetch(base + path)).status, 502, 'corrupt cached bytes must not be served');
});

test('generated audio supports seeking through HTTP ranges', async t => {
  const base = await serve(t);
  const whole = await fetch(base + '/audio/0.wav');
  const bytes = Buffer.from(await whole.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  const range = await fetch(base + '/audio/0.wav', { headers: { Range: 'bytes=100-199' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 100-199/${bytes.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(100, 200));
  assert.equal((await fetch(base + '/audio/0.wav', { headers: { Range: 'bytes=99999999-' } })).status, 416);
});

test('cross-site requests and invalid queries cannot reach upstream', async t => {
  const base = await serve(t);
  assert.equal((await fetch(base + '/api/search?q=test', { headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await fetch(base, { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await fetch(base + '/api/search?q=')).status, 400);
  assert.equal((await fetch(base + '/api/playability?id=invalid')).status, 400);
  assert.equal((await fetch(base + '/api/playlist?id=')).status, 400);
  assert.equal((await fetch(base + '/api/search?q=test', { method: 'POST' })).status, 405);
});
