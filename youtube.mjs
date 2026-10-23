import { Innertube } from 'youtubei.js';

let session;
async function client() {
  session ??= Innertube.create({
    retrieve_player: false,
    lang: 'en', location: 'MY',
    fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(15000) }),
  }).catch(error => { session = undefined; throw error; });
  return session;
}

function item(row) {
  return {
    id: row.id,
    title: String(row.title?.text ?? row.title ?? ''),
    artists: row.artists?.map(artist => artist.name).join(', ') ?? '',
    seconds: row.duration?.seconds ?? null,
  };
}

export async function search(query, type = 'song') {
  const yt = await client();
  const result = await yt.music.search(query, { type });
  const shelf = type === 'playlist' ? result.playlists : result.songs;
  return { items: (shelf?.contents ?? []).filter(row => row.id).slice(0, 30).map(item), more: result.has_continuation };
}

export async function playlist(id) {
  const result = await (await client()).music.getPlaylist(id);
  return { title: String(result.header?.title?.text ?? result.header?.title ?? id),
    items: result.items.filter(row => row.id).map(item), more: result.has_continuation };
}

export async function playability(id) {
  const yt = await client();
  const results = [];
  for (const clientType of ['WEB', 'ANDROID']) {
    const info = await yt.getBasicInfo(id, { client: clientType });
    const formats = info.streaming_data?.adaptive_formats?.filter(format => format.has_audio && !format.has_video) ?? [];
    results.push({ client: clientType, status: info.playability_status?.status ?? 'UNKNOWN',
      reason: info.playability_status?.reason ?? '', audioFormats: formats.length,
      directAudioUrls: formats.filter(format => format.url).length,
      hasSabr: Boolean(info.streaming_data?.server_abr_streaming_url) });
  }
  return { id, playbackTested: false, results,
    note: 'Player responses only. No media was played. URL resolution and browser playback remain unverified.' };
}
