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
    def setUp(self):
        self.order_patch = patch.object(manifest, 'CHAPTER_ORDER_PATH', '__test_no_chapter_order__.json')
        self.order_patch.start()
        self.addCleanup(self.order_patch.stop)

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

    def test_topic_groups_are_index_only_and_validate_ownership(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'levels'
            topics = Path(directory) / 'topics'
            topics.mkdir()
            order = Path(directory) / 'order.json'
            index = Path(directory) / 'cities.json'
            config = {'chapters': ['city-A', 'city-B'], 'navigation': ['romance-food']}
            order.write_text(json.dumps(config), encoding='utf-8')
            group = {'key': 'romance-food', 'name': '恋爱美食', 'chapters': ['city-A', 'city-B'], 'defaultChapter': 'city-A'}
            topic_file = topics / 'romance-food.json'
            topic_file.write_text(json.dumps(group), encoding='utf-8')
            for key in config['chapters']:
                chapter = root / key / 'configs' / 'city.json'
                chapter.parent.mkdir(parents=True)
                (chapter.parent / 'level-01').mkdir()
                (chapter.parent / 'level-01' / 'differences.json').write_text('{}', encoding='utf-8')
                (root / key / 'level-01').mkdir()
                chapter.write_text(json.dumps({'name': key, 'levels': ['level-01']}), encoding='utf-8')
            with patch.object(manifest, 'LEVELS_ROOT', str(root)), \
                    patch.object(manifest, 'CITY_INDEX_PATH', str(index)), \
                    patch.object(manifest, 'CHAPTER_ORDER_PATH', str(order)), \
                    patch.object(manifest, 'TOPICS_ROOT', str(topics)), \
                    patch.object(manifest, 'check_level', return_value=[]), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(manifest.main(), 0)
                built = json.loads(index.read_text(encoding='utf-8'))
                self.assertEqual(built['navigation'], ['romance-food'])
                self.assertEqual(built['topics'], [group])
                self.assertEqual(sorted(p.name for p in root.iterdir()), ['city-A', 'city-B'])
                baseline = index.read_bytes()
                config['navigation'] = ['city-A', 'romance-food']
                order.write_text(json.dumps(config), encoding='utf-8')
                self.assertEqual(manifest.main(), 1)
                self.assertEqual(index.read_bytes(), baseline)
                config['navigation'] = ['romance-food']
                order.write_text(json.dumps(config), encoding='utf-8')
                for invalid in [dict(group, defaultChapter='missing'), dict(group, chapters=['city-A']),
                                dict(group, chapters=['city-A', 'missing']), dict(group, chapters=['city-A', 'city-A'])]:
                    topic_file.write_text(json.dumps(invalid), encoding='utf-8')
                    self.assertEqual(manifest.main(), 1)
                    self.assertEqual(index.read_bytes(), baseline)

    def test_named_levels_follow_explicit_order_and_reject_duplicates_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'levels'
            index = Path(directory) / 'cities.json'
            order = Path(directory) / 'order.json'
            order.write_text(json.dumps({'chapters': ['merged-chapter']}), encoding='utf-8')
            chapter = root / 'merged-chapter' / 'configs' / 'city.json'
            entries = [{'id': 'old-city/level-02', 'name': '后字母先玩', 'folder': 'zui-xian'},
                       {'id': 'permanent-a', 'name': '前字母后玩', 'folder': 'a-zui-hou'}]
            for entry in entries:
                config = chapter.parent / entry['folder'] / 'differences.json'
                config.parent.mkdir(parents=True)
                config.write_text('{}', encoding='utf-8')
                (root / 'merged-chapter' / entry['folder']).mkdir()
            # An unlisted directory must never silently become a playable level.
            (root / 'merged-chapter' / 'level-99').mkdir()
            original = json.dumps({'schemaVersion': 2, 'name': '新章节', 'levels': entries,
                                   'banner': 'chapter-covers/merged-chapter-icon/spriteFrame'}, ensure_ascii=False)
            chapter.write_text(original, encoding='utf-8')
            with patch.object(manifest, 'LEVELS_ROOT', str(root)), \
                    patch.object(manifest, 'CITY_INDEX_PATH', str(index)), \
                    patch.object(manifest, 'CHAPTER_ORDER_PATH', str(order)), \
                    patch.object(manifest, 'check_level', return_value=[]), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(manifest.main(), 0)
                self.assertEqual(chapter.read_text(encoding='utf-8'), original)
                self.assertEqual(json.loads(index.read_text(encoding='utf-8'))['chapters']['merged-chapter']['levels'], entries)
                baseline = index.read_bytes()
                self.assertEqual(manifest.main(), 0)
                self.assertEqual(index.read_bytes(), baseline)
                for field, value in [('id', entries[0]['id']), ('folder', entries[0]['folder']), ('folder', '../bad'), ('name', '')]:
                    invalid = json.loads(original)
                    invalid['levels'][1][field] = value
                    chapter.write_text(json.dumps(invalid), encoding='utf-8')
                    self.assertEqual(manifest.main(), 1)
                    self.assertEqual(index.read_bytes(), baseline)

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
