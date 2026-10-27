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
    def test_adding_chapter_keeps_old_manifest_bytes_and_ignores_legacy_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'levels'
            index = Path(directory) / 'cities.json'

            def add_level(city, level):
                (root / city / level).mkdir(parents=True)
                config = root / city / 'configs' / level / 'differences.json'
                config.parent.mkdir(parents=True)
                config.write_text('{}', encoding='utf-8')

            add_level('city-Old', 'level-01')
            source = root / 'city-Old' / 'configs' / 'city.json'
            # 保留旧规则及非默认格式，纯新增章节不能碰旧包，甚至不能重写同内容文件。
            original = json.dumps({'name': 'Old', 'levels': ['level-01'],
                                   'banner': 'chapter-covers/city-Old-icon/spriteFrame',
                                   'unlockMode': 'rewarded', 'prerequisiteCity': 'city-Other'}, indent=4).encode()
            source.write_bytes(original)
            original_mtime = source.stat().st_mtime_ns
            with patch.object(manifest, 'LEVELS_ROOT', str(root)), \
                    patch.object(manifest, 'CITY_INDEX_PATH', str(index)), \
                    patch.object(manifest, 'check_level', return_value=[]), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(manifest.main(), 0)
                add_level('city-New', 'level-01')
                self.assertEqual(manifest.main(), 0)
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(source.stat().st_mtime_ns, original_mtime)
                new_source = root / 'city-New' / 'configs' / 'city.json'
                self.assertNotIn('unlockMode', json.loads(new_source.read_text(encoding='utf-8')))
                chapters = json.loads(index.read_text(encoding='utf-8'))['chapters']
                self.assertEqual(set(chapters), {'city-Old', 'city-New'})
                for chapter in chapters.values():
                    self.assertNotIn('unlockMode', chapter)
                    self.assertNotIn('prerequisiteCity', chapter)
                before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (source, new_source, index)}
                self.assertEqual(manifest.main(), 0)
                self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})
                add_level('city-New', 'level-02')
                self.assertEqual(manifest.main(), 0)
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(json.loads(new_source.read_text(encoding='utf-8'))['levels'], ['level-01', 'level-02'])

    def test_topic_order_preserves_existing_city_keys(self):
        keys = ['city-02-beijing', 'city-PetThreeKingdoms', 'city-PetStory', 'city-2025Hotmeme', 'city-01-2026Hotmeme', 'city-00-HotTips']
        self.assertEqual(sorted(keys, key=manifest.city_sort_key), [
            'city-00-HotTips', 'city-01-2026Hotmeme', 'city-PetStory', 'city-PetThreeKingdoms', 'city-2025Hotmeme', 'city-02-beijing'])

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
