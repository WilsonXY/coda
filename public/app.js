const $ = id => document.getElementById(id);
const audio = $('audio');
const events = [];
let eventsTotal = 0;
let selectedTracks = null;
let delivery = 'network';
let liveRunId = null;
let liveRequestedTrackIdsAtSelection = null;
const liveBuffers = new Map();
let livePlayback = null;
const toneSource = 'generated WAV tones; not YouTube audio';
let source = toneSource;
let musicPreparedAt = null;
let preparing = false;
let modeLocked = false;
const checks = ['Play / pause / seek / volume', 'Previous / next', 'Three automatic track transitions', 'Audio continues when switching panels', 'Queue reorder and remove', 'Lock screen for ten minutes (Android)', 'Headset and lock-screen controls', 'Switch apps and return', 'Recover after an interruption', 'Repeat with battery saver enabled'];
let queue = [];
let current = null;
let playbackAttempt = 0;
let networkBusy = false;
const progressive = () => delivery === 'live' || delivery === 'library';
audio.volume = 0.25;

function tones() {
  return ['A', 'B', 'C'].map((name, i) => ({ title: `Tone ${name}`, url: `/audio/${i}.wav`, seconds: 20,
    artist: 'Coda generated test audio', mime: 'audio/wav' }));
}

function log(event, details = {}) {
  eventsTotal++;
  events.push({ source, audioDelivery: delivery, at: new Date().toISOString(), event,
    track: current?.title ?? null, trackId: current?.id ?? null, position: Number(audio.currentTime.toFixed(2)), ...details,
    ...(delivery === 'library' ? { track: null, trackId: null, bufferedTrackId: null } : {}) });
  if (events.length > 300) events.shift();
  $('events').textContent = events.slice(-25).map(row => `${row.at.slice(11, 19)} ${row.event} ${row.track ?? ''} @ ${row.position}s`).join('\n');
}

function renderQueue() {
  $('queue').replaceChildren(...queue.map((track, index) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = `${track === current ? '▶ ' : ''}${track.title}${Number.isFinite(track.seconds) ? ` — ${track.seconds} seconds` : ''} `;
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
  const attempt = ++playbackAttempt;
  try { await audio.play(); if (playbackAttempt === attempt) void bufferNext(); }
  catch (error) {
    if (playbackAttempt !== attempt) return;
    log('play-rejected', { error: error.name }); $('now').textContent = 'Playback failed. Tap Play again; check exported events.';
  }
}

async function select(track) {
  if (preparing) return;
  modeLocked = true;
  $('preload').disabled = true;
  $('music').disabled = true;
  $('live').disabled = true;
  $('buffer-next').disabled = true;
  current = track;
  const buffered = liveBuffers.get(track.id);
  const useBuffer = progressive() && buffered?.status === 'ready';
  audio.src = useBuffer ? buffered.url : track.url;
  if (progressive()) {
    livePlayback = { trackId: track.id, storage: useBuffer ? 'phone-buffer' : 'progressive-http', selectedAt: new Date().toISOString() };
    log('live-playback-source', livePlayback);
  }
  $('now').textContent = track.title;
  $('playback-status').textContent = 'Loading song…';
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist });
  }
  renderQueue();
  void bufferNext(false);
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
  void bufferNext();
}

function remove(track) {
  queue = queue.filter(item => item !== track);
  if (current === track) {
    playbackAttempt++;
    $('playback-status').textContent = '';
    audio.pause(); audio.removeAttribute('src'); audio.load();
    current = null; $('now').textContent = 'Current track removed. Choose another track.';
    livePlayback = null;
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }
  renderQueue(); log('queue-item-removed');
  void bufferNext();
}

function reset() {
  playbackAttempt++;
  $('playback-status').textContent = '';
  audio.pause(); audio.removeAttribute('src'); audio.load(); current = null;
  livePlayback = null;
  void bufferNext();
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

function nextBufferTrack() {
  const index = queue.indexOf(current);
  if (index < 0 || queue.length < 2) return null;
  return queue[index + 1] ?? ($('loop').checked ? queue[0] : null);
}

function showBufferStatus() {
  const next = nextBufferTrack();
  const entry = liveBuffers.get(next?.id);
  $('buffer-status').textContent = !progressive() || !$('buffer-next').checked
    ? 'Next-song buffering is off. Select live music to enable it before Play.'
    : !current ? 'Next-song buffering enabled. Press Play; then wait for the next song to be ready before locking.'
    : !next ? 'No next song to buffer.'
    : entry?.status === 'ready' ? `Next song ready on this device: ${next.title}. You can lock the screen for the comparison.`
    : entry?.status === 'failed' ? `Buffer unavailable: ${next.title}. Playback will use live HTTP if selected; export the result.`
    : entry?.status === 'loading' ? `Buffering next song: ${next.title}… keep the page open until ready.`
    : `Next song not buffered: ${next.title}. Buffering starts after playback begins.`;
}

async function bufferNext(startDownload = true) {
  const enabled = progressive() && $('buffer-next').checked;
  const next = enabled ? nextBufferTrack() : null;
  // ponytail: retain only current/next Blobs; no persistent catalog cache.
  const keep = enabled && current ? [current.id, next?.id] : [];
  for (const [id, entry] of liveBuffers) {
    if (keep.includes(id)) continue;
    entry.controller.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
    liveBuffers.delete(id);
  }
  showBufferStatus();
  if (!startDownload || !next || liveBuffers.has(next.id)) return;
  const entry = { status: 'loading', bytes: 0, startedAt: new Date().toISOString(), readyAt: null, controller: new AbortController() };
  liveBuffers.set(next.id, entry);
  showBufferStatus();
  log('next-buffer-start', { bufferedTrackId: next.id });
  try {
    if (next.bytes !== undefined && (!Number.isSafeInteger(next.bytes) || next.bytes < 1 || next.bytes > 16 * 1024 * 1024)) throw new Error('Unexpected audio size');
    const response = await fetch(next.url, { cache: 'no-store', signal: AbortSignal.any([entry.controller.signal, AbortSignal.timeout(120000)]) });
    if (!response.ok) throw new Error('Audio unavailable');
    const length = response.headers.get('content-length');
    const expected = next.bytes ?? (/^[1-9]\d*$/.test(length ?? '') ? Number(length) : NaN);
    if (!Number.isSafeInteger(expected) || expected < 1 || expected > 16 * 1024 * 1024) throw new Error('Unexpected audio size');
    const blob = await response.blob();
    if (blob.size !== expected || !blob.type.startsWith(next.mime)) throw new Error('Unexpected audio data');
    if (liveBuffers.get(next.id) !== entry || entry.controller.signal.aborted) return;
    entry.url = URL.createObjectURL(blob);
    entry.status = 'ready'; entry.bytes = blob.size; entry.readyAt = new Date().toISOString();
    log('next-buffer-ready', { bufferedTrackId: next.id, bytes: blob.size });
  } catch (error) {
    if (liveBuffers.get(next.id) !== entry) return;
    entry.status = 'failed';
    log('next-buffer-failed', { bufferedTrackId: next.id, error: error.name });
  } finally { showBufferStatus(); }
}

$('loop').onchange = () => { void bufferNext(); };
$('buffer-next').onchange = () => {
  source = 'live YouTube audio; anonymous retrieval; progressive HTTP' + ($('buffer-next').checked ? ' with next-song browser buffering' : '');
  showBufferStatus();
};

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
    $('buffer-next').disabled = delivery !== 'live' || modeLocked;
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
    liveRequestedTrackIdsAtSelection = catalog.retrievals.map(track => track.id);
    reset(); log('live-selected', { runId: liveRunId, requestedTrackIdsAtSelection: liveRequestedTrackIdsAtSelection });
    $('delivery-status').textContent = 'Ready: live music. Press Play to fetch the selected song while it plays. Seeking may wait for incoming bytes.';
  } catch (error) {
    selectedTracks = null; delivery = 'network'; source = toneSource; liveRunId = null; liveRequestedTrackIdsAtSelection = null; reset();
    $('delivery-status').textContent = 'Live music unavailable. Retry or use the generated tones.';
    log('live-selection-failed', { error: error.name });
  } finally {
    preparing = false;
    for (const id of ['play', 'previous', 'next', 'reset']) $(id).disabled = false;
    for (const id of ['preload', 'music', 'live']) $(id).disabled = Boolean(selectedTracks) || modeLocked;
    $('buffer-next').disabled = delivery !== 'live' || modeLocked;
    renderQueue();
  }
};


for (const name of ['play', 'pause', 'playing', 'waiting', 'stalled', 'ended', 'seeking', 'seeked', 'loadedmetadata', 'loadstart', 'canplay', 'error']) {
  audio.addEventListener(name, () => {
    log(name, name === 'error' ? { mediaError: audio.error?.code ?? null } : {});
    if (['playing', 'pause', 'error'].includes(name)) {
      if (name === 'pause' && audio.paused) playbackAttempt++;
      if (!current) $('playback-status').textContent = '';
      else if (audio.error) $('playback-status').textContent = 'This song could not be played. It may be unavailable; choose another song.';
      else if (audio.ended) $('playback-status').textContent = 'Finished';
      else if (audio.paused) $('playback-status').textContent = 'Paused';
      else if (name === 'playing') $('playback-status').textContent = 'Playing';
    }
    if (name === 'loadedmetadata' && current && Number.isFinite(audio.duration)) { current.seconds = Math.round(audio.duration); renderQueue(); }
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
for (const panel of ['player', 'search', 'account']) $('show-' + panel).onclick = () => {
  for (const name of ['player', 'search', 'account']) $(name + '-panel').hidden = panel !== name;
  log('panel', { panel });
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
    source, musicPreparedAt, liveRunId, liveRequestedTrackIdsAtSelection, liveStatus,
    liveBrowserBuffering: progressive() ? { enabled: $('buffer-next').checked, playback: delivery === 'library' && livePlayback ? { ...livePlayback, trackId: null } : livePlayback,
      tracks: [...liveBuffers].map(([id, entry]) => ({ id: delivery === 'library' ? null : id, status: entry.status, bytes: entry.bytes, startedAt: entry.startedAt, readyAt: entry.readyAt })) } : null,
    musicTrackIds: delivery === 'library' ? [] : (selectedTracks ?? []).filter(track => track.id).map(track => track.id),
    mediaSessionSupported: 'mediaSession' in navigator,
    checks: checks.map((check, i) => ({ check, status: $(`check-${i}`).value })), notes: $('notes').value, events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'coda-device-results.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function request(path, signal, options = {}) {
  const response = await fetch(path, { ...options, signal });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? `HTTP ${response.status}`), { code: data.code });
  return data;
}

let accountBusy = false;
let playlistTestAttempted = false;
async function accountRead(path) {
  try {
    const data = await request(path, AbortSignal.timeout(20000));
    $('account-connection').textContent = `Connected · last checked ${new Date().toLocaleTimeString()}.`;
    $('account-recovery').hidden = true; $('account-recovery').open = false;
    return data;
  } catch (error) {
    const states = {
      ACCOUNT_REAUTH_REQUIRED: 'Reconnect needed. The saved YouTube Music session is no longer accepted.',
      ACCOUNT_SETUP_REQUIRED: 'Account setup needs attention. Check the local auth file and its permissions.',
      ACCOUNT_NOT_CONFIGURED: 'Account setup is not configured on this server.',
      ACCOUNT_OWNER_REQUIRED: 'Use the owner’s private Tailscale link to check the connection.',
      ACCOUNT_BUSY: 'An account request is already running. Check again shortly.',
    };
    $('account-connection').textContent = states[error.code] ?? 'Connection unverified. The server or YouTube Music may be unavailable; try checking again.';
    $('account-recovery').hidden = !['ACCOUNT_REAUTH_REQUIRED', 'ACCOUNT_SETUP_REQUIRED'].includes(error.code);
    $('account-recovery').open = false;
    throw error;
  }
}
function clearAccountView() {
  $('account-playlists').replaceChildren(); $('account-tracks').replaceChildren();
  $('account-playback-actions').replaceChildren();
  $('account-playlist-title').textContent = 'No playlist selected';
  $('account-playlist-status').textContent = '';
}
function libraryMode() {
  if (preparing) { $('account-status').textContent = 'Wait for the current audio preparation to finish.'; return false; }
  if (delivery === 'library') return true;
  for (const track of selectedTracks ?? []) if (track.url.startsWith('blob:')) URL.revokeObjectURL(track.url);
  selectedTracks = []; delivery = 'library'; source = 'library-selected YouTube audio; anonymous retrieval; next-song browser buffering';
  musicPreparedAt = null; liveRunId = null; liveRequestedTrackIdsAtSelection = null; modeLocked = true;
  $('buffer-next').checked = true; $('buffer-next').disabled = true;
  for (const id of ['preload', 'music', 'live']) $(id).disabled = true;
  reset();
  $('delivery-status').textContent = 'Playlist playback. Use the player above; the next song buffers automatically. Playback uses anonymous audio retrieval.';
  return true;
}
const libraryTrack = track => ({ id: track.id, title: track.title, artist: track.artists, mime: 'audio/webm', url: `/catalog/${encodeURIComponent(track.id)}.webm` });
function playLibrary(tracks, start) {
  if (!libraryMode()) return;
  selectedTracks = tracks.map(libraryTrack); reset();
  select(queue[start]);
  $('account-status').textContent = 'Playing in the player above. Player checks shows your queue.';
}
async function accountCheck(task, failureLabel = 'Account read failed.') {
  if (accountBusy) return;
  accountBusy = true;
  $('account-panel').querySelectorAll('button').forEach(button => { button.disabled = true; });
  $('account-status').textContent = 'Loading account data…';
  try { await task(); }
  catch (error) { clearAccountView(); $('account-status').textContent = `${failureLabel} ${error.message}`; log('account-request-failed'); }
  finally {
    accountBusy = false; $('account-panel').querySelectorAll('button').forEach(button => { button.disabled = false; });
    $('account-test').disabled = playlistTestAttempted;
  }
}
$('account-test').onclick = () => {
  if (accountBusy || playlistTestAttempted) return;
  playlistTestAttempted = true;
  accountCheck(async () => {
    clearAccountView(); $('account-test-steps').replaceChildren();
    $('account-test-status').textContent = 'Running once. Waiting for verified readbacks…';
    try {
      const result = await request('/api/account/playlist-test', AbortSignal.timeout(20000), { method: 'POST' });
      $('account-test-status').textContent = result.status === 'PASS_API_READBACK'
        ? 'PASS_API_READBACK: original two songs and their item identities preserved. Verify the playlist on YouTube Music.'
        : `${result.status}: ${result.note ?? 'Inspect the test playlist and local journal before further writes.'}`;
      $('account-test-steps').replaceChildren(...result.steps.map(step => {
        const li = document.createElement('li'); li.textContent = `${step.action}: ${step.order.length} tracks verified`; return li;
      }));
      $('account-status').textContent = 'Playlist test request finished.'; log('playlist-test-finished');
    } catch (error) {
      $('account-test-status').textContent = 'Outcome unconfirmed. Inspect the disposable playlist and local journal before further writes. Do not retry.';
      throw error;
    }
  }, 'Playlist test stopped.');
};
$('account-check').onclick = () => accountCheck(async () => {
  await accountRead('/api/account/status');
  $('account-status').textContent = 'Connection checked. You can load your playlists.';
});
$('account-load').onclick = () => accountCheck(async () => {
  clearAccountView();
  const data = await accountRead('/api/account/playlists');
  $('account-playlists').replaceChildren(...data.items.map(item => {
    const li = document.createElement('li');
    const title = document.createElement('span'); title.textContent = item.title + ' '; li.append(title);
    if (item.id) {
      const button = document.createElement('button'); button.textContent = 'Open playlist'; button.disabled = accountBusy;
      button.onclick = () => accountCheck(async () => {
        const playlist = await accountRead(`/api/account/playlist?id=${encodeURIComponent(item.id)}`);
        $('account-playlist-title').textContent = playlist.title;
        $('account-playlist-status').textContent = `${playlist.privacy} · ${playlist.items.length} tracks shown` +
          (playlist.total === null ? ` (limit ${playlist.limit})` : ` of ${playlist.total}`);
        const playable = playlist.items.filter(track => track.id);
        $('account-playback-actions').replaceChildren();
        if (playable.length) {
          const play = document.createElement('button'); play.textContent = 'Play playlist'; play.onclick = () => playLibrary(playable, 0);
          $('account-playback-actions').append(play);
        }
        $('account-tracks').replaceChildren(...playlist.items.map(track => {
          const row = document.createElement('li'); row.textContent = `${track.title}${track.artists ? ' — ' + track.artists : ''} `;
          if (track.id) {
            const play = document.createElement('button'); play.textContent = 'Play'; play.onclick = () => playLibrary(playable, playable.indexOf(track));
            const add = document.createElement('button'); add.textContent = 'Add to queue'; add.onclick = () => {
              if (!libraryMode()) return;
              queue.push(libraryTrack(track)); selectedTracks = queue.map(item => ({ ...item })); renderQueue(); void bufferNext();
              $('account-status').textContent = 'Added to the player queue. Press Play above to start if stopped.';
            };
            row.append(play, add);
          }
          return row;
        }));
        $('account-status').textContent = 'Playlist loaded.'; log('account-playlist-read');
      });
      li.append(button);
    } else li.append(document.createTextNode('Unavailable in this view.'));
    return li;
  }));
  $('account-status').textContent = `${data.items.length} playlists shown (limit ${data.limit}).`;
  log('account-library-read');
});

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
