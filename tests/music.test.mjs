import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTrack } from '../scripts/prepare-music.mjs';

function bytes(values) {
  return new ReadableStream({ start(controller) {
    for (const value of values) controller.enqueue(Uint8Array.of(value));
    controller.close();
  } });
}

test('complete-track capture reads beyond the sample limit and matches the advertised size', async () => {
  assert.deepEqual(await collectTrack(bytes([1, 2, 3, 4, 5]), AbortSignal.timeout(1000), 5), Buffer.from([1, 2, 3, 4, 5]));
});

test('partial and excessive tracks are rejected rather than published as complete', async () => {
  await assert.rejects(collectTrack(bytes([1, 2]), AbortSignal.timeout(1000), 3), /Incomplete/);
  await assert.rejects(collectTrack(bytes([1, 2, 3, 4]), AbortSignal.timeout(1000), 3), /excess/);
});

test('advertised bytes without EOF still require completion and release the reader on abort', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({
    start(source) { source.enqueue(Uint8Array.of(1, 2, 3)); },
    cancel() { cancelled = true; },
  });
  const capture = collectTrack(stream, controller.signal, 3);
  setImmediate(() => controller.abort());
  await assert.rejects(capture, { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('unbounded or oversized advertised tracks are rejected before reading', async () => {
  for (const size of [undefined, NaN, 0, -1, Infinity, 16 * 1024 * 1024 + 1]) {
    await assert.rejects(collectTrack(bytes([1]), AbortSignal.timeout(1000), size), /size/);
  }
});
