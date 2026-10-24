"""Bounded read-only account worker. Credentials and upstream responses stay here."""
import json
import os
from pathlib import Path
import re
import sys

PLAYLIST_ID = re.compile(r'(LM|(?:PL|RD|OL)[A-Za-z0-9_-]{5,120})', re.ASCII)


class ReauthenticationRequired(Exception):
    pass


def text(value, default=''):
    return value[:200] if isinstance(value, str) else default


def validate_request(request):
    if isinstance(request, dict):
        if request in [{'operation': 'library'}, {'operation': 'status'}]:
            return
        if set(request) == {'operation', 'id'} and request['operation'] == 'playlist':
            if isinstance(request['id'], str) and PLAYLIST_ID.fullmatch(request['id']):
                return
    raise ValueError('Unsupported account read')


def verify_account(yt):
    try:
        account = yt.get_account_info()
    except KeyError:
        # The dependency also raises KeyError for logged-out payloads. Confirm that case;
        # a changed parser or network failure alone must not be called an expired login.
        response = yt._send_request('account/account_menu', {})
        signals = {item.get('value')
                   for group in response.get('responseContext', {}).get('serviceTrackingParams', [])
                   for item in group.get('params', []) if item.get('key') == 'logged_in'}
        if signals == {'0'}:
            raise ReauthenticationRequired() from None
        raise
    if not text(account.get('accountName')).strip():
        raise ValueError('Account session could not be verified')


def read_account(yt, request):
    validate_request(request)
    verify_account(yt)
    if request['operation'] == 'status':
        return {'state': 'connected'}
    if request['operation'] == 'playlist':
        playlist = yt.get_playlist(request['id'], limit=100)
        items = []
        for track in playlist['tracks'][:100]:
            identifier = track.get('videoId')
            artists = track.get('artists')
            names = [text(artist.get('name')) for artist in artists[:10] if isinstance(artist, dict)] if isinstance(artists, list) else []
            items.append({'id': identifier if isinstance(identifier, str) and re.fullmatch(r'[A-Za-z0-9_-]{11}', identifier) else None,
                          'title': text(track.get('title'), 'Unavailable track'), 'artists': ', '.join(names)[:200]})
        total = playlist.get('trackCount')
        total = total if type(total) is int and total >= 0 else None
        # ytmusicapi infers PUBLIC for non-owned lists, including unlisted ones.
        privacy = playlist.get('privacy') if playlist.get('owned') is True else None
        return {'id': request['id'], 'title': text(playlist.get('title'), 'Untitled playlist'),
                'privacy': privacy if privacy in ['PRIVATE', 'PUBLIC', 'UNLISTED'] else 'UNKNOWN',
                'items': items, 'limit': 100, 'total': total, 'complete': total is not None and total == len(items)}
    playlists = yt.get_library_playlists(limit=50)
    items = []
    for entry in playlists[:50]:
        identifier = entry.get('playlistId')
        items.append({'id': identifier if isinstance(identifier, str) and PLAYLIST_ID.fullmatch(identifier) else None,
                      'title': text(entry.get('title'), 'Untitled playlist')})
    return {'items': items, 'limit': 50, 'complete': False}


def failure(code=None):
    body = {'ok': False, 'error': 'Account read failed.'}
    if code:
        body['code'] = code
    print(json.dumps(body))
    return 1


def main():
    try:
        raw = sys.stdin.read(4097)
        if len(raw) > 4096:
            raise ValueError('Request too large')
        request = json.loads(raw)
        validate_request(request)  # Reject unsupported operations before account/session setup.
        from music_probe import validate_auth
        try:
            auth = validate_auth(Path(os.environ['CODA_ACCOUNT_AUTH']), False)
        except (OSError, ValueError):
            return failure('ACCOUNT_SETUP_REQUIRED')
        from ytmusicapi import YTMusic
        result = read_account(YTMusic(str(auth), location='MY'), request)
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=True, allow_nan=False))
        return 0
    except ReauthenticationRequired:
        return failure('ACCOUNT_REAUTH_REQUIRED')
    except Exception:
        # Never serialize exception text, raw headers, account context or upstream responses.
        return failure()


if __name__ == '__main__':
    sys.exit(main())
