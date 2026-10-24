import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runWorker(python, authFile, request) {
  return new Promise((resolve, reject) => {
    const child = execFile(python, [fileURLToPath(new URL('./scripts/account_read.py', import.meta.url))], {
      env: { ...process.env, CODA_ACCOUNT_AUTH: authFile }, timeout: 15000, maxBuffer: 512 * 1024,
    }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const result = JSON.parse(stdout);
        if (result.ok !== true || !result.data || typeof result.data !== 'object') throw new Error('Account worker failed');
        resolve(result.data);
      } catch (error) { reject(error); }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(request));
  });
}

// Serve identity is trusted only behind the loopback Tailscale proxy; local processes are trusted.
export function createAccountReader({ owner = process.env.CODA_ACCOUNT_OWNER,
  authFile = process.env.CODA_ACCOUNT_AUTH, python = process.env.CODA_ACCOUNT_PYTHON,
  execute = request => runWorker(python, authFile, request) } = {}) {
  let busy = false; // ponytail: one bounded read at a time; use a persistent worker if startup becomes costly.
  return async (req, url) => {
    if (!owner || !authFile || !python) return { status: 503, body: { error: 'Account library is not configured.' } };
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const site = req.headers['sec-fetch-site'];
    if (!local || req.headers['tailscale-user-login'] !== owner ||
        (site && !['same-origin', 'none'].includes(site)) ||
        (req.headers.origin && req.headers.origin !== `https://${req.headers.host}`)) {
      return { status: 403, body: { error: 'Account access requires the owner’s private Tailscale link.' } };
    }
    let request;
    if (url.pathname === '/api/account/playlists') request = { operation: 'library' };
    else if (url.pathname === '/api/account/playlist') {
      const id = url.searchParams.get('id');
      if (!id || !/^(LM|(?:PL|RD|OL)[A-Za-z0-9_-]{5,120})$/.test(id)) return { status: 400, body: { error: 'Enter a supported playlist ID.' } };
      request = { operation: 'playlist', id };
    } else return { status: 404, body: { error: 'Account route not found.' } };
    if (busy) return { status: 503, body: { error: 'An account read is already running. Retry shortly.' } };
    busy = true;
    try { return { status: 200, body: await execute(request) }; }
    catch { return { status: 502, body: { error: 'Account read failed. Check the local session and upstream service; no library data was loaded.' } }; }
    finally { busy = false; }
  };
}
