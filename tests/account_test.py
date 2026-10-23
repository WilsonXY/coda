import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location('account_probe', Path(__file__).resolve().parents[1] / 'scripts' / 'music_probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Account:
    def __init__(self):
        self.tracks = []
        self.writes = []
        self.privacy = 'PRIVATE'
        self.created = 0

    def create_playlist(self, title, description, privacy_status, video_ids):
        if privacy_status != 'PRIVATE':
            raise AssertionError('Creation must request PRIVATE')
        self.created += 1
        self.tracks = [{'videoId': v, 'setVideoId': str(i)} for i, v in enumerate(video_ids)]
        return 'PLcoda_created'

    def get_playlist(self, playlist_id, **kwargs):
        if playlist_id != 'PLcoda_created':
            raise AssertionError('Existing playlist accessed')
        return {'privacy': self.privacy, 'tracks': [dict(t) for t in self.tracks]}

    def add_playlist_items(self, playlist_id, videoIds, duplicates):
        self.writes.append(playlist_id)
        if not duplicates:
            raise AssertionError('Duplicate required')
        self.tracks.append({'videoId': videoIds[0], 'setVideoId': 'duplicate'})

    def edit_playlist(self, playlist_id, moveItem):
        self.writes.append(playlist_id)
        moved, before = moveItem
        item = next(t for t in self.tracks if t['setVideoId'] == moved)
        self.tracks.remove(item)
        pos = next(i for i, t in enumerate(self.tracks) if t['setVideoId'] == before)
        self.tracks.insert(pos, item)

    def remove_playlist_items(self, playlist_id, videos):
        self.writes.append(playlist_id)
        if videos[0]['setVideoId'] != 'duplicate':
            raise AssertionError('Wrong occurrence requested')
        self.tracks = [t for t in self.tracks if t['setVideoId'] != videos[0]['setVideoId']]


class AccountChecks(unittest.TestCase):
    def test_changes_are_scoped_to_new_playlist_and_duplicate_occurrence(self):
        account = Account()
        report = {}
        probe.account_check(account, 'aaaaaaaaaaa', 'bbbbbbbbbbb', report)
        self.assertEqual(account.writes, ['PLcoda_created'] * 3)
        self.assertEqual([t['videoId'] for t in account.tracks], ['aaaaaaaaaaa', 'bbbbbbbbbbb'])
        self.assertEqual(len(report['steps']), 4)

    def test_failed_creation_never_falls_back_to_an_existing_playlist(self):
        account = Account()
        account.create_playlist = lambda **kwargs: {'error': 'creation failed'}
        with self.assertRaises(AssertionError):
            probe.account_check(account, 'aaaaaaaaaaa', 'bbbbbbbbbbb', {})
        self.assertEqual(account.writes, [])

    def test_failed_readback_stops_before_the_next_write(self):
        account = Account()
        account.add_playlist_items = lambda *args, **kwargs: None
        with self.assertRaises(AssertionError):
            probe.account_check(account, 'aaaaaaaaaaa', 'bbbbbbbbbbb', {})
        self.assertEqual(account.writes, [])

    def test_public_playlist_readback_stops_before_any_add(self):
        account = Account()
        account.privacy = 'PUBLIC'
        with self.assertRaises(AssertionError):
            probe.account_check(account, 'aaaaaaaaaaa', 'bbbbbbbbbbb', {})
        self.assertEqual(account.writes, [])

    def test_removing_wrong_duplicate_is_detected_by_item_id(self):
        account = Account()
        def remove_wrong(*args):
            account.tracks = [t for t in account.tracks if t['setVideoId'] != '0']
        account.remove_playlist_items = remove_wrong
        with self.assertRaises(AssertionError):
            probe.account_check(account, 'aaaaaaaaaaa', 'bbbbbbbbbbb', {})

    def test_invalid_track_ids_never_create_a_playlist(self):
        for a, b in [(None, 'bbbbbbbbbbb'), ('short', 'bbbbbbbbbbb'), ('aaaaaaaaaaa', 'aaaaaaaaaaa')]:
            with self.subTest(a=a, b=b):
                account = Account()
                with self.assertRaises(AssertionError):
                    probe.account_check(account, a, b, {})
                self.assertEqual(account.created, 0)

    def test_write_test_requires_auth_before_any_network_work(self):
        with self.assertRaises(ValueError):
            probe.validate_auth(None, True)

    def test_auth_inside_repository_is_rejected(self):
        with self.assertRaises(ValueError):
            probe.validate_auth(Path(__file__).resolve(), False)

    def test_auth_permissions_must_be_private(self):
        with tempfile.TemporaryDirectory() as directory:
            auth = Path(directory) / 'auth.json'
            auth.write_text('{}')
            auth.chmod(0o644)
            with self.assertRaises(ValueError):
                probe.validate_auth(auth, False)
            auth.chmod(0o600)
            self.assertEqual(probe.validate_auth(auth, True), auth.resolve())


if __name__ == '__main__':
    unittest.main()
