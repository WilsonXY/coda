import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

async function serve(t) {
  const server = createServer();
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
  assert.equal((await fetch(base + '/api/search?q=')).status, 400);
  assert.equal((await fetch(base + '/api/playability?id=invalid')).status, 400);
  assert.equal((await fetch(base + '/api/playlist?id=')).status, 400);
  assert.equal((await fetch(base + '/api/search?q=test', { method: 'POST' })).status, 405);
});
