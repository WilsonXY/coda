"""Public comparison, or an explicit write test confined to one new private playlist."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time


def account_check(yt, a, b, report):
    playlist_id = yt.create_playlist(
        title='Coda experiment ' + datetime.now(timezone.utc).isoformat(timespec='seconds'),
        description='Disposable Coda test. Only this newly created playlist is modified. Delete after inspecting.',
        privacy_status='PRIVATE', video_ids=[a, b])
    if not (isinstance(playlist_id, str) and re.fullmatch(r'PL[\w-]+', playlist_id)):
        raise AssertionError('No new playlist ID; stop.')
    report['playlistId'] = playlist_id
    report['steps'] = []

    def readback(stage, expected):
        tracks = yt.get_playlist(playlist_id, limit=20)['tracks']
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
    readback('remove exact duplicate', [a, b])
    report['status'] = 'PASS_API_READBACK'
    report['officialSiteVerification'] = 'NOT RUN: owner must inspect the new playlist.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--query', default='Daft Punk Get Lucky')
    parser.add_argument('--auth', type=Path, help='Private ytmusicapi browser auth file OUTSIDE this repository')
    parser.add_argument('--write-test', action='store_true', help='Create and modify one NEW private disposable playlist')
    args = parser.parse_args()
    report = {'date': datetime.now(timezone.utc).isoformat(), 'library': 'ytmusicapi', 'account': 'NOT RUN'}
    start = time.monotonic()
    try:
        from importlib.metadata import version
        from ytmusicapi import YTMusic
        report['version'] = version('ytmusicapi')
        if args.auth:
            auth = args.auth.resolve()
            repo = Path(__file__).resolve().parents[1]
            if auth.is_relative_to(repo) or auth.stat().st_mode & 0o077:
                raise ValueError('Auth file must be outside the repository with chmod 600.')
        elif args.write_test:
            raise ValueError('--write-test requires --auth pointing to a private local file.')
        yt = YTMusic(str(args.auth) if args.auth else None, location='MY')
        songs = yt.search(args.query, filter='songs', limit=5)
        report['songs'] = [{'id': s.get('videoId'), 'title': s.get('title')} for s in songs[:5]]
        if not (report['songs']):
            raise AssertionError('No song results.')
        playlists = yt.search('Daft Punk', filter='playlists', limit=3)
        if not (playlists):
            raise AssertionError('No playlist results.')
        listing = yt.get_playlist(playlists[0]['browseId'], limit=20)
        report['publicPlaylist'] = {'id': listing.get('id'), 'title': listing.get('title'), 'itemsRead': len(listing['tracks']), 'total': listing.get('trackCount')}
        if not (listing['tracks']):
            raise AssertionError('No public playlist items.')
        report['status'] = 'PASS_PUBLIC_READS'
        if args.auth:
            report['libraryPlaylistsRead'] = len(yt.get_library_playlists(limit=10))
            report['account'] = 'PASS_LIBRARY_READ'
        if args.write_test:
            a, b = [s['id'] for s in report['songs'][:2]]
            if not (a != b):
                raise AssertionError('Two different tracks required.')
            account_check(yt, a, b, report)
    except Exception as error:
        report['status'] = 'FAIL'
        report['errorType'] = type(error).__name__
        # Upstream exception bodies can contain credentials; never print them.
        report['note'] = 'Check local setup/library separately. No write is retried; inspect playlistId if present.'
    report['seconds'] = round(time.monotonic() - start, 3)
    print(json.dumps(report, indent=2))
    return 1 if report['status'] == 'FAIL' else 0


if __name__ == '__main__':
    sys.exit(main())
