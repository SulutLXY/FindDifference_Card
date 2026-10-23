import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('manifest', Path(__file__).with_name('build-manifest.py'))
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class ManifestTests(unittest.TestCase):
    def test_topic_order_preserves_existing_city_keys(self):
        keys = ['city-02-beijing', 'city-PetStory', 'city-2025Hotmeme', 'city-01-2026Hotmeme', 'city-00-HotTips']
        self.assertEqual(sorted(keys, key=manifest.city_sort_key), [
            'city-00-HotTips', 'city-01-2026Hotmeme', 'city-PetStory', 'city-2025Hotmeme', 'city-02-beijing'])

    def test_missing_declared_level_does_not_rewrite_any_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'levels'
            config = root / 'city-Test' / 'configs' / 'city.json'
            config.parent.mkdir(parents=True)
            original = json.dumps({'name': 'Test', 'levels': ['level-01', 'level-02']})
            config.write_text(original, encoding='utf-8')
            index = Path(directory) / 'cities.json'
            index.write_text('original index', encoding='utf-8')
            with patch.object(manifest, 'LEVELS_ROOT', str(root)), patch.object(manifest, 'CITY_INDEX_PATH', str(index)):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(manifest.main(), 1)
                self.assertIn('differences.json', output.getvalue())
            self.assertEqual(config.read_text(encoding='utf-8'), original)
            self.assertEqual(index.read_text(encoding='utf-8'), 'original index')


if __name__ == '__main__':
    unittest.main()
