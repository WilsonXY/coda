import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSample } from '../scripts/playback-probe.mjs';

test('sample capture caps retained bytes and cancels its upstream reader', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4, 5])); },
    cancel() { cancelled = true; },
  });
  const bytes = await collectSample(stream, AbortSignal.timeout(1000), 3);
  assert.deepEqual(bytes, Buffer.from([1, 2, 3]));
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('an aborted stalled sample fails and releases its reader', { timeout: 1000 }, async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const timer = setTimeout(() => controller.abort(), 25);
  try {
    await assert.rejects(collectSample(stream, controller.signal), { name: 'AbortError' });
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  } finally { clearTimeout(timer); }
});
