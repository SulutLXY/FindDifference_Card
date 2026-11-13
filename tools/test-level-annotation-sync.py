"""Validate real authoring updates, preserved runtime metadata and normalized point bounds."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('annotation_sync', Path(__file__).with_name('sync-level-annotations.py'))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class AnnotationSyncTests(unittest.TestCase):
    def test_real_sources_synchronized(self):
        rows, counts = sync.plan()
        self.assertEqual(counts, {'qing-hua-ci': 45, 'wang-luo-re-dian': 10})
        for row in rows:
            self.assertEqual(row['old'], row['new'], sync.rel(row['target']))
            self.assertEqual(row['old']['differences'], row['sourceData']['differences'])

    def test_audit_and_preserved_fields(self):
        audit = sync.read(sync.ROOT / 'config/level-config-updates/2026-11-13.json')
        before = sync.read(sync.ROOT / audit['backup'])
        self.assertEqual(len(audit['updatedLevels']), 55)
        self.assertEqual(len({row['id'] for row in audit['updatedLevels']}), 55)
        for row in audit['updatedLevels']:
            source, target = (sync.ROOT / row[key] for key in ('source', 'target'))
            self.assertEqual(sync.sha(source.read_bytes()), row['sourceSha256'])
            self.assertEqual(sync.sha(target.read_bytes()), row['configSha256'])
            original, current = copy.deepcopy(before[row['target']]), sync.read(target)
            original.pop('differences')
            current.pop('differences')
            self.assertEqual(current, original, row['target'])
            for image in row['images']:
                path = sync.ROOT / image['path']
                self.assertEqual(sync.sha(path.read_bytes()), image['sha256'])
                self.assertEqual(sync.sha(Path(str(path) + '.meta').read_bytes()), image['metaSha256'])

    def test_large_author_radius_is_preserved(self):
        for radius in (0.203021, 0.219801, 1):
            sync.validate_points([dict(id='edge', x=1, y=0, radius=radius)], 'fixture')

    def test_bad_authoring_is_rejected(self):
        valid = dict(id='point', x=.5, y=.5, radius=.05)
        for key, value in [('x', -.01), ('y', 1.01), ('radius', 0), ('radius', 1.01),
                           ('x', float('nan')), ('radius', float('inf')), ('y', True)]:
            point = {**valid, key: value}
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                sync.validate_points([point], 'invalid')
        for points in ([], [valid, valid], [dict(valid, id='')]):
            with self.assertRaises(ValueError):
                sync.validate_points(points, 'invalid')


if __name__ == '__main__':
    unittest.main()
