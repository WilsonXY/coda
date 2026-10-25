"""Read-only OAuth comparison. Only booleans leave this process; token arrives on stdin."""
import json
import sys


def probe(access_token):
    import requests
    from ytmusicapi import YTMusic
    from ytmusicapi.helpers import initialize_headers
    from account_read import read_account

    result = {'dataApiPrivatePlaylist': False, 'privatePlaylist': False, 'expectedOrder': False}
    try:
        response = requests.get('https://www.googleapis.com/youtube/v3/playlists',
                                params={'part': 'status', 'id': 'PLWEPAqmCfbhY', 'fields': 'items(id,status/privacyStatus)'},
                                headers={'Authorization': 'Bearer ' + access_token}, timeout=5)
        response.raise_for_status()
        result['dataApiPrivatePlaylist'] = any(item.get('id') == 'PLWEPAqmCfbhY' and item.get('status', {}).get('privacyStatus') == 'private'
                                               for item in response.json().get('items', []))
    except Exception:
        pass
    try:
        headers = initialize_headers()
        headers['authorization'] = 'Bearer ' + access_token
        yt = YTMusic(headers, location='MY')
        playlist = read_account(yt, {'operation': 'playlist', 'id': 'PLWEPAqmCfbhY'})
        result['privatePlaylist'] = playlist['privacy'] == 'PRIVATE'
        result['expectedOrder'] = [item['id'] for item in playlist['items']] == ['4D7u5KF7SP8', 'Rgrt_8mXrK8']
    except Exception:
        pass
    return result


if __name__ == '__main__':
    try:
        raw = sys.stdin.read(16385)
        if len(raw) > 16384:
            raise ValueError()
        data = json.loads(raw)
        token = data['accessToken']
        if not isinstance(token, str) or not token or len(token) > 12000:
            raise ValueError()
        print(json.dumps(probe(token)))
    except Exception:
        print('{"error":"OAuth read probe failed."}')
        sys.exit(1)
