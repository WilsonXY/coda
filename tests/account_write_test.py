import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import os
import subprocess
import sys
import stat
from unittest.mock import patch


class PlaylistWriteChecks(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[1] / 'scripts' / 'account_write.py'
        self.assertTrue(source.is_file(), 'The one-time playlist worker is missing')
        spec = importlib.util.spec_from_file_location('account_writer', source)
        self.worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.worker)
        self.directory = tempfile.TemporaryDirectory(prefix='coda-write-check-')
        self.addCleanup(self.directory.cleanup)
        self.journal = Path(self.directory.name) / 'journal.json'

    def client(self):
        worker, journal = self.worker, self.journal
        class Client:
            def __init__(self):
                self.items = [{'videoId': worker.A, 'setVideoId': 'original-a'}, {'videoId': worker.B, 'setVideoId': 'original-b'}]
                self.calls = []
                self.privacy = 'PRIVATE'
                self.fail = None

            def get_account_info(self):
                return {'accountName': 'synthetic-private-name'}

            def get_playlist(self, identifier, limit):
                if self.fail == 'readback' and self.calls:
                    raise TimeoutError('synthetic-private-secret')
                return {'id': identifier, 'title': worker.TITLE, 'description': worker.DESCRIPTION,
                        'owned': True, 'privacy': self.privacy, 'trackCount': len(self.items),
                        'tracks': [dict(item) for item in self.items]}

            def before_write(self, identifier, action):
                assert identifier == worker.PLAYLIST_ID
                assert json.loads(journal.read_text())['attemptedWrites'][-1] == action
                self.calls.append(action)

            def add_playlist_items(self, identifier, videoIds, duplicates):
                self.before_write(identifier, 'add duplicate')
                assert videoIds == [worker.A] and duplicates is True
                self.items.append({'videoId': worker.A, 'setVideoId': 'duplicate-a'})
                if self.fail == 'add':
                    raise TimeoutError('synthetic-private-secret')

            def edit_playlist(self, identifier, moveItem):
                self.before_write(identifier, 'move duplicate')
                assert moveItem == ('duplicate-a', 'original-a')
                self.items.insert(0, self.items.pop(2))
                if self.fail == 'move':
                    raise TimeoutError('synthetic-private-secret')

            def remove_playlist_items(self, identifier, videos):
                self.before_write(identifier, 'remove duplicate')
                assert videos == [{'videoId': worker.A, 'setVideoId': 'duplicate-a'}]
                self.items = [item for item in self.items if item['setVideoId'] != 'duplicate-a']
                if self.fail == 'remove':
                    raise TimeoutError('synthetic-private-secret')
        return Client()

    def test_one_time_cycle_records_intent_and_restores_both_original_items(self):
        client = self.client()
        result = self.worker.run_test(client, self.journal)
        self.assertEqual(result['status'], 'PASS_API_READBACK')
        self.assertEqual(client.calls, ['add duplicate', 'move duplicate', 'remove duplicate'])
        self.assertEqual([item['setVideoId'] for item in client.items], ['original-a', 'original-b'])
        self.assertEqual([step['order'] for step in result['steps']], [[self.worker.A, self.worker.B], [self.worker.A, self.worker.B, self.worker.A], [self.worker.A, self.worker.A, self.worker.B], [self.worker.A, self.worker.B]])
        self.assertEqual(self.journal.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.journal.read_text()), result)
        self.assertNotIn('original-a', json.dumps(result))
        self.assertNotIn('synthetic-private-name', json.dumps(result))
        self.assertEqual(self.worker.run_test(client, self.journal)['status'], 'ALREADY_STARTED')
        self.assertEqual(len(client.calls), 3)

    def test_changed_playlist_metadata_or_original_identities_stop_before_writes(self):
        changes = [{'privacy': 'PUBLIC'}, {'owned': False}, {'title': 'Personal playlist'},
                   {'description': ''}, {'id': 'PLdifferent123'}, {'trackCount': 3},
                   {'tracks': [{'videoId': self.worker.A, 'setVideoId': 'same'}, {'videoId': self.worker.B, 'setVideoId': 'same'}]}]
        for index, change in enumerate(changes):
            with self.subTest(change=change):
                self.journal = Path(self.directory.name) / f'guard-{index}.json'
                client = self.client()
                original = client.get_playlist
                client.get_playlist = lambda *args, **kwargs: {**original(*args, **kwargs), **change}
                self.assertEqual(self.worker.run_test(client, self.journal)['status'], 'FAIL_STOP')
                self.assertEqual(client.calls, [])

    def test_ambiguous_mutation_or_failed_readback_never_retries_or_continues(self):
        for stage, expected in [('add', 1), ('readback', 1), ('move', 2), ('remove', 3)]:
            with self.subTest(stage=stage):
                self.journal = Path(self.directory.name) / f'failure-{stage}.json'
                client = self.client(); client.fail = stage
                report = self.worker.run_test(client, self.journal)
                self.assertEqual(report['status'], 'FAIL_STOP')
                self.assertEqual(len(client.calls), expected)
                self.assertEqual(report['attemptedWrites'], client.calls)
                self.assertNotIn('synthetic-private-secret', json.dumps(report))
                self.assertEqual(self.worker.run_test(client, self.journal)['status'], 'ALREADY_STARTED')
                self.assertEqual(len(client.calls), expected)

    def test_invalid_session_or_journal_cannot_start_a_mutation(self):
        client = self.client(); client.get_account_info = lambda: {}
        self.assertEqual(self.worker.run_test(client, self.journal)['status'], 'FAIL_STOP')
        self.assertEqual(client.calls, [])
        self.journal.write_text('')  # A killed worker's empty reservation still blocks another run.
        self.assertEqual(self.worker.run_test(client, self.journal)['status'], 'ALREADY_STARTED')
        with self.assertRaises(ValueError):
            self.worker.run_test(client, Path(__file__).parent / 'must-not-create.json')

    def test_cli_rejects_target_overrides_before_session_setup(self):
        source = Path(__file__).resolve().parents[1] / 'scripts' / 'account_write.py'
        env = dict(os.environ, CODA_ACCOUNT_AUTH='/nonexistent/auth', CODA_ACCOUNT_TEST_JOURNAL=str(self.journal))
        result = subprocess.run([sys.executable, str(source)], input=json.dumps({'operation': 'playlist-test', 'id': 'PLother123', 'cookie': 'synthetic-private-secret'}),
                                capture_output=True, text=True, env=env, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {'ok': False, 'error': 'Playlist test could not complete.'})
        self.assertNotIn('synthetic-private-secret', result.stdout + result.stderr)
        self.assertFalse(self.journal.exists())

    def test_journal_directory_entry_is_synced_before_any_remote_write(self):
        client = self.client()
        synced = []
        real_sync = os.fsync
        def sync(descriptor):
            synced.append('directory' if stat.S_ISDIR(os.fstat(descriptor).st_mode) else 'file')
            return real_sync(descriptor)
        before = client.before_write
        def checked_write(identifier, action):
            self.assertIn('directory', synced, 'The journal name must survive a host crash before a write starts')
            before(identifier, action)
        client.before_write = checked_write
        with patch.object(self.worker.os, 'fsync', side_effect=sync):
            result = self.worker.run_test(client, self.journal)
        self.assertEqual(result['status'], 'PASS_API_READBACK')


if __name__ == '__main__':
    unittest.main()
