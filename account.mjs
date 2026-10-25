import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runWorker(python, authFile, testJournal, request) {
  return new Promise((resolve, reject) => {
    const script = request.operation === 'playlist-test' ? './scripts/account_write.py' : './scripts/account_read.py';
    const child = execFile(python, [fileURLToPath(new URL(script, import.meta.url))], {
      env: { ...process.env, CODA_ACCOUNT_AUTH: authFile, CODA_ACCOUNT_TEST_JOURNAL: testJournal ?? '' }, timeout: 15000, maxBuffer: 512 * 1024,
    }, (error, stdout) => {
      if (error && error.code !== 1) return reject(error);
      try {
        const result = JSON.parse(stdout);
        if (result.ok === false) {
          const code = ['ACCOUNT_REAUTH_REQUIRED', 'ACCOUNT_SETUP_REQUIRED'].includes(result.code) ? result.code : undefined;
          throw Object.assign(new Error('Account worker failed'), { code });
        }
        if (error) throw error;
        if (result.ok !== true || !result.data || typeof result.data !== 'object') throw new Error('Account worker failed');
        resolve(result.data);
      } catch (error) { reject(error); }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(request));
  });
}

// Serve identity is trusted only behind the loopback Tailscale proxy; local processes are trusted.
export function ownerAuthorized(req, owner) {
  const site = req.headers['sec-fetch-site'];
  return Boolean(owner) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
    req.headers['tailscale-user-login'] === owner && (!site || ['same-origin', 'none'].includes(site)) &&
    (!req.headers.origin || req.headers.origin === `https://${req.headers.host}`);
}

export function createAccountReader({ owner = process.env.CODA_ACCOUNT_OWNER,
  authFile = process.env.CODA_ACCOUNT_AUTH, python = process.env.CODA_ACCOUNT_PYTHON,
  testJournal = process.env.CODA_ACCOUNT_TEST_JOURNAL,
  execute = request => runWorker(python, authFile, testJournal, request) } = {}) {
  let busy = false; // ponytail: one bounded read at a time; use a persistent worker if startup becomes costly.
  return async (req, url) => {
    if (!owner || !authFile || !python) return { status: 503, body: { code: 'ACCOUNT_NOT_CONFIGURED', error: 'Account library is not configured.' } };
    if (!ownerAuthorized(req, owner)) {
      return { status: 403, body: { code: 'ACCOUNT_OWNER_REQUIRED', error: 'Account access requires the owner’s private Tailscale link.' } };
    }
    let request;
    const writing = url.pathname === '/api/account/playlist-test';
    if (writing) {
      if (req.method !== 'POST') return { status: 405, body: { error: 'POST required for the playlist test.' } };
      if (req.headers.origin !== `https://${req.headers.host}`) return { status: 403, body: { error: 'The playlist test requires the private HTTPS page.' } };
      if (!testJournal) return { status: 503, body: { error: 'The one-time playlist test is not enabled.' } };
      if (url.search || req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return { status: 400, body: { error: 'The playlist test accepts no parameters or body.' } };
      request = { operation: 'playlist-test' };
    } else if (url.pathname === '/api/account/status') request = { operation: 'status' };
    else if (url.pathname === '/api/account/playlists') request = { operation: 'library' };
    else if (url.pathname === '/api/account/playlist') {
      const id = url.searchParams.get('id');
      if (!id || !/^(LM|(?:PL|RD|OL)[A-Za-z0-9_-]{5,120})$/.test(id)) return { status: 400, body: { error: 'Enter a supported playlist ID.' } };
      request = { operation: 'playlist', id };
    } else return { status: 404, body: { error: 'Account route not found.' } };
    if (busy) return { status: 503, body: { code: 'ACCOUNT_BUSY', error: 'An account read is already running. Retry shortly.' } };
    busy = true;
    try { return { status: 200, body: await execute(request) }; }
    catch (error) {
      if (writing) return { status: 502, body: { error: 'Playlist test outcome is unconfirmed. Inspect the disposable playlist and local journal before any further writes.' } };
      if (error.code === 'ACCOUNT_REAUTH_REQUIRED') return { status: 401, body: { code: error.code, error: 'The saved YouTube Music session is no longer accepted. Reconnect locally, then check again.' } };
      if (error.code === 'ACCOUNT_SETUP_REQUIRED') return { status: 503, body: { code: error.code, error: 'Account setup needs attention. Check the private auth file and its permissions locally.' } };
      return { status: 502, body: { code: 'ACCOUNT_UNAVAILABLE', error: 'Account read failed. Check local setup or upstream availability; connection could not be verified.' } };
    }
    finally { busy = false; }
  };
}
