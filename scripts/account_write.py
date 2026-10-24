"""One non-retried add/move/remove cycle, confined to the existing disposable playlist."""
import json
import os
from pathlib import Path
import sys

PLAYLIST_ID = 'PLWEPAqmCfbhY'
TITLE = 'Coda experiment 2026-10-24T15:21:56+00:00'
DESCRIPTION = 'Disposable Coda test. Only this newly created playlist is modified. Delete after inspecting.'
A, B = '4D7u5KF7SP8', 'Rgrt_8mXrK8'
STOP = 'Inspect the disposable playlist and local journal before any further writes. This test never retries.'


def run_test(yt, journal):
    journal = Path(journal).resolve()
    if journal.is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError('Journal must be outside the checkout')
    try:
        descriptor = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return {'status': 'ALREADY_STARTED', 'playlistId': PLAYLIST_ID, 'steps': [], 'note': STOP}
    report = {'status': 'RUNNING', 'playlistId': PLAYLIST_ID, 'steps': [], 'attemptedWrites': []}
    with os.fdopen(descriptor, 'w') as handle:
        def save():
            handle.seek(0)
            handle.write(json.dumps(report, indent=2) + '\n')
            handle.truncate()
            handle.flush()
            os.fsync(handle.fileno())

        def readback(action, expected, expected_prefix=None):
            listing = yt.get_playlist(PLAYLIST_ID, limit=20)
            if (listing.get('id') != PLAYLIST_ID or listing.get('owned') is not True or
                    listing.get('privacy') != 'PRIVATE' or listing.get('title') != TITLE or
                    listing.get('description') != DESCRIPTION or listing.get('trackCount') != len(expected)):
                raise ValueError('Disposable playlist guard failed')
            tracks = listing['tracks']
            order = [track.get('videoId') for track in tracks]
            items = [track.get('setVideoId') for track in tracks]
            if (order != expected or not all(isinstance(item, str) and 0 < len(item) <= 512 for item in items)
                    or len(set(items)) != len(items) or (expected_prefix is not None and items[:len(expected_prefix)] != expected_prefix)):
                raise ValueError('Playlist order or item identity guard failed')
            report['steps'].append({'action': action, 'order': order, 'private': True, 'owned': True})
            save()
            return items

        def attempt(action):
            report['attemptedWrites'].append(action)
            save()  # Durably record intent before the one remote call; an existing journal blocks another run.

        try:
            save()
            directory = os.open(journal.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            name = yt.get_account_info().get('accountName')
            if not isinstance(name, str) or not name.strip():
                raise ValueError('Account identity unavailable')
            original = readback('inspect test playlist', [A, B])
            attempt('add duplicate')
            yt.add_playlist_items(PLAYLIST_ID, videoIds=[A], duplicates=True)
            added = readback('add duplicate', [A, B, A], original)
            duplicate = added[2]
            attempt('move duplicate')
            yt.edit_playlist(PLAYLIST_ID, moveItem=(duplicate, original[0]))
            readback('move duplicate', [A, A, B], [duplicate, *original])
            attempt('remove duplicate')
            yt.remove_playlist_items(PLAYLIST_ID, [{'videoId': A, 'setVideoId': duplicate}])
            readback('remove duplicate', [A, B], original)
            report['status'] = 'PASS_API_READBACK'
        except Exception:
            report['status'] = 'FAIL_STOP'
            report['note'] = STOP  # No upstream exception, identity, tokens or playlist-item IDs leave this worker.
        save()
    return report


def main():
    try:
        raw = sys.stdin.read(4097)
        if len(raw) > 4096 or json.loads(raw) != {'operation': 'playlist-test'}:
            raise ValueError('Unsupported playlist test request')
        from music_probe import validate_auth
        auth = validate_auth(Path(os.environ['CODA_ACCOUNT_AUTH']), False)
        from ytmusicapi import YTMusic
        report = run_test(YTMusic(str(auth), location='MY'), os.environ['CODA_ACCOUNT_TEST_JOURNAL'])
        print(json.dumps({'ok': True, 'data': report}))
        return 0  # A completed request can report FAIL_STOP; the result never claims that it passed.
    except Exception:
        print(json.dumps({'ok': False, 'error': 'Playlist test could not complete.'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
