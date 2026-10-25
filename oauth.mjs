import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  readFile,
  realpath,
  stat,
  writeFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { ownerAuthorized } from './account.mjs';
import { editable, snapshot, editPlan, readDraft } from './playlist-edit.mjs';

const scope = 'https://www.googleapis.com/auth/youtube.readonly';
const musicScope = 'https://www.googleapis.com/auth/youtube';
const playlistId = /^(PL|OL)[A-Za-z0-9_-]{5,120}$/;
const clip = (value, fallback = '') =>
  typeof value === 'string' ? value.slice(0, 200) : fallback;
const root = fileURLToPath(new URL('.', import.meta.url));
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function privatePath(path) {
  const actual = await realpath(path),
    info = await stat(actual),
    fromRoot = relative(root, actual);
  if (
    (!fromRoot.startsWith('../') && !isAbsolute(fromRoot)) ||
    info.mode & 0o077 ||
    info.uid !== process.getuid()
  )
    throw new Error('Private file required');
  return info;
}
async function privateJson(path) {
  const info = await privatePath(path);
  if (!info.isFile() || info.size > 65536)
    throw new Error('Invalid private file');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function store(path, token) {
  if (!(await privatePath(dirname(path))).isDirectory())
    throw new Error('Private directory required');
  const temp = path + '.' + randomBytes(12).toString('hex');
  try {
    await writeFile(temp, JSON.stringify(token), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
function tokenData(data, client, previous = {}, requestedScope = scope) {
  const granted = data.scope ?? previous.scope;
  if (
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    !Number.isSafeInteger(data.expires_in) ||
    data.expires_in <= 0 ||
    (data.token_type ?? previous.token_type) !== 'Bearer' ||
    ![scope, musicScope].includes(requestedScope) ||
    !granted?.split(' ').includes(requestedScope) ||
    !(data.refresh_token ?? previous.refresh_token)
  )
    throw new Error('Invalid token');
  return {
    client_id: client.client_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? previous.refresh_token,
    token_type: 'Bearer',
    scope: granted,
    requested_scope: requestedScope,
    expires_in: data.expires_in,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}
function runProbe(python, token) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      [fileURLToPath(new URL('./scripts/oauth_probe.py', import.meta.url))],
      { timeout: 20000, maxBuffer: 16384 },
      (error, stdout) => {
        if (error) return reject(new Error('OAuth read probe failed'));
        try {
          const data = JSON.parse(stdout);
          if (
            ![
              'dataApiPrivatePlaylist',
              'privatePlaylist',
              'expectedOrder',
            ].every((key) => typeof data[key] === 'boolean')
          )
            throw new Error('Invalid probe');
          resolve({
            dataApiPrivatePlaylist: data.dataApiPrivatePlaylist,
            privatePlaylist: data.privatePlaylist,
            expectedOrder: data.expectedOrder,
          });
        } catch {
          reject(new Error('OAuth read probe failed'));
        }
      },
    );
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ accessToken: token }));
  });
}

export function createOAuthExperiment({
  owner = process.env.CODA_ACCOUNT_OWNER,
  clientFile = join(homedir(), '.config/coda/oauth-client.json'),
  tokenFile = join(homedir(), '.config/coda/oauth-web-test.json'),
  python = process.env.CODA_ACCOUNT_PYTHON,
  fetchImpl = fetch,
  probe = (token) => runProbe(python, token),
} = {}) {
  // ponytail: one owner, one login attempt and one edit ticket; opening another playlist replaces the previous ticket.
  let pending = null,
    busy = false,
    edit = null;
  let ownedIds = new Set(),
    saveState = { state: 'idle' };
  async function exchange(
    client,
    fields,
    previous = {},
    requestedScope = previous.requested_scope ?? scope,
  ) {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        ...fields,
      }),
    });
    if (!response.ok) throw new Error('Google authorization failed');
    return tokenData(await response.json(), client, previous, requestedScope);
  }
  async function validToken(client, token) {
    if (token.client_id !== client.client_id) throw new Error('Client changed');
    if (token.expires_at > Date.now() + 60000) return token;
    const fresh = await exchange(
      client,
      { grant_type: 'refresh_token', refresh_token: token.refresh_token },
      token,
    );
    await store(tokenFile, fresh);
    return fresh;
  }
  async function googleRead(endpoint, params, token) {
    const response = await fetchImpl(
      'https://www.googleapis.com/youtube/v3/' +
        endpoint +
        '?' +
        new URLSearchParams(params),
      {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bearer ' + token.access_token },
      },
    );
    if (!response.ok) throw new Error('Google read failed');
    const data = await response.json();
    if (!Array.isArray(data.items))
      throw new Error('Unexpected Google response');
    return data;
  }
  async function playlists(url, token) {
    if (url.pathname.endsWith('/playlists')) {
      const data = await googleRead(
        'playlists',
        {
          part: 'snippet',
          mine: 'true',
          maxResults: '50',
          fields: 'items(id,snippet/title),nextPageToken',
        },
        token,
      );
      ownedIds = new Set(data.items.slice(0, 50).map((item) => item.id));
      return {
        items: data.items.slice(0, 50).map((item) => ({
          id:
            typeof item.id === 'string' && playlistId.test(item.id)
              ? item.id
              : null,
          title: clip(item.snippet?.title, 'Untitled playlist'),
        })),
        limit: 50,
        complete: !data.nextPageToken,
      };
    }
    const id = url.searchParams.get('id');
    const data = await googleRead(
      'playlists',
      {
        part: 'snippet,status,contentDetails',
        id,
        fields:
          'items(id,snippet/title,status/privacyStatus,contentDetails/itemCount)',
      },
      token,
    );
    const info = data.items[0];
    if (!info || info.id !== id) throw new Error('Playlist not available');
    const items = [];
    let next;
    for (let page = 0; page < 2; page++) {
      const tracks = await googleRead(
        'playlistItems',
        {
          part: 'snippet,contentDetails',
          playlistId: id,
          maxResults: '50',
          fields:
            'items(id,contentDetails/videoId,snippet(title,videoOwnerChannelTitle,position)),nextPageToken',
          ...(next ? { pageToken: next } : {}),
        },
        token,
      );
      for (const item of tracks.items.slice(0, 50)) {
        const video = item.contentDetails?.videoId;
        items.push({
          itemId: typeof item.id === 'string' ? item.id : null,
          id:
            typeof video === 'string' && /^[A-Za-z0-9_-]{11}$/.test(video)
              ? video
              : null,
          title: clip(item.snippet?.title, 'Unavailable track'),
          artists: clip(item.snippet?.videoOwnerChannelTitle),
        });
      }
      next = tracks.nextPageToken;
      if (!next) break;
    }
    const total =
      Number.isSafeInteger(info.contentDetails?.itemCount) &&
      info.contentDetails.itemCount >= 0
        ? info.contentDetails.itemCount
        : null;
    const privacy = info.status?.privacyStatus;
    return {
      id,
      title: clip(info.snippet?.title, 'Untitled playlist'),
      privacy: ['private', 'public', 'unlisted'].includes(privacy)
        ? privacy.toUpperCase()
        : 'UNKNOWN',
      items,
      total,
      limit: 100,
      complete: !next && total !== null && total === items.length,
    };
  }
  async function runSave(original, draft, operations, client, token, job) {
    let attempted = false;
    try {
      const current = await playlists(
        new URL(
          'https://coda.invalid/api/account/oauth/playlist?id=' + original.id,
        ),
        token,
      );
      if (
        !current.complete ||
        snapshot(current.items) !== snapshot(original.items)
      ) {
        Object.assign(job, {
          state: 'conflict',
          code: 'ACCOUNT_EDIT_CONFLICT',
          error:
            'The playlist changed on YouTube. Reload it before editing; no changes were sent.',
        });
        return;
      }
      job.phase = 'saving';
      for (const operation of operations) {
        token = await validToken(client, token);
        const params =
          operation.method === 'DELETE'
            ? { id: operation.item.itemId }
            : { part: 'snippet', fields: 'id' };
        const body =
          operation.method === 'DELETE'
            ? undefined
            : JSON.stringify({
                ...(operation.method === 'PUT'
                  ? { id: operation.item.itemId }
                  : {}),
                snippet: {
                  playlistId: original.id,
                  position: operation.position,
                  resourceId: {
                    kind: 'youtube#video',
                    videoId: operation.item.id,
                  },
                },
              });
        attempted = true;
        const response = await fetchImpl(
          'https://www.googleapis.com/youtube/v3/playlistItems?' +
            new URLSearchParams(params),
          {
            method: operation.method,
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: {
              Authorization: 'Bearer ' + token.access_token,
              'Content-Type': 'application/json',
            },
            ...(body ? { body } : {}),
          },
        );
        const acknowledged = response.ok;
        if (acknowledged) job.completed++;
        await response.body?.cancel();
        if (!acknowledged) throw new Error('Write unconfirmed');
      }
      job.phase = 'verifying';
      token = await validToken(client, token);
      const after = await playlists(
        new URL(
          'https://coda.invalid/api/account/oauth/playlist?id=' + original.id,
        ),
        token,
      );
      if (
        !after.complete ||
        after.items.length !== draft.items.length ||
        after.items.some(
          (item, i) =>
            item.id !== draft.items[i].id ||
            (draft.items[i].itemId !== null &&
              item.itemId !== draft.items[i].itemId),
        )
      )
        throw new Error('Readback mismatch');

      job.state = 'saved';
    } catch {
      Object.assign(
        job,
        attempted
          ? {
              state: 'unconfirmed',
              code: 'ACCOUNT_SAVE_UNCONFIRMED',
              error:
                'Save outcome is unconfirmed; some changes may have reached YouTube. Reload and inspect the playlist before another edit. This draft cannot be retried.',
            }
          : {
              state: 'unavailable',
              code: 'ACCOUNT_SAVE_UNAVAILABLE',
              error:
                'Save stopped before any changes were sent. Reload the playlist before editing again.',
            },
      );
    } finally {
      busy = false;
    }
  }
  return async (req, url) => {
    const headers = { 'Referrer-Policy': 'no-referrer' };
    const result = (status, body, extra = {}) => ({
      status,
      body,
      headers: { ...headers, ...extra },
    });
    const callback = url.pathname === '/api/account/oauth/callback';
    const saving = url.pathname === '/api/account/oauth/save';
    const saveStatus = url.pathname === '/api/account/oauth/save-status';
    const reading = [
      '/api/account/oauth/playlists',
      '/api/account/oauth/playlist',
    ].includes(url.pathname);
    // Google returns through a cross-site top-level GET; state + a Lax browser cookie bind that callback.
    const identity =
      owner &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress,
      ) &&
      req.headers['tailscale-user-login'] === owner;
    if (callback ? !identity : !ownerAuthorized(req, owner))
      return result(403, {
        error: 'OAuth requires the owner’s private Tailscale link.',
      });
    if (
      callback || reading || saveStatus
        ? req.method !== 'GET'
        : req.method !== 'POST'
    )
      return result(405, { error: 'Unsupported OAuth method.' });
    if (
      !callback &&
      !reading &&
      !saveStatus &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      return result(403, { error: 'Start OAuth from the private HTTPS page.' });
    if (
      !callback &&
      !reading &&
      !saveStatus &&
      !saving &&
      (url.search ||
        req.headers['transfer-encoding'] ||
        (req.headers['content-length'] &&
          req.headers['content-length'] !== '0'))
    )
      return result(400, {
        error: 'OAuth actions accept no parameters or body.',
      });
    if (
      reading &&
      (req.headers['transfer-encoding'] ||
        (req.headers['content-length'] &&
          req.headers['content-length'] !== '0') ||
        (url.pathname.endsWith('/playlists')
          ? Boolean(url.search)
          : url.searchParams.size !== 1 ||
            !playlistId.test(url.searchParams.get('id') ?? '')))
    )
      return result(400, {
        error:
          'Enter one supported playlist ID, or load owned playlists without parameters.',
      });
    if (
      saving &&
      (url.search ||
        req.headers['content-type'] !== 'application/json' ||
        req.headers['content-encoding'] ||
        req.headers['transfer-encoding'] ||
        !/^\d+$/.test(req.headers['content-length'] ?? '') ||
        Number(req.headers['content-length']) > 32768)
    )
      return result(400, {
        error: 'Send one JSON playlist draft of at most 32 KiB.',
      });
    if (saveStatus) {
      if (
        url.search ||
        req.headers['transfer-encoding'] ||
        (req.headers['content-length'] && req.headers['content-length'] !== '0')
      )
        return result(400, {
          error: 'Save status accepts no parameters or body.',
        });
      return result(200, { ...saveState });
    }
    if (
      !reading &&
      !saving &&
      ![
        '/api/account/oauth/connect',
        '/api/account/oauth/connect-music',
        '/api/account/oauth/connect-edit',
        '/api/account/oauth/probe',
        '/api/account/oauth/callback',
      ].includes(url.pathname)
    )
      return result(404, { error: 'OAuth route not found.' });
    if (busy)
      return result(409, {
        error: 'An OAuth action is running. Wait for it to finish.',
      });
    const redirectUri = `https://${req.headers.host}/api/account/oauth/callback`;
    const cookie = 'Coda-OAuth-State';
    if (callback) {
      const state = url.searchParams.getAll('state'),
        code = url.searchParams.getAll('code');
      const cookies = (req.headers.cookie ?? '')
        .split(';')
        .map((value) => value.trim());
      if (
        !pending ||
        Date.now() > pending.deadline ||
        pending.redirectUri !== redirectUri ||
        state.length !== 1 ||
        !equal(state[0], pending.state) ||
        !cookies.includes(`${cookie}=${pending.state}`) ||
        (code.length !== 1 && !url.searchParams.has('error'))
      )
        return result(400, {
          error:
            'Login attempt invalid or expired. Start Connect Google again.',
        });
      const attempt = pending;
      pending = null;
      busy = true;
      const clear = {
        'Set-Cookie': `${cookie}=; Path=/api/account/oauth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      };
      try {
        if (url.searchParams.has('error') || !code[0] || code[0].length > 8192)
          throw new Error('Authorization not granted');
        const token = await exchange(
          attempt.client,
          {
            grant_type: 'authorization_code',
            code: code[0],
            redirect_uri: redirectUri,
            code_verifier: attempt.verifier,
          },
          {},
          attempt.requestedScope,
        );
        await store(tokenFile, token);
        edit = null;
        ownedIds.clear();
        return result(303, {}, { ...clear, Location: '/?oauth=connected' });
      } catch {
        return result(303, {}, { ...clear, Location: '/?oauth=failed' });
      } finally {
        busy = false;
      }
    }
    busy = true;
    let handedOff = false;
    try {
      const client = (await privateJson(clientFile)).web;
      if (
        !client?.client_id ||
        !client?.client_secret ||
        (!reading && !saving && !client.redirect_uris?.includes(redirectUri))
      )
        throw new Error('Web client configuration required');
      if (clientFile === tokenFile) throw new Error('Separate files required');
      if (
        [
          '/api/account/oauth/connect',
          '/api/account/oauth/connect-music',
          '/api/account/oauth/connect-edit',
        ].includes(url.pathname)
      ) {
        const requestedScope = url.pathname.endsWith('/connect')
          ? scope
          : musicScope;
        const state = randomBytes(32).toString('base64url'),
          verifier = randomBytes(32).toString('base64url');
        pending = {
          state,
          verifier,
          client,
          redirectUri,
          requestedScope,
          deadline: Date.now() + 600000,
        };
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: requestedScope,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
          code_challenge_method: 'S256',
        });
        return result(
          200,
          { authorizationUrl: auth.href },
          {
            'Set-Cookie': `${cookie}=${state}; Path=/api/account/oauth/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
          },
        );
      }
      const token = await validToken(client, await privateJson(tokenFile));
      if (reading) {
        const data = await playlists(url, token);
        if (url.pathname.endsWith('/playlist')) {
          edit = null;
          const canSave = token.scope?.split(' ').includes(musicScope);
          const supported =
            ownedIds.has(data.id) &&
            data.id.startsWith('PL') &&
            data.complete &&
            editable(data.items);
          data.edit = {
            canSave: Boolean(canSave && supported),
            reason: !supported
              ? 'Editing requires a complete owned playlist of at most 100 available songs.'
              : !canSave
                ? 'Enable Google playlist editing to allow saving.'
                : '',
          };
          if (data.edit.canSave) {
            edit = {
              ticket: randomBytes(24).toString('base64url'),
              id: data.id,
              items: data.items,
              refreshToken: token.refresh_token,
              deadline: Date.now() + 600000,
            };
            data.edit.ticket = edit.ticket;
          }
        }
        return result(200, data);
      }
      if (saving) {
        let draft, operations;
        try {
          draft = await readDraft(req);
        } catch {
          return result(400, { error: 'Invalid playlist draft.' });
        }
        if (
          !edit ||
          Date.now() > edit.deadline ||
          draft.id !== edit.id ||
          !equal(draft.ticket, edit.ticket) ||
          edit.refreshToken !== token.refresh_token
        )
          return result(409, {
            code: 'ACCOUNT_EDIT_EXPIRED',
            error:
              'This draft is expired or was already submitted. Reload the playlist before editing.',
          });
        if (!token.scope?.split(' ').includes(musicScope))
          return result(403, {
            code: 'ACCOUNT_EDIT_PERMISSION',
            error: 'Enable Google playlist editing before saving.',
          });
        try {
          operations = editPlan(edit.items, draft.items);
        } catch (error) {
          return result(400, {
            code: 'ACCOUNT_EDIT_INVALID',
            error: error.message,
          });
        }
        const original = edit;
        edit = null; // Single-use before the first upstream request; no automatic write retries, including after a restart.
        saveState = {
          id: randomBytes(16).toString('hex'),
          state: 'running',
          phase: 'checking',
          completed: 0,
          total: operations.length,
        };
        handedOff = true;
        void runSave(original, draft, operations, client, token, saveState);
        return result(202, { ...saveState });
      }
      const before = await probe(token.access_token);
      // Exercise the same renewal branch without changing the stored expiry or waiting an hour.
      const renewed = await validToken(client, { ...token, expires_at: 0 });
      const after = await probe(renewed.access_token);
      return result(200, { before, renewal: true, after });
    } catch {
      return reading
        ? result(503, {
            code: 'ACCOUNT_OAUTH_UNAVAILABLE',
            error:
              'Google playlist read failed. Check Google authorization or upstream availability, then try again.',
          })
        : result(503, {
            error:
              'OAuth check unavailable. Verify the private Web client JSON, redirect URI and saved authorization, then try again. No library connection was changed.',
          });
    } finally {
      if (!handedOff) busy = false;
    }
  };
}
