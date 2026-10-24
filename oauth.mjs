import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { ownerAuthorized } from './account.mjs';

const scope = 'https://www.googleapis.com/auth/youtube.readonly';
const root = fileURLToPath(new URL('.', import.meta.url));
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function privatePath(path) {
  const actual = await realpath(path), info = await stat(actual), fromRoot = relative(root, actual);
  if ((!fromRoot.startsWith('../') && !isAbsolute(fromRoot)) || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Private file required');
  return info;
}
async function privateJson(path) {
  const info = await privatePath(path);
  if (!info.isFile() || info.size > 65536) throw new Error('Invalid private file');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function store(path, token) {
  if (!(await privatePath(dirname(path))).isDirectory()) throw new Error('Private directory required');
  const temp = path + '.' + randomBytes(12).toString('hex');
  try {
    await writeFile(temp, JSON.stringify(token), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
function tokenData(data, client, previous = {}) {
  const granted = data.scope ?? previous.scope;
  if (typeof data.access_token !== 'string' || !data.access_token || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 ||
      (data.token_type ?? previous.token_type) !== 'Bearer' || !granted?.split(' ').includes(scope) || !(data.refresh_token ?? previous.refresh_token)) throw new Error('Invalid token');
  return { client_id: client.client_id, access_token: data.access_token, refresh_token: data.refresh_token ?? previous.refresh_token,
    token_type: 'Bearer', scope: granted, expires_in: data.expires_in, expires_at: Date.now() + data.expires_in * 1000 };
}
function runProbe(python, token) {
  return new Promise((resolve, reject) => {
    const child = execFile(python, [fileURLToPath(new URL('./scripts/oauth_probe.py', import.meta.url))], { timeout: 20000, maxBuffer: 16384 }, (error, stdout) => {
      if (error) return reject(new Error('OAuth read probe failed'));
      try {
        const data = JSON.parse(stdout);
        if (!['dataApiPrivatePlaylist', 'privatePlaylist', 'expectedOrder'].every(key => typeof data[key] === 'boolean')) throw new Error('Invalid probe');
        resolve({ dataApiPrivatePlaylist: data.dataApiPrivatePlaylist, privatePlaylist: data.privatePlaylist, expectedOrder: data.expectedOrder });
      } catch { reject(new Error('OAuth read probe failed')); }
    });
    child.stdin.on('error', reject); child.stdin.end(JSON.stringify({ accessToken: token }));
  });
}

export function createOAuthExperiment({ owner = process.env.CODA_ACCOUNT_OWNER,
  clientFile = join(homedir(), '.config/coda/oauth-client.json'), tokenFile = join(homedir(), '.config/coda/oauth-web-test.json'),
  python = process.env.CODA_ACCOUNT_PYTHON, fetchImpl = fetch, probe = token => runProbe(python, token) } = {}) {
  let pending = null, busy = false; // ponytail: one owner and one login attempt; persistent sessions only if multi-user support is added.
  async function exchange(client, fields, previous) {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, ...fields }) });
    if (!response.ok) throw new Error('Google authorization failed');
    return tokenData(await response.json(), client, previous);
  }
  async function validToken(client, token) {
    if (token.client_id !== client.client_id) throw new Error('Client changed');
    if (token.expires_at > Date.now() + 60000) return token;
    const fresh = await exchange(client, { grant_type: 'refresh_token', refresh_token: token.refresh_token }, token);
    await store(tokenFile, fresh); return fresh;
  }
  return async (req, url) => {
    const headers = { 'Referrer-Policy': 'no-referrer' };
    const result = (status, body, extra = {}) => ({ status, body, headers: { ...headers, ...extra } });
    const callback = url.pathname === '/api/account/oauth/callback';
    // Google returns through a cross-site top-level GET; state + a Lax browser cookie bind that callback.
    const identity = owner && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && req.headers['tailscale-user-login'] === owner;
    if (callback ? !identity : !ownerAuthorized(req, owner)) return result(403, { error: 'OAuth requires the owner’s private Tailscale link.' });
    if (callback ? req.method !== 'GET' : req.method !== 'POST') return result(405, { error: 'Unsupported OAuth method.' });
    if (!callback && (req.headers.origin !== `https://${req.headers.host}`)) return result(403, { error: 'Start OAuth from the private HTTPS page.' });
    if (!callback && (url.search || req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))) return result(400, { error: 'OAuth actions accept no parameters or body.' });
    if (!['/api/account/oauth/connect', '/api/account/oauth/probe', '/api/account/oauth/callback'].includes(url.pathname)) return result(404, { error: 'OAuth route not found.' });
    if (busy) return result(409, { error: 'An OAuth action is running. Wait for it to finish.' });
    const redirectUri = `https://${req.headers.host}/api/account/oauth/callback`;
    const cookie = 'Coda-OAuth-State';
    if (callback) {
      const state = url.searchParams.getAll('state'), code = url.searchParams.getAll('code');
      const cookies = (req.headers.cookie ?? '').split(';').map(value => value.trim());
      if (!pending || Date.now() > pending.deadline || pending.redirectUri !== redirectUri || state.length !== 1 || !equal(state[0], pending.state) ||
          !cookies.includes(`${cookie}=${pending.state}`) || (code.length !== 1 && !url.searchParams.has('error'))) return result(400, { error: 'Login attempt invalid or expired. Start Connect Google again.' });
      const attempt = pending; pending = null; busy = true;
      const clear = { 'Set-Cookie': `${cookie}=; Path=/api/account/oauth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax` };
      try {
        if (url.searchParams.has('error') || !code[0] || code[0].length > 8192) throw new Error('Authorization not granted');
        const token = await exchange(attempt.client, { grant_type: 'authorization_code', code: code[0], redirect_uri: redirectUri, code_verifier: attempt.verifier });
        await store(tokenFile, token);
        return result(303, {}, { ...clear, Location: '/?oauth=connected' });
      } catch { return result(303, {}, { ...clear, Location: '/?oauth=failed' }); }
      finally { busy = false; }
    }
    busy = true;
    try {
      const client = (await privateJson(clientFile)).web;
      if (!client?.client_id || !client?.client_secret || !client.redirect_uris?.includes(redirectUri)) throw new Error('Web client configuration required');
      if (clientFile === tokenFile) throw new Error('Separate files required');
      if (url.pathname.endsWith('/connect')) {
        const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
        pending = { state, verifier, client, redirectUri, deadline: Date.now() + 600000 };
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', scope,
          access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        return result(200, { authorizationUrl: auth.href }, { 'Set-Cookie': `${cookie}=${state}; Path=/api/account/oauth/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax` });
      }
      const token = await validToken(client, await privateJson(tokenFile));
      const before = await probe(token.access_token);
      // Exercise the same renewal branch without changing the stored expiry or waiting an hour.
      const renewed = await validToken(client, { ...token, expires_at: 0 });
      const after = await probe(renewed.access_token);
      return result(200, { before, renewal: true, after });
    } catch { return result(503, { error: 'OAuth check unavailable. Verify the private Web client JSON, redirect URI and saved authorization, then try again. No library connection was changed.' }); }
    finally { busy = false; }
  };
}
