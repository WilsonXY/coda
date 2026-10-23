const $ = id => document.getElementById(id);
const audio = $('audio');
const events = [];
let eventsTotal = 0;
let selectedTracks = null;
let delivery = 'network';
let liveRunId = null;
const toneSource = 'generated WAV tones; not YouTube audio';
let source = toneSource;
let musicPreparedAt = null;
let preparing = false;
let modeLocked = false;
const checks = ['Play / pause / seek / volume', 'Previous / next', 'Three automatic track transitions', 'Audio continues when switching panels', 'Queue reorder and remove', 'Lock screen for ten minutes (Android)', 'Headset and lock-screen controls', 'Switch apps and return', 'Recover after an interruption', 'Repeat with battery saver enabled'];
let queue = [];
let current = null;
let networkBusy = false;
audio.volume = 0.25;

function tones() {
  return ['A', 'B', 'C'].map((name, i) => ({ title: `Tone ${name}`, url: `/audio/${i}.wav`, seconds: 20,
    artist: 'Coda generated test audio', mime: 'audio/wav' }));
}

function log(event, details = {}) {
  eventsTotal++;
  events.push({ source, audioDelivery: delivery, at: new Date().toISOString(), event,
    track: current?.title ?? null, trackId: current?.id ?? null, position: Number(audio.currentTime.toFixed(2)), ...details });
  if (events.length > 300) events.shift();
  $('events').textContent = events.slice(-25).map(row => `${row.at.slice(11, 19)} ${row.event} ${row.track ?? ''} @ ${row.position}s`).join('\n');
}

function renderQueue() {
  $('queue').replaceChildren(...queue.map((track, index) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = `${track === current ? '▶ ' : ''}${track.title} — ${track.seconds} seconds `;
    li.append(title);
    for (const [label, action, disabled] of [
      ['Play', () => select(track), false],
      ['Move up', () => move(index, -1), index === 0],
      ['Move down', () => move(index, 1), index === queue.length - 1],
      ['Remove', () => remove(track), false],
    ]) {
      const button = document.createElement('button');
      button.textContent = label; button.disabled = disabled || preparing; button.onclick = () => { log('control', { action: label, control: 'queue' }); action(); }; li.append(button);
    }
    return li;
  }));
}

async function resume() {
  if (preparing) return;
  try { await audio.play(); }
  catch (error) { log('play-rejected', { error: error.name }); $('now').textContent = 'Playback failed. Tap Play again; check exported events.'; }
}

async function select(track) {
  if (preparing) return;
  modeLocked = true;
  $('preload').disabled = true;
  $('music').disabled = true;
  $('live').disabled = true;
  current = track;
  audio.src = track.url;
  $('now').textContent = track.title;
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist });
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
  queue = (selectedTracks ?? tones()).map(track => ({ ...track }));
  $('now').textContent = 'Nothing playing'; renderQueue(); log('queue-reset');
}

$('play').onclick = () => {
  log('control', { action: 'play-pause', control: 'button' });
  return current ? (audio.paused ? resume() : audio.pause()) : queue[0] && select(queue[0]);
};
$('next').onclick = () => { log('control', { action: 'next', control: 'button' }); step(1); };
$('previous').onclick = () => { log('control', { action: 'previous', control: 'button' }); step(-1); };
$('reset').onclick = () => { log('control', { action: 'reset', control: 'button' }); reset(); };

async function prepare(mode) {
  if (preparing || modeLocked || selectedTracks) return;
  preparing = true;
  reset();
  for (const id of ['play', 'previous', 'next', 'reset', 'preload', 'music', 'live']) $(id).disabled = true;
  renderQueue();
  $('delivery-status').textContent = `Loading all three ${mode === 'music' ? 'music tracks' : 'tones'}… wait before pressing Play.`;
  log('preload-start', { requestedSource: mode });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), mode === 'music' ? 120000 : 15000);
  const urls = [];
  try {
    const catalog = mode === 'music' ? await request('/api/music', controller.signal) : null;
    const tracks = catalog ? catalog.tracks.map(track => ({ ...track, url: `/music/${encodeURIComponent(track.id)}.webm` })) : tones();
    const blobs = await Promise.all(tracks.map(async track => {
      const response = await fetch(track.url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith(track.mime) || (mode === 'music' && blob.size !== track.bytes)) throw new Error('Unexpected audio data');
      return blob;
    }));
    for (const blob of blobs) urls.push(URL.createObjectURL(blob));
    selectedTracks = tracks.map((track, i) => ({ ...track, url: urls[i] }));
    delivery = 'preloaded';
    source = mode === 'music' ? 'prepared YouTube audio; anonymous retrieval; fully buffered' : toneSource;
    musicPreparedAt = catalog?.preparedAt ?? null;
    reset();
    $('delivery-status').textContent = mode === 'music' ? 'Ready: three complete music tracks are loaded in memory. Press Play.' : 'Ready: all three tones are loaded in memory. Press Play for the comparison.';
    log('preload-ready', { bytes: blobs.reduce((sum, blob) => sum + blob.size, 0) });
  } catch (error) {
    controller.abort();
    urls.forEach(url => URL.revokeObjectURL(url));
    selectedTracks = null; delivery = 'network'; source = toneSource; musicPreparedAt = null; reset();
    $('delivery-status').textContent = `Could not load all ${mode === 'music' ? 'music tracks' : 'tones'}. Original network mode remains selected. Retry or press Play to use it.`;
    log('preload-failed', { error: error.name });
  } finally {
    clearTimeout(timeout);
    preparing = false;
    for (const id of ['play', 'previous', 'next', 'reset']) $(id).disabled = false;
    for (const id of ['preload', 'music', 'live']) $(id).disabled = Boolean(selectedTracks) || modeLocked;
    renderQueue();
  }
}
$('preload').onclick = () => prepare('tones');
$('music').onclick = () => prepare('music');
$('live').onclick = async () => {
  if (preparing || modeLocked || selectedTracks) return;
  preparing = true; reset();
  for (const id of ['play', 'previous', 'next', 'reset', 'preload', 'music', 'live']) $(id).disabled = true;
  renderQueue();
  $('delivery-status').textContent = 'Selecting live music…';
  try {
    const catalog = await request('/api/live', AbortSignal.timeout(15000));
    selectedTracks = catalog.tracks.map(track => ({ ...track, url: `/live/${encodeURIComponent(track.id)}.webm` }));
    delivery = 'live'; source = 'live YouTube audio; anonymous retrieval; progressive HTTP';
    musicPreparedAt = null; liveRunId = catalog.runId;
    reset(); log('live-selected', { runId: liveRunId, requestedTrackIdsAtSelection: catalog.retrievals.map(track => track.id) });
    $('delivery-status').textContent = 'Ready: live music. Press Play to fetch the selected song while it plays. Seeking may wait for incoming bytes.';
  } catch (error) {
    selectedTracks = null; delivery = 'network'; source = toneSource; liveRunId = null; reset();
    $('delivery-status').textContent = 'Live music unavailable. Retry or use the generated tones.';
    log('live-selection-failed', { error: error.name });
  } finally {
    preparing = false;
    for (const id of ['play', 'previous', 'next', 'reset']) $(id).disabled = false;
    for (const id of ['preload', 'music', 'live']) $(id).disabled = Boolean(selectedTracks) || modeLocked;
    renderQueue();
  }
};


for (const name of ['play', 'pause', 'playing', 'waiting', 'stalled', 'ended', 'seeking', 'seeked', 'loadedmetadata', 'loadstart', 'canplay', 'error']) {
  audio.addEventListener(name, () => {
    log(name, name === 'error' ? { mediaError: audio.error?.code ?? null } : {});
    if ('mediaSession' in navigator && ['play', 'pause', 'ended'].includes(name)) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  });
}
audio.addEventListener('ended', () => step(1));
document.addEventListener('visibilitychange', () => log('visibility', { state: document.visibilityState }));
window.addEventListener('pagehide', () => log('pagehide'));
for (const name of ['freeze', 'resume']) document.addEventListener(name, () => log(name));
if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: resume, pause: () => audio.pause(), nexttrack: () => step(1), previoustrack: () => step(-1), seekto: detail => { if (Number.isFinite(detail.seekTime)) audio.currentTime = detail.seekTime; } })) {
    try { navigator.mediaSession.setActionHandler(action, details => { log('media-action', { action }); handler(details); }); } catch { log('unsupported-media-action', { action }); }
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
$('export').onclick = async () => {
  let liveStatus = null;
  if (delivery === 'live') {
    try { liveStatus = await request('/api/live/status', AbortSignal.timeout(3000)); }
    catch { liveStatus = { unavailable: true }; }
  }
  const result = { schemaVersion: 2, audioDelivery: delivery, eventsTotal, eventsTruncated: eventsTotal > events.length, date: new Date().toISOString(), device: $('device').value, userAgent: navigator.userAgent,
    source, musicPreparedAt, liveRunId, liveStatus, musicTrackIds: (selectedTracks ?? []).filter(track => track.id).map(track => track.id),
    mediaSessionSupported: 'mediaSession' in navigator,
    checks: checks.map((check, i) => ({ check, status: $(`check-${i}`).value })), notes: $('notes').value, events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'coda-device-results.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function request(path, signal) {
  const response = await fetch(path, { signal });
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
      $('search-status').textContent = type === 'song' ? 'Response received. This response check does not play music.' : `${result.items.length} playlist items read; more pages: ${result.more}.`;
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
