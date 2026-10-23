import { search, playlist, playability } from '../youtube.mjs';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url)));
const report = { date: new Date().toISOString(), library: 'youtubei.js',
  version: pkg.packages['node_modules/youtubei.js'].version,
  query: cases.queries[0], location: 'MY', account: 'NOT RUN: no session configured', checks: {} };

async function check(name, action) {
  const start = performance.now();
  try {
    const data = await action();
    report.checks[name] = { status: 'PASS', ms: Math.round(performance.now() - start), data };
    return data;
  } catch (error) {
    report.checks[name] = { status: 'FAIL', errorType: error.name, ms: Math.round(performance.now() - start) };
  }
}
const songs = await check('search', async () => {
  const data = await search(report.query);
  if (!data.items.length) throw new Error('No results');
  return data;
});
for (const [index, query] of cases.queries.slice(1).entries()) {
  await check(`searchCase${index + 2}`, async () => {
    const data = await search(query);
    if (!data.items.length) throw new Error('No results');
    return { query, ...data };
  });
}
await check('publicPlaylist', async () => {
  const data = await playlist(cases.playlistId);
  if (!data.items.length) throw new Error('Empty playlist');
  return { id: cases.playlistId, title: data.title, itemsRead: data.items.length, more: data.more };
});
if (songs) await check('playerResponse', () => playability(songs.items[0].id));
report.integratedPlayback = 'NOT RUN: no stream delivery/player integration implemented; player-response success is not audio playback.';
console.log(JSON.stringify(report, null, 2));
process.exitCode = Object.values(report.checks).some(check => check.status === 'FAIL') ? 1 : 0;
