"""Public comparison, or an explicit write test confined to one new private playlist."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time


def account_check(yt, a, b, report):
    if a == b or not all(isinstance(video_id, str) and re.fullmatch(r'[\w-]{11}', video_id, flags=re.ASCII) for video_id in (a, b)):
        raise AssertionError('Two distinct 11-character video IDs required; stop before creating a playlist.')
    playlist_id = yt.create_playlist(
        title='Coda experiment ' + datetime.now(timezone.utc).isoformat(timespec='seconds'),
        description='Disposable Coda test. Only this newly created playlist is modified. Delete after inspecting.',
        privacy_status='PRIVATE', video_ids=[a, b])
    if not (isinstance(playlist_id, str) and re.fullmatch(r'PL[\w-]+', playlist_id)):
        raise AssertionError('No new playlist ID; stop.')
    report['playlistId'] = playlist_id
    report['steps'] = []

    def readback(stage, expected):
        listing = yt.get_playlist(playlist_id, limit=20)
        if listing.get('privacy') != 'PRIVATE':
            raise AssertionError('New playlist is not confirmed PRIVATE; stop.')
        tracks = listing['tracks']
        actual = [t.get('videoId') for t in tracks]
        report['steps'].append({'action': stage, 'expected': expected, 'actual': actual})
        if not (actual == expected):
            raise AssertionError(stage + ' readback did not match; stop without retrying writes.')
        return tracks

    readback('create private playlist', [a, b])
    yt.add_playlist_items(playlist_id, videoIds=[a], duplicates=True)
    tracks = readback('add duplicate', [a, b, a])
    duplicate_id, first_id = tracks[2].get('setVideoId'), tracks[0].get('setVideoId')
    if not (duplicate_id and first_id and duplicate_id != first_id):
        raise AssertionError('Distinct playlist-item IDs missing; stop.')
    yt.edit_playlist(playlist_id, moveItem=(duplicate_id, first_id))
    tracks = readback('move duplicate to front', [a, a, b])
    if not (tracks[0].get('setVideoId') == duplicate_id):
        raise AssertionError('Wrong occurrence moved; stop.')
    yt.remove_playlist_items(playlist_id, [{'videoId': a, 'setVideoId': duplicate_id}])
    tracks = readback('remove exact duplicate', [a, b])
    if tracks[0].get('setVideoId') != first_id:
        raise AssertionError('Original occurrence did not survive removal; stop.')
    report['status'] = 'PASS_API_READBACK'
    report['officialSiteVerification'] = 'NOT RUN: owner must inspect the new playlist.'


def validate_auth(path, write_test):
    if path is None:
        if write_test:
            raise ValueError('--write-test requires --auth pointing to a private local file.')
        return None
    auth = path.resolve()
    repo = Path(__file__).resolve().parents[1]
    if auth.is_relative_to(repo) or auth.stat().st_mode & 0o077:
        raise ValueError('Auth file must be outside the repository with chmod 600.')
    return auth


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    cases = json.loads(Path(__file__).with_name('cases.json').read_text())
    parser.add_argument('--query', help='Override the first shared search case')
    parser.add_argument('--auth', type=Path, help='Private ytmusicapi browser auth file OUTSIDE this repository')
    parser.add_argument('--write-test', action='store_true', help='Create and modify one NEW private disposable playlist')
    args = parser.parse_args()
    report = {'date': datetime.now(timezone.utc).isoformat(), 'library': 'ytmusicapi', 'account': 'NOT RUN'}
    start = time.monotonic()
    try:
        auth = validate_auth(args.auth, args.write_test)
        from importlib.metadata import version
        from ytmusicapi import YTMusic
        report['version'] = version('ytmusicapi')
        yt = YTMusic(str(auth) if auth else None, location='MY')
        queries = list(cases['queries'])
        if args.query:
            queries[0] = args.query
        report['searchCases'] = []
        for query in queries:
            case_start = time.monotonic()
            songs = yt.search(query, filter='songs', limit=5)
            results = [{'id': song.get('videoId'), 'title': song.get('title')} for song in songs[:5]]
            report['searchCases'].append({'query': query, 'results': results, 'ms': round((time.monotonic() - case_start) * 1000)})
            if not results:
                raise AssertionError('No song results.')
        report['songs'] = report['searchCases'][0]['results']
        listing = yt.get_playlist(cases['playlistId'], limit=20)
        report['publicPlaylist'] = {'id': cases['playlistId'], 'title': listing.get('title'), 'itemsRead': len(listing['tracks']), 'total': listing.get('trackCount')}
        if not listing['tracks']:
            raise AssertionError('No public playlist items.')
        report['status'] = 'PASS_PUBLIC_READS'
        if args.auth:
            report['libraryPlaylistsRead'] = len(yt.get_library_playlists(limit=10))
            report['account'] = 'PASS_LIBRARY_READ'
        if args.write_test:
            a, b = [s['id'] for s in report['songs'][:2]]
            account_check(yt, a, b, report)
    except Exception as error:
        report['status'] = 'FAIL'
        report['errorType'] = type(error).__name__
        # Upstream exception bodies can contain credentials; never print them.
        report['note'] = 'Check local setup/library separately. Readback mismatch may reflect propagation delay. No write is retried; inspect playlistId before another run.'
    report['seconds'] = round(time.monotonic() - start, 3)
    print(json.dumps(report, indent=2))
    return 1 if report['status'] == 'FAIL' else 0


if __name__ == '__main__':
    sys.exit(main())
