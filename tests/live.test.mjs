import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

const id = '4D7u5KF7SP8';
async function fixture(t, provider) {
  const server = createServer({ liveMusic: provider });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('live delivery exposes early bytes and shares an unfinished download with a seek', async t => {
  let source, calls = 0;
  const base = await fixture(t, async () => {
    calls++;
    return { bytes: 6, stream: new ReadableStream({ start(controller) { source = controller; source.enqueue(Uint8Array.of(1, 2)); } }) };
  });
  const response = await fetch(`${base}/live/${id}.webm`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1, 2]);
  const range = fetch(`${base}/live/${id}.webm`, { headers: { Range: 'bytes=4-5' } });
  source.enqueue(Uint8Array.of(3, 4, 5, 6)); source.close();
  const seek = await range;
  assert.equal(seek.status, 206);
  assert.equal(seek.headers.get('content-range'), 'bytes 4-5/6');
  assert.deepEqual([...new Uint8Array(await seek.arrayBuffer())], [5, 6]);
  const rest = [];
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest.push(...chunk.value); }
  assert.deepEqual(rest, [3, 4, 5, 6]);
  assert.equal(calls, 1);
});

test('failed live retrieval never substitutes cached files or claims completion', async t => {
  let source;
  const base = await fixture(t, async () => ({ bytes: 6, stream: new ReadableStream({ start(controller) { source = controller; source.enqueue(Uint8Array.of(1, 2)); } }) }));
  const response = await fetch(`${base}/live/${id}.webm`);
  const reader = response.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1, 2]);
  source.close();
  await assert.rejects(reader.read());
  const status = await (await fetch(base + '/api/live/status')).json();
  assert.equal(status.tracks[0].completedAt, null);
  assert.equal(status.tracks[0].failure, 'MediaFailed');
  assert.equal((await fetch(`${base}/live/${id}.webm`)).status, 502);
});

test('live routes are opt-in, fixed-ID only and read-only', async t => {
  let calls = 0;
  const base = await fixture(t, async () => { calls++; throw new Error('Must not open'); });
  assert.equal((await fetch(base + '/live/aaaaaaaaaaa.webm')).status, 404);
  assert.equal((await fetch(`${base}/live/${id}.webm`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/live/${id}.webm`, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal(calls, 0);
  const disabled = await fixture(t);
  assert.equal((await fetch(`${disabled}/live/${id}.webm`)).status, 503);
  assert.equal((await fetch(disabled + '/api/live')).status, 503);
});

test('an upstream error signal prevents a complete result even when byte length matches', async t => {
  const base = await fixture(t, async () => ({ bytes: 3, hasError: () => true,
    stream: new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3)); controller.close(); } }) }));
  await fetch(`${base}/live/${id}.webm`).then(response => response.arrayBuffer()).catch(() => {});
  const status = await (await fetch(base + '/api/live/status')).json();
  assert.equal(status.tracks[0].completedAt, null);
  assert.equal(status.tracks[0].failure, 'MediaFailed');
});

test('closing live delivery interrupts pending source setup', async () => {
  const { createLiveMusic } = await import('../live-music.mjs');
  const { EventEmitter } = await import('node:events');
  const live = createLiveMusic(() => new Promise(() => {}));
  const pending = live.serve(id, { headers: {}, method: 'GET' }, new EventEmitter());
  live.close();
  await Promise.race([assert.rejects(pending), new Promise((_, reject) => setImmediate(() => reject(new Error('Setup still pending after close'))))]);
});

test('failure before the first media byte returns a readable sanitized error', async t => {
  const base = await fixture(t, async () => ({ bytes: 3, stream: new ReadableStream({ start(controller) { controller.error(new Error('private upstream detail')); } }) }));
  const response = await fetch(`${base}/live/${id}.webm`);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('content-length'), null);
  assert.ok((await response.json()).error);
});

test('the final media byte waits for verified EOF', async t => {
  let source;
  const base = await fixture(t, async () => ({ bytes: 3, stream: new ReadableStream({ start(controller) { source = controller; controller.enqueue(Uint8Array.of(1, 2, 3)); } }) }));
  const response = await fetch(`${base}/live/${id}.webm`);
  const reader = response.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1, 2]);
  const status = await (await fetch(base + '/api/live/status')).json();
  assert.equal(status.tracks[0].completedAt, null);
  source.close();
  assert.deepEqual([...(await reader.read()).value], [3]);
  assert.equal((await reader.read()).done, true);
});

test('live status distinguishes HTTP arrival, first write and completed response', async t => {
  let source;
  const base = await fixture(t, async () => ({ bytes: 3, stream: new ReadableStream({ start(controller) { source = controller; controller.enqueue(Uint8Array.of(1)); } }) }));
  const response = await fetch(`${base}/live/${id}.webm`);
  const reader = response.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1]);
  let job = (await (await fetch(base + '/api/live/status')).json()).tracks[0];
  assert.ok(Array.isArray(job.httpRequests));
  assert.equal(job.httpRequests.length, 1);
  const pending = job.httpRequests[0];
  assert.equal(pending.method, 'GET');
  assert.ok(pending.receivedAt);
  assert.ok(pending.firstWriteAt);
  assert.equal(pending.writtenBytes, 1);
  assert.equal(pending.finishedAt, null);
  source.enqueue(Uint8Array.of(2, 3)); source.close();
  while (!(await reader.read()).done) {}
  job = (await (await fetch(base + '/api/live/status')).json()).tracks[0];
  assert.equal(job.httpRequests[0].writtenBytes, 3);
  assert.ok(job.httpRequests[0].finishedAt);
  assert.equal(job.httpRequests[0].statusCode, 200);
  assert.equal(job.httpRequestsTruncated, false);
  for (let i = 0; i < 21; i++) await (await fetch(`${base}/live/${id}.webm`, { headers: { Range: 'bytes=1-2' } })).arrayBuffer();
  job = (await (await fetch(base + '/api/live/status')).json()).tracks[0];
  assert.equal(job.httpRequests.length, 20);
  assert.equal(job.httpRequestsTruncated, true);
  assert.equal(job.requests, 22);
  assert.equal(job.httpRequests.at(-1).statusCode, 206);
  assert.equal(job.httpRequests.at(-1).rangeStart, 1);
});

test('a disconnected reader releases its pending response while source setup continues independently', async () => {
  const { createLiveMusic } = await import('../live-music.mjs');
  const { EventEmitter } = await import('node:events');
  const live = createLiveMusic(() => new Promise(() => {}));
  const response = new EventEmitter();
  try {
    const pending = live.serve(id, { headers: {}, method: 'GET' }, response);
    response.emit('close');
    await Promise.race([assert.rejects(pending), new Promise((_, reject) => setImmediate(() => reject(new Error('Closed reader is still counted as active while source opens'))))]);
  } finally { live.close(); }
});
