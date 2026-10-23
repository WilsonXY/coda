import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('account_probe', Path(__file__).resolve().parents[1] / 'scripts' / 'music_probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Account:
    def __init__(self):
        self.tracks = []
        self.writes = []

    def create_playlist(self, title, description, privacy_status, video_ids):
        assert privacy_status == 'PRIVATE'
        self.tracks = [{'videoId': v, 'setVideoId': str(i)} for i, v in enumerate(video_ids)]
        return 'PLcoda_created'

    def get_playlist(self, playlist_id, **kwargs):
        assert playlist_id == 'PLcoda_created'
        return {'tracks': [dict(t) for t in self.tracks]}

    def add_playlist_items(self, playlist_id, videoIds, duplicates):
        self.writes.append(playlist_id)
        assert duplicates
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
        assert videos[0]['setVideoId'] == 'duplicate'
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


if __name__ == '__main__':
    unittest.main()
