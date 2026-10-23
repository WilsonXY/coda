const $ = id => document.getElementById(id);
const audio = $('audio');
const events = [];
const checks = ['Play / pause / seek / volume', 'Previous / next', 'Three automatic track transitions', 'Audio continues when switching panels', 'Queue reorder and remove', 'Lock screen for ten minutes (Android)', 'Headset and lock-screen controls', 'Switch apps and return', 'Recover after an interruption', 'Repeat with battery saver enabled'];
let queue = [];
let current = null;
let networkBusy = false;

function log(event, details = {}) {
  events.push({ at: new Date().toISOString(), event, track: current?.title ?? null, position: Number(audio.currentTime.toFixed(2)), ...details });
  if (events.length > 300) events.shift();
  $('events').textContent = events.slice(-25).map(row => `${row.at.slice(11, 19)} ${row.event} ${row.track ?? ''} @ ${row.position}s`).join('\n');
}

function renderQueue() {
  $('queue').replaceChildren(...queue.map((track, index) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = `${track === current ? '▶ ' : ''}${track.title} — 20 seconds `;
    li.append(title);
    for (const [label, action, disabled] of [
      ['Play', () => select(track), false],
      ['Move up', () => move(index, -1), index === 0],
      ['Move down', () => move(index, 1), index === queue.length - 1],
      ['Remove', () => remove(track), false],
    ]) {
      const button = document.createElement('button');
      button.textContent = label; button.disabled = disabled; button.onclick = action; li.append(button);
    }
    return li;
  }));
}

async function resume() {
  try { await audio.play(); }
  catch (error) { log('play-rejected', { error: error.name }); $('now').textContent = 'Playback failed. Tap Play again; check exported events.'; }
}

async function select(track) {
  current = track;
  audio.src = track.url;
  $('now').textContent = track.title;
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: 'Coda generated test audio' });
  }
  renderQueue();
  await resume();
}

function step(direction) {
  if (!queue.length) return;
  const index = queue.indexOf(current);
  let target = index < 0 ? 0 : index + direction;
  if (target < 0 || target >= queue.length) {
    if (!$('loop').checked) { audio.pause(); log('queue-end'); return; }
    target = (target + queue.length) % queue.length;
  }
  select(queue[target]);
}

function move(index, direction) {
  [queue[index], queue[index + direction]] = [queue[index + direction], queue[index]];
  renderQueue(); log('queue-reordered');
}

function remove(track) {
  queue = queue.filter(item => item !== track);
  if (current === track) {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    current = null; $('now').textContent = 'Current track removed. Choose another track.';
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }
  renderQueue(); log('queue-item-removed');
}

function reset() {
  audio.pause(); audio.removeAttribute('src'); audio.load(); current = null;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  queue = ['A', 'B', 'C'].map((name, i) => ({ title: `Tone ${name}`, url: `/audio/${i}.wav` }));
  $('now').textContent = 'Nothing playing'; renderQueue(); log('queue-reset');
}

$('play').onclick = () => current ? (audio.paused ? resume() : audio.pause()) : queue[0] && select(queue[0]);
$('next').onclick = () => step(1);
$('previous').onclick = () => step(-1);
$('reset').onclick = reset;
for (const name of ['play', 'pause', 'playing', 'waiting', 'stalled', 'ended', 'seeking', 'seeked', 'loadedmetadata', 'error']) {
  audio.addEventListener(name, () => {
    log(name, name === 'error' ? { mediaError: audio.error?.code ?? null } : {});
    if ('mediaSession' in navigator && ['play', 'pause', 'ended'].includes(name)) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  });
}
audio.addEventListener('ended', () => step(1));
document.addEventListener('visibilitychange', () => log('visibility', { state: document.visibilityState }));
window.addEventListener('pagehide', () => log('pagehide'));
if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: resume, pause: () => audio.pause(), nexttrack: () => step(1), previoustrack: () => step(-1), seekto: detail => { if (Number.isFinite(detail.seekTime)) audio.currentTime = detail.seekTime; } })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { log('unsupported-media-action', { action }); }
  }
}
for (const panel of ['player', 'search']) $('show-' + panel).onclick = () => {
  $('player-panel').hidden = panel !== 'player'; $('search-panel').hidden = panel !== 'search'; log('panel', { panel });
};

for (const [index, label] of checks.entries()) {
  const row = document.createElement('label'); row.className = 'check'; row.textContent = label;
  const select = document.createElement('select'); select.id = `check-${index}`;
  for (const status of ['NOT RUN', 'PASS', 'FAIL', 'BLOCKED']) select.add(new Option(status, status));
  row.append(select); $('checklist').append(row);
}
$('export').onclick = () => {
  const result = { date: new Date().toISOString(), device: $('device').value, userAgent: navigator.userAgent,
    source: 'generated WAV tones; not YouTube audio',
    mediaSessionSupported: 'mediaSession' in navigator,
    checks: checks.map((check, i) => ({ check, status: $(`check-${i}`).value })), notes: $('notes').value, events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'coda-device-results.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function request(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function networkCheck(task) {
  if (networkBusy) return;
  networkBusy = true;
  const buttons = [...$('search-panel').querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  try { await task(); }
  catch (error) { $('search-status').textContent = `FAIL: ${error.message}`; log('upstream-failed'); }
  finally { networkBusy = false; $('search-panel').querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}

function showItems(data, type) {
  $('results').replaceChildren(...data.items.map(item => {
    const li = document.createElement('li');
    const label = document.createElement('span'); label.textContent = `${item.title} ${item.artists} (${item.id}) `;
    const button = document.createElement('button'); button.textContent = type === 'song' ? 'Check player response' : 'Read playlist';
    button.onclick = () => networkCheck(async () => {
      $('search-status').textContent = 'Checking…';
      const result = await request(type === 'song' ? `/api/playability?id=${encodeURIComponent(item.id)}` : `/api/playlist?id=${encodeURIComponent(item.id)}`);
      $('probe-output').textContent = JSON.stringify(result, null, 2);
      $('search-status').textContent = type === 'song' ? 'Response received. No music played; integrated playback is NOT RUN.' : `${result.items.length} playlist items read; more pages: ${result.more}.`;
      log(type === 'song' ? 'player-response' : 'playlist-read');
    });
    li.append(label, button); return li;
  }));
}
$('search').onsubmit = event => {
  event.preventDefault();
  networkCheck(async () => {
    const type = $('type').value;
    $('results').replaceChildren(); $('search-status').textContent = 'Searching…';
    const start = performance.now();
    const result = await request(`/api/search?q=${encodeURIComponent($('query').value)}&type=${type}`);
    showItems(result, type);
    $('search-status').textContent = `${result.items.length ? 'Results' : 'NO RESULTS'}: ${result.items.length} items in ${((performance.now() - start) / 1000).toFixed(2)}s. More pages: ${result.more}.`;
    log('search-complete', { count: result.items.length, ms: Math.round(performance.now() - start) });
  });
};
$('playlist').onsubmit = event => {
  event.preventDefault(); networkCheck(async () => {
    $('search-status').textContent = 'Reading…';
    const result = await request(`/api/playlist?id=${encodeURIComponent($('playlist-id').value.trim())}`);
    $('probe-output').textContent = JSON.stringify(result, null, 2);
    $('search-status').textContent = `${result.items.length} items read. More pages: ${result.more}.`;
    log('playlist-read', { count: result.items.length });
  });
};
reset();
