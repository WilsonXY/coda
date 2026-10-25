import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import unittest
import sys


class OAuthProbeTests(unittest.TestCase):
    def test_reports_official_and_music_access_separately_without_private_metadata(self):
        path = Path(__file__).resolve().parents[1] / 'scripts/oauth_probe.py'
        self.assertTrue(path.is_file(), 'Read-only OAuth probe is missing')
        spec = importlib.util.spec_from_file_location('oauth_probe', path)
        worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
        calls = []

        def get(url, **kwargs):
            calls.append((url, kwargs))
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'items': [{'id': 'PLWEPAqmCfbhY', 'status': {'privacyStatus': 'private'}}]})

        def client(headers, **kwargs):
            self.assertEqual(headers['authorization'], 'Bearer fixture-access')
            self.assertEqual(headers.get('content-type'), 'application/json')
            return SimpleNamespace(get_account_info=lambda: {'accountName': 'private-identity'}, get_playlist=lambda *a, **k: {
                'title': 'private-title', 'owned': True, 'privacy': 'PRIVATE', 'trackCount': 2,
                'tracks': [{'videoId': identifier} for identifier in ['4D7u5KF7SP8', 'Rgrt_8mXrK8']]})

        modules = {'requests': SimpleNamespace(get=get), 'ytmusicapi': SimpleNamespace(YTMusic=client),
                   'ytmusicapi.helpers': SimpleNamespace(initialize_headers=lambda: {'content-type': 'application/json'})}
        with patch.dict('sys.modules', modules), patch('sys.path', [str(path.parent), *sys.path]):
            result = worker.probe('fixture-access')
        self.assertEqual(result, {'dataApiPrivatePlaylist': True, 'privatePlaylist': True, 'expectedOrder': True})
        self.assertNotIn('private-title', str(result)); self.assertNotIn('fixture-access', str(result))
        self.assertEqual(calls[0][1]['headers']['Authorization'], 'Bearer fixture-access')
        self.assertEqual(calls[0][1]['timeout'], 5)
        modules['ytmusicapi'] = SimpleNamespace(YTMusic=lambda *a, **k: (_ for _ in ()).throw(ValueError('private-secret')))
        with patch.dict('sys.modules', modules), patch('sys.path', [str(path.parent), *sys.path]):
            result = worker.probe('fixture-access')
        self.assertEqual(result, {'dataApiPrivatePlaylist': True, 'privatePlaylist': False, 'expectedOrder': False})


if __name__ == '__main__':
    unittest.main()
