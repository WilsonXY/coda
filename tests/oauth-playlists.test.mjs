import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

test('Google playlist reads renew OAuth, project owned lists and page tracks without browser credentials', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'coda-google-playlists-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clientFile = join(directory, 'client.json'),
    tokenFile = join(directory, 'token.json'),
    scope = 'https://www.googleapis.com/auth/youtube.readonly';
  await writeFile(
    clientFile,
    JSON.stringify({
      web: {
        client_id: 'fixture-client',
        client_secret: 'fixture-secret',
        redirect_uris: [],
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    tokenFile,
    JSON.stringify({
      client_id: 'fixture-client',
      access_token: 'expired',
      refresh_token: 'fixture-refresh',
      token_type: 'Bearer',
      scope,
      expires_at: 0,
    }),
    { mode: 0o600 },
  );
  let calls = 0,
    failed = false,
    renewals = 0,
    bounded = false,
    malformed = false,
    trackPages = 0;
  const server = createServer({
    accountOptions: {
      owner: 'owner@example.test',
      authFile: '/never-use/browser.json',
      python: 'unused',
      execute: () => {
        throw new Error('Legacy session must not be used');
      },
    },
    oauthOptions: {
      owner: 'owner@example.test',
      clientFile,
      tokenFile,
      fetchImpl: async (url, options) => {
        calls++;
        if (url === 'https://oauth2.googleapis.com/token') {
          renewals++;
          return Response.json({
            access_token: 'fresh-fixture',
            token_type: 'Bearer',
            scope,
            expires_in: 3600,
          });
        }
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.Authorization, 'Bearer fresh-fixture');
        assert.equal(options.headers.Cookie, undefined);
        const request = new URL(url);
        assert.equal(request.origin, 'https://www.googleapis.com');
        if (failed) throw new Error('private-upstream-secret');
        if (malformed)
          return Response.json({ unexpected: 'private-upstream-secret' });
        if (bounded) {
          if (request.pathname.endsWith('/playlists'))
            return Response.json({
              items: request.searchParams.has('mine')
                ? Array.from({ length: 60 }, () => ({
                    id: 'PLfixture123',
                    snippet: { title: 'x'.repeat(250) },
                  }))
                : [
                    {
                      id: 'PLfixture123',
                      snippet: { title: 'x'.repeat(250) },
                      status: { privacyStatus: 'unexpected' },
                      contentDetails: { itemCount: 999 },
                    },
                  ],
              nextPageToken: 'more',
            });
          trackPages++;
          return Response.json({
            items: Array.from({ length: 60 }, () => ({
              contentDetails: { videoId: 'aaaaaaaaaaa' },
              snippet: { title: 'x'.repeat(250) },
            })),
            nextPageToken: 'more',
          });
        }
        if (request.pathname.endsWith('/playlists'))
          return Response.json({
            items: request.searchParams.has('mine')
              ? [
                  {
                    id: 'PLfixture123',
                    snippet: { title: 'Fixture playlist' },
                    privateSecret: 'never-expose',
                  },
                ]
              : [
                  {
                    id: 'PLfixture123',
                    snippet: { title: 'Fixture playlist' },
                    status: { privacyStatus: 'private' },
                    contentDetails: { itemCount: 52 },
                  },
                ],
          });
        assert.equal(request.pathname, '/youtube/v3/playlistItems');
        assert.equal(request.searchParams.get('maxResults'), '50');
        return Response.json(
          request.searchParams.has('pageToken')
            ? {
                items: [
                  {
                    contentDetails: { videoId: 'bbbbbbbbbbb' },
                    snippet: {
                      title: 'Last track',
                      videoOwnerChannelTitle: 'Channel',
                    },
                  },
                  { contentDetails: {}, snippet: { title: 'Unavailable' } },
                ],
              }
            : {
                items: Array.from({ length: 50 }, (_, i) => ({
                  contentDetails: { videoId: 'aaaaaaaaaaa' },
                  snippet: {
                    title: 'Track ' + i,
                    videoOwnerChannelTitle: 'Channel',
                  },
                  privateSecret: 'never-expose',
                })),
                nextPageToken: 'fixture-next',
              },
        );
      },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port,
    prefix = base + '/api/account/oauth',
    headers = { 'Tailscale-User-Login': 'owner@example.test' };
  assert.equal((await fetch(prefix + '/playlists')).status, 403);
  assert.equal(
    (
      await fetch(prefix + '/playlists', {
        headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
      })
    ).status,
    403,
  );
  for (const path of [
    '/playlists?token=bad',
    '/playlist?id=LM',
    '/playlist?id=../secret',
    '/playlist?id=PLfixture123&id=PLother123',
    '/playlist?id=PLfixture123&scope=bad',
  ])
    assert.equal((await fetch(prefix + path, { headers })).status, 400);
  assert.equal(calls, 0, 'Rejected input never reaches Google or refresh');
  const list = await fetch(prefix + '/playlists', { headers });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await list.json(), {
    items: [{ id: 'PLfixture123', title: 'Fixture playlist' }],
    limit: 50,
    complete: true,
  });
  const playlist = await fetch(prefix + '/playlist?id=PLfixture123', {
    headers,
  });
  assert.equal(playlist.status, 200);
  const result = await playlist.json();
  assert.equal(result.privacy, 'PRIVATE');
  assert.equal(result.items.length, 52);
  assert.equal(result.complete, true);
  assert.equal(result.items[50].id, 'bbbbbbbbbbb');
  assert.equal(result.items[51].id, null);
  assert.equal(result.items[0].artists, 'Channel');
  assert.equal(JSON.stringify(result).includes('never-expose'), false);
  assert.equal(renewals, 1);
  assert.equal(
    JSON.parse(await readFile(tokenFile, 'utf8')).refresh_token,
    'fixture-refresh',
  );
  failed = true;
  const failure = await fetch(prefix + '/playlists', { headers });
  assert.equal(failure.status, 503);
  assert.equal(
    (await failure.text()).includes('private-upstream-secret'),
    false,
  );
  failed = false;
  bounded = true;
  const cappedList = await (
    await fetch(prefix + '/playlists', { headers })
  ).json();
  assert.equal(cappedList.items.length, 50);
  assert.equal(cappedList.items[0].title.length, 200);
  assert.equal(cappedList.complete, false);
  const cappedTracks = await (
    await fetch(prefix + '/playlist?id=PLfixture123', { headers })
  ).json();
  assert.equal(cappedTracks.items.length, 100);
  assert.equal(cappedTracks.items[0].title.length, 200);
  assert.equal(cappedTracks.complete, false);
  assert.equal(cappedTracks.privacy, 'UNKNOWN');
  assert.equal(trackPages, 2);
  malformed = true;
  const bad = await fetch(prefix + '/playlists', { headers });
  assert.equal(bad.status, 503);
  assert.equal((await bad.text()).includes('private-upstream-secret'), false);
  malformed = false;
  assert.equal(
    (await fetch(prefix + '/playlists', { headers })).status,
    200,
    'Lock releases after malformed and failed reads',
  );
});
