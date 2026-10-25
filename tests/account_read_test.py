import importlib.util
from pathlib import Path
import unittest
import json
import os
import subprocess
import sys
import io
from contextlib import redirect_stdout
from unittest.mock import patch
from types import SimpleNamespace


class AuthenticatedClient:
    def get_account_info(self):
        return {'accountName': 'Private fixture identity', 'channelHandle': '@fixture'}


class AccountReaderChecks(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[1] / 'scripts' / 'account_read.py'
        self.assertTrue(source.is_file(), 'The backend account reader is missing')
        spec = importlib.util.spec_from_file_location('account_reader', source)
        reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reader)
        self.reader = reader

    def test_library_output_is_bounded_and_contains_only_ui_fields(self):
        class Client(AuthenticatedClient):
            def get_library_playlists(self, limit):
                self.requested = limit
                return [{'playlistId': 'PLfixture123', 'title': '<fixture>' + 'x' * 300,
                         'cookie': 'must-not-return', 'thumbnails': [{'url': 'private'}]}] * 55
        client = Client()
        result = self.reader.read_account(client, {'operation': 'library'})
        self.assertEqual(client.requested, 50)
        self.assertEqual(len(result['items']), 50)
        self.assertEqual(result['limit'], 50)
        self.assertFalse(result['complete'])
        self.assertEqual(set(result['items'][0]), {'id', 'title'})
        self.assertEqual(len(result['items'][0]['title']), 200)
        self.assertNotIn('must-not-return', str(result))

    def test_status_returns_only_connected_after_verifying_identity(self):
        self.assertEqual(self.reader.read_account(AuthenticatedClient(), {'operation': 'status'}), {'state': 'connected'})

    def test_rejected_session_requires_explicit_upstream_logged_out_signal(self):
        self.assertTrue(hasattr(self.reader, 'ReauthenticationRequired'), 'No typed session rejection exists')
        class Client:
            def get_account_info(self):
                raise KeyError('synthetic-private-secret')

            def _send_request(self, endpoint, body):
                self.request = (endpoint, body)
                return {'responseContext': {'serviceTrackingParams': [{'params': self.signals}]}}
        client = Client(); client.signals = [{'key': 'logged_in', 'value': '0'}]
        with self.assertRaises(self.reader.ReauthenticationRequired):
            self.reader.read_account(client, {'operation': 'status'})
        self.assertEqual(client.request, ('account/account_menu', {}))
        for signals in [[], [{'key': 'logged_in', 'value': '1'}], [{'key': 'logged_in', 'value': '0'}, {'key': 'logged_in', 'value': '1'}]]:
            client.signals = signals
            with self.subTest(signals=signals), self.assertRaises(KeyError):
                self.reader.read_account(client, {'operation': 'status'})
        client.get_account_info = lambda: (_ for _ in ()).throw(TimeoutError('synthetic-private-secret'))
        with self.assertRaises(TimeoutError):
            self.reader.read_account(client, {'operation': 'status'})

    def test_playlist_read_projects_tracks_privacy_and_honest_completeness(self):
        class Client(AuthenticatedClient):
            def get_playlist(self, identifier, limit):
                self.arguments = (identifier, limit)
                return {'title': 'Private fixture', 'owned': True, 'privacy': 'PRIVATE', 'trackCount': 103,
                        'cookie': 'must-not-return', 'tracks': [
                            {'videoId': 'aaaaaaaaaaa', 'title': 'Song', 'artists': [{'name': 'Artist'}],
                             'setVideoId': 'private-item-id', 'feedbackTokens': 'must-not-return'}] * 103}
        client = Client()
        result = self.reader.read_account(client, {'operation': 'playlist', 'id': 'PLfixture123'})
        self.assertEqual(client.arguments, ('PLfixture123', 100))
        self.assertEqual(result['privacy'], 'PRIVATE')
        self.assertEqual(len(result['items']), 100)
        self.assertEqual(result['total'], 103)
        self.assertFalse(result['complete'])
        self.assertEqual(result['items'][0], {'id': 'aaaaaaaaaaa', 'title': 'Song', 'artists': 'Artist'})
        self.assertNotIn('must-not-return', str(result))
        client.get_playlist = lambda *args, **kwargs: {'title': 'Empty', 'privacy': 'PRIVATE', 'trackCount': 0, 'tracks': []}
        self.assertTrue(self.reader.read_account(client, {'operation': 'playlist', 'id': 'LM'})['complete'])

    def test_unsupported_input_is_rejected_before_any_client_method(self):
        class Client:
            def __getattr__(self, name):
                raise AssertionError('Unexpected upstream call')
        for request in [None, {'operation': 'delete'}, {'operation': 'library', 'auth': 'override'},
                        {'operation': 'playlist', 'id': 'https://example.test'}, {'operation': 'playlist', 'id': '../file'}]:
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.reader.read_account(Client(), request)

    def test_non_owned_privacy_is_unknown_instead_of_trusting_inferred_public(self):
        class Client(AuthenticatedClient):
            def get_playlist(self, *args, **kwargs):
                return self.playlist
        client = Client()
        for owned, expected in [(False, 'UNKNOWN'), (None, 'UNKNOWN'), (True, 'PUBLIC')]:
            client.playlist = {'owned': owned, 'privacy': 'PUBLIC', 'tracks': [], 'trackCount': 0}
            with self.subTest(owned=owned):
                self.assertEqual(self.reader.read_account(client, {'operation': 'playlist', 'id': 'PLfixture123'})['privacy'], expected)

    def test_worker_rejects_invalid_input_without_disclosing_it(self):
        source = Path(__file__).resolve().parents[1] / 'scripts' / 'account_read.py'
        env = dict(os.environ, CODA_ACCOUNT_AUTH='/nonexistent/coda-test-credentials')
        result = subprocess.run([sys.executable, str(source)], input=json.dumps({'operation': 'write', 'cookie': 'synthetic-secret'}),
                                capture_output=True, text=True, env=env, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {'ok': False, 'error': 'Account read failed.'})
        self.assertNotIn('synthetic-secret', result.stdout + result.stderr)

    def test_unverified_session_cannot_masquerade_as_an_empty_library(self):
        class Client:
            def get_account_info(self):
                return {}

            def get_library_playlists(self, **kwargs):
                raise AssertionError('Must verify the session before library access')
        with self.assertRaises(ValueError):
            self.reader.read_account(Client(), {'operation': 'library'})

    def test_cli_uses_safe_codes_for_rejected_session_and_local_setup(self):
        class Client:
            def get_account_info(self):
                raise KeyError('synthetic-private-secret')

            def _send_request(self, *args):
                return {'responseContext': {'serviceTrackingParams': [{'params': [{'key': 'logged_in', 'value': '0'}]}]}}
        output = io.StringIO()
        modules = {'music_probe': SimpleNamespace(validate_auth=lambda *args: Path('/fixture/private.json')),
                   'ytmusicapi': SimpleNamespace(YTMusic=lambda *args, **kwargs: Client())}
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {'CODA_ACCOUNT_AUTH': '/fixture/private.json'}), patch('sys.stdin', io.StringIO('{"operation":"status"}')), redirect_stdout(output):
            self.assertEqual(self.reader.main(), 1)
        self.assertEqual(json.loads(output.getvalue()), {'ok': False, 'error': 'Account read failed.', 'code': 'ACCOUNT_REAUTH_REQUIRED'})
        self.assertNotIn('synthetic-private-secret', output.getvalue())
        output = io.StringIO()
        modules['music_probe'] = SimpleNamespace(validate_auth=lambda *args: (_ for _ in ()).throw(PermissionError('synthetic-private-secret')))
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {'CODA_ACCOUNT_AUTH': '/nonexistent/coda-test-auth'}), patch('sys.stdin', io.StringIO('{"operation":"status"}')), redirect_stdout(output):
            self.assertEqual(self.reader.main(), 1)
        self.assertEqual(json.loads(output.getvalue())['code'], 'ACCOUNT_SETUP_REQUIRED')


if __name__ == '__main__':
    unittest.main()
