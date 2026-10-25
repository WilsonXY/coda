import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

const owner = 'owner@example.test',
  id = 'abcdefghijk';
async function fixture(t, provider) {
  const server = createServer({
    liveMusic: provider,
    accountOptions: { owner },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const headers = { 'Tailscale-User-Login': owner };
test('catalog audio requires owner identity before opening arbitrary valid track IDs', async (t) => {
  let calls = 0;
  const base = await fixture(t, async (selected) => {
    calls++;
    assert.equal(selected, id);
    return {
      bytes: 3,
      stream: new ReadableStream({
        start(c) {
          c.enqueue(Uint8Array.of(1, 2, 3));
          c.close();
        },
      }),
    };
  });
  assert.equal((await fetch(`${base}/catalog/${id}.webm`)).status, 403);
  assert.equal(
    (
      await fetch(`${base}/catalog/${id}.webm`, {
        headers: { 'Tailscale-User-Login': 'wrong@example.test' },
      })
    ).status,
    403,
  );
  assert.equal(calls, 0);
  const r = await fetch(`${base}/catalog/${id}.webm`, { headers });
  assert.equal(r.status, 200);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
  assert.equal(calls, 1);
  assert.equal(
    (await fetch(`${base}/catalog/${id}.webm`, { method: 'POST', headers }))
      .status,
    405,
  );
  assert.equal(
    (await fetch(`${base}/catalog/invalid.webm`, { headers })).status,
    404,
  );
  const publicStatus = await (await fetch(base + '/api/live/status')).json();
  assert.equal(
    publicStatus.tracks.length,
    0,
    'Private catalog IDs are excluded from public sample diagnostics',
  );
});

test('catalog cache evicts unused captures so more than three selections can play', async (t) => {
  const calls = [];
  const base = await fixture(t, async (id) => {
    calls.push(id);
    return {
      bytes: 3,
      stream: new ReadableStream({
        start(c) {
          c.enqueue(Uint8Array.of(1, 2, 3));
          c.close();
        },
      }),
    };
  });
  const ids = [
    'aaaaaaaaaaa',
    'bbbbbbbbbbb',
    'ccccccccccc',
    'ddddddddddd',
    'aaaaaaaaaaa',
  ];
  for (const next of ids) {
    const r = await fetch(`${base}/catalog/${next}.webm`, { headers });
    assert.equal(r.status, 200);
    await r.arrayBuffer();
  }
  assert.deepEqual(
    calls,
    ids,
    'The evicted first capture must be fetched again',
  );
});

test('an occupied cache keeps active readers intact and rejects another capture until a slot frees', async (t) => {
  const inputs = new Map(),
    calls = [];
  const base = await fixture(t, async (id) => {
    calls.push(id);
    return {
      bytes: 3,
      stream: new ReadableStream({
        start(c) {
          inputs.set(id, c);
          c.enqueue(Uint8Array.of(1, 2));
        },
      }),
    };
  });
  const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
  const responses = [];
  for (const next of ids)
    responses.push(await fetch(`${base}/catalog/${next}.webm`, { headers }));
  assert.equal(
    (await fetch(`${base}/catalog/ddddddddddd.webm`, { headers })).status,
    502,
  );
  assert.deepEqual(calls, ids);
  for (let i = 0; i < ids.length; i++) {
    inputs.get(ids[i]).enqueue(Uint8Array.of(3));
    inputs.get(ids[i]).close();
    assert.equal((await responses[i].arrayBuffer()).byteLength, 3);
  }
  const fourth = await fetch(`${base}/catalog/ddddddddddd.webm`, { headers });
  inputs.get('ddddddddddd').enqueue(Uint8Array.of(3));
  inputs.get('ddddddddddd').close();
  await fourth.arrayBuffer();
  assert.equal(calls.length, 4);
});
