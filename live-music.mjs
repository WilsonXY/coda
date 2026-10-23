import { EventEmitter, once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';

// ponytail: three fixed tracks, at most 16 MiB each, retained until process restart.
// Add eviction and renewal only when testing a larger catalog.
export function createLiveMusic(open) {
  const jobs = new Map(), runId = randomUUID();
  function get(id) {
    if (jobs.has(id)) return jobs.get(id);
    const job = new EventEmitter();
    Object.assign(job, { id, requests: 0, received: 0, startedAt: new Date().toISOString(), controller: new AbortController() });
    jobs.set(id, job);
    let ready, reject;
    job.ready = new Promise((resolve, fail) => { ready = resolve; reject = fail; });
    job.ready.catch(() => {});
    const timer = setTimeout(() => job.controller.abort(), 90000);
    timer.unref();
    void (async () => {
      let input, reader, rejectSetup;
      const cancel = () => { rejectSetup?.(new Error('Source aborted')); void reader?.cancel().catch(() => {}); };
      job.controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        const opening = Promise.resolve().then(() => open(id, job.controller.signal));
        void opening.then(async late => {
          if (job.controller.signal.aborted) await late?.close?.();
        }).catch(() => {});
        input = await Promise.race([opening, new Promise((_, reject) => { rejectSetup = reject; })]);
        job.controller.signal.throwIfAborted();
        if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0 || input.bytes > 16 * 1024 * 1024) throw new Error('Invalid size');
        job.protectionStatuses = input.protectionStatuses ?? [];
        job.total = input.bytes; job.data = Buffer.alloc(input.bytes); ready();
        reader = input.stream.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          job.controller.signal.throwIfAborted();
          if (done) break;
          if (job.received + value.byteLength > job.total) throw new Error('Excess bytes');
          job.data.set(value, job.received); job.received += value.byteLength;
          if (value.byteLength) job.firstByteAt ??= new Date().toISOString();
          job.emit('progress');
        }
        if (job.received !== job.total || input.hasError?.()) throw new Error('Incomplete or failed media');
        job.sha256 = createHash('sha256').update(job.data).digest('hex');
        job.completedAt = new Date().toISOString();
      } catch {
        job.failure = job.controller.signal.aborted ? 'DeadlineExceeded' : 'MediaFailed';
        job.failedAt = new Date().toISOString(); reject(new Error('Live source failed'));
      } finally {
        clearTimeout(timer);
        job.controller.signal.removeEventListener('abort', cancel);
        await reader?.cancel().catch(() => {}); reader?.releaseLock();
        await Promise.resolve(input?.close?.()).catch(() => {});
        job.emit('progress');
      }
    })();
    return job;
  }
  return {
    status() {
      return { runId, tracks: [...jobs.values()].map(job => ({ id: job.id, requests: job.requests,
        receivedBytes: job.received, totalBytes: job.total ?? null, startedAt: job.startedAt,
        firstByteAt: job.firstByteAt ?? null, completedAt: job.completedAt ?? null,
        failedAt: job.failedAt ?? null, failure: job.failure ?? null, protectionStatuses: [...(job.protectionStatuses ?? [])], sha256: job.sha256 ?? null })) };
    },
    close() { for (const job of jobs.values()) job.controller.abort(); },
    async serve(id, req, res) {
      const disconnected = new AbortController();
      const closed = () => disconnected.abort();
      res.once('close', closed);
      try {
        const job = get(id); job.requests++;
        await job.ready;
        if (job.failure) throw new Error('Live source failed');
        let start = 0, end = job.total - 1, status = 200;
        if (req.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          start = match ? Number(match[1]) : NaN;
          end = match?.[2] ? Math.min(Number(match[2]), end) : end;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= job.total) {
            res.writeHead(416, { 'Content-Range': `bytes */${job.total}` }); return res.end();
          }
          status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${job.total}`);
        }
        res.statusCode = status;
        res.setHeader('Content-Type', 'audio/webm');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', end - start + 1);
        if (req.method === 'HEAD') return res.end();
        let offset = start;
        while (offset <= end) {
          disconnected.signal.throwIfAborted();
          if (job.failure) throw new Error('Live source failed');
          // Keep the final byte until EOF and exact length are verified.
          const available = Math.min(job.received - 1, job.completedAt ? end : Math.min(end, job.total - 2));
          if (offset <= available) {
            const drained = res.write(job.data.subarray(offset, available + 1)); offset = available + 1;
            if (!drained) await once(res, 'drain', { signal: disconnected.signal });
          } else await once(job, 'progress', { signal: disconnected.signal });
        }
        res.end();
      } finally { res.off('close', closed); }
    },
  };
}
