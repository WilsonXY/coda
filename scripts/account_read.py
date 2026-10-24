"""Bounded read-only account worker. Credentials and upstream responses stay here."""
import json
import os
from pathlib import Path
import re
import sys

PLAYLIST_ID = re.compile(r'(LM|(?:PL|RD|OL)[A-Za-z0-9_-]{5,120})', re.ASCII)


def text(value, default=''):
    return value[:200] if isinstance(value, str) else default


def validate_request(request):
    if isinstance(request, dict):
        if request == {'operation': 'library'}:
            return
        if set(request) == {'operation', 'id'} and request['operation'] == 'playlist':
            if isinstance(request['id'], str) and PLAYLIST_ID.fullmatch(request['id']):
                return
    raise ValueError('Unsupported account read')


def read_account(yt, request):
    validate_request(request)
    if not text(yt.get_account_info().get('accountName')).strip():
        raise ValueError('Account session could not be verified')
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
        privacy = playlist.get('privacy')
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


def main():
    try:
        raw = sys.stdin.read(4097)
        if len(raw) > 4096:
            raise ValueError('Request too large')
        request = json.loads(raw)
        validate_request(request)  # Reject unsupported operations before account/session setup.
        from music_probe import validate_auth
        auth = validate_auth(Path(os.environ['CODA_ACCOUNT_AUTH']), False)
        from ytmusicapi import YTMusic
        result = read_account(YTMusic(str(auth), location='MY'), request)
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=True, allow_nan=False))
        return 0
    except Exception:
        # Never serialize exception text, raw headers, account context or upstream responses.
        print(json.dumps({'ok': False, 'error': 'Account read failed.'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
