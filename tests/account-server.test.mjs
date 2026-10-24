import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAccountReader } from '../account.mjs';

const owner = 'owner@example.test';
async function serve(t, accountOptions) {
  const server = createServer({ accountOptions });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('account reads require the configured owner proxy identity before upstream access', async t => {
  let calls = 0;
  const base = await serve(t, { owner, authFile: '/private/fixture.json', python: 'unused', execute: async request => {
    calls++;
    assert.deepEqual(request, { operation: 'library' });
    return { items: [{ id: 'PLfixture123', title: 'Private fixture' }], limit: 50 };
  } });
  const endpoint = base + '/api/account/playlists';
  assert.equal((await fetch(endpoint)).status, 403);
  assert.equal((await fetch(endpoint, { headers: { 'Tailscale-User-Login': 'someone-else@example.test' } })).status, 403);
  assert.equal((await fetch(endpoint, { headers: { 'Tailscale-User-Login': owner, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(endpoint, { headers: { 'Tailscale-User-Login': owner, Origin: 'http://elsewhere.example' } })).status, 403);
  assert.equal(calls, 0);
  const result = await fetch(endpoint, { headers: { 'Tailscale-User-Login': owner } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { items: [{ id: 'PLfixture123', title: 'Private fixture' }], limit: 50 });
  assert.equal(calls, 1);
});

test('one bounded account read runs at a time and the reader recovers after it finishes', async t => {
  let calls = 0, release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const base = await serve(t, { owner, authFile: '/private/fixture.json', python: 'unused', execute: async () => {
    calls++;
    if (calls === 1) { entered(); return pending; }
    return { items: [] };
  } });
  const options = { headers: { 'Tailscale-User-Login': owner } };
  const first = fetch(base + '/api/account/playlists', options);
  await ready;
  try {
    assert.equal((await fetch(base + '/api/account/playlists', options)).status, 503);
    assert.equal(calls, 1);
  } finally { release({ items: [] }); await first; }
  assert.equal((await fetch(base + '/api/account/playlists', options)).status, 200);
  assert.equal(calls, 2);
});

test('account mode is opt-in, rejects non-loopback peers and exposes only validated reads', async t => {
  const disabled = await serve(t, { owner: '', authFile: '', python: '' });
  assert.equal((await fetch(disabled + '/api/account/playlists')).status, 503);
  let calls = 0;
  const settings = { owner, authFile: '/private/fixture.json', python: 'unused', execute: async request => { calls++; return request; } };
  const reader = createAccountReader(settings);
  const remote = await reader({ socket: { remoteAddress: '100.100.1.2' }, headers: { 'tailscale-user-login': owner } }, new URL('http://localhost/api/account/playlists'));
  assert.equal(remote.status, 403); assert.equal(calls, 0);
  const base = await serve(t, settings), headers = { 'Tailscale-User-Login': owner };
  for (const id of ['', '../browser.json', 'https://example.test', 'PLshort;echo']) {
    assert.equal((await fetch(base + '/api/account/playlist?id=' + encodeURIComponent(id), { headers })).status, 400);
  }
  assert.equal((await fetch(base + '/api/account/delete', { headers })).status, 404);
  assert.equal((await fetch(base + '/api/account/playlists', { headers, method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/account/playlists', { headers, method: 'HEAD' })).status, 405);
  assert.equal(calls, 0);
  const playlist = await fetch(base + '/api/account/playlist?id=PLfixture123', { headers });
  assert.deepEqual(await playlist.json(), { operation: 'playlist', id: 'PLfixture123' });
  assert.equal(calls, 1);
});

test('upstream errors cannot expose credentials or raw exceptions', async t => {
  const base = await serve(t, { owner, authFile: '/private/fixture.json', python: 'unused', execute: async () => { throw new Error('synthetic-cookie-secret'); } });
  const result = await fetch(base + '/api/account/playlists', { headers: { 'Tailscale-User-Login': owner } });
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes('synthetic-cookie-secret'), false);
});

test('account backend runs a fixed worker using JSON input and private server configuration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'coda-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const python = join(directory, 'fixture.mjs');
  await writeFile(python, `#!${process.execPath}
let input = ''; for await (const part of process.stdin) input += part;
const request = JSON.parse(input);
if (process.env.CODA_ACCOUNT_AUTH !== '/private/fixture.json' || !process.argv[2].endsWith('/scripts/account_read.py')) process.exit(1);
if (request.operation !== 'library') process.exit(1);
console.log(JSON.stringify({ok:true,data:{items:[],limit:50,complete:false}}));
`, { mode: 0o700 });
  const base = await serve(t, { owner, authFile: '/private/fixture.json', python });
  const result = await fetch(base + '/api/account/playlists', { headers: { 'Tailscale-User-Login': owner } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { items: [], limit: 50, complete: false });
});
