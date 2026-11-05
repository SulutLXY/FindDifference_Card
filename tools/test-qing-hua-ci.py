"""Verify staged porcelain assets, source preservation, mappings and draft isolation."""
import hashlib
import json
import re
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PorcelainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapping = read(ROOT / 'config/qing-hua-ci-source-map.json')
        cls.catalog = read(ROOT / 'assets/resources/configs/porcelain-catalog.json')['items']
        cls.chapter = ROOT / 'assets/Bundle/levels/qing-hua-ci'
        cls.manifest = read(cls.chapter / 'configs/city.json')

    def test_icons_are_512_and_preserve_alpha_composition(self):
        self.assertEqual(len(self.catalog), 20)
        for item, row in zip(self.catalog, self.mapping['icons']):
            target = ROOT / item['assetPath']
            self.assertRegex(target.stem, r'^[a-z]+(?:-[a-z]+)*$')
            with Image.open(target) as im:
                self.assertEqual(im.size, (512, 512))
                self.assertIn(im.mode, ('RGBA', 'P'))
                source = Path(self.mapping['sourceIcons']) / row['sourceFile']
                self.assertEqual(sha(source), row['sourceSha256'])
                with Image.open(source) as original:
                    expected = original.convert('RGBA').resize((512, 512), Image.Resampling.LANCZOS)
                    report_path = ROOT / 'config/png-compression-2026-11-05.json'
                    records = read(report_path)['files'] if report_path.exists() else []
                    record = next((row for row in records if row['path'] == item['assetPath'] and row['afterSha256'] == sha(target)), None)
                    if record:
                        self.assertEqual(hashlib.sha256(expected.tobytes()).hexdigest(), record['rgbaBeforeSha256'])
                        self.assertEqual(hashlib.sha256(im.convert('RGBA').tobytes()).hexdigest(), record['rgbaAfterSha256'])
                        self.assertEqual(expected.getchannel('A').point(lambda value: 255 if value == 0 else 0).tobytes(),
                                         im.convert('RGBA').getchannel('A').point(lambda value: 255 if value == 0 else 0).tobytes())
                        if record['mode'] == 'palette256':
                            self.assertGreaterEqual(record['visiblePSNR'], 35)
                    else:
                        self.assertEqual(im.convert('RGBA').tobytes(), expected.tobytes(), 'whole artwork and alpha must be retained')
            meta = read(Path(str(target) + '.meta'))
            self.assertEqual(meta['uuid'], item['assetUuid'])
            frame = meta['subMetas']['f9941']
            self.assertEqual(frame['uuid'], item['spriteFrameUuid'])
            self.assertEqual((frame['userData']['rawWidth'], frame['userData']['rawHeight']), (512, 512))
            self.assertEqual(frame['userData']['trimType'], 'none')

    def test_every_third_level_collectible_mapping(self):
        self.assertEqual(len({item['id'] for item in self.catalog}), 20)
        for number, (item, source) in enumerate(zip(self.catalog, self.mapping['icons']), 1):
            level = self.manifest['levels'][number * 3 - 1]
            self.assertEqual(item['category'], 'porcelain')
            self.assertEqual(item['assetNumber'], number)
            self.assertEqual(item['levelKey'], level['id'])
            self.assertEqual(source['acquisitionNumber'], number * 3)
        self.assertEqual(self.catalog[7]['name'], '四爱图梅瓶')
        self.assertEqual(self.catalog[7]['levelKey'], 'qing-hua-ci/qing-hua-dai-jin-shu-fang')
        self.assertEqual(self.manifest['levels'][23]['name'], '青花带进书房')

    def test_named_levels_and_available_markings(self):
        self.assertEqual(len(self.manifest['levels']), 60)
        self.assertEqual(len({row['folder'] for row in self.manifest['levels']}), 60)
        for entry, row in zip(self.manifest['levels'], self.mapping['levels']):
            self.assertEqual(entry['id'], row['id'])
            self.assertEqual(entry['name'], row['name'])
            self.assertRegex(entry['folder'], r'^[a-z]+(?:-[a-z]+)*$')
            self.assertNotRegex(entry['id'], r'level-\d+')
            configs = self.chapter / 'configs' / entry['folder']
            if row['status'] == 'marked':
                source = Path(self.mapping['sourceLevels']) / row['sourceFolder'] / row['sourceConfig']
                original = read(source)
                imported = read(configs / 'differences.json')
                self.assertEqual(imported['differences'], original['differences'])
                self.assertEqual(sha(source), row['configSha256'])
                self.assertFalse((configs / 'pending.json').exists())
                self.assertEqual(imported.get('collectibleId'), row['collectibleId'])
            else:
                self.assertFalse((configs / 'differences.json').exists(), 'missing markings cannot masquerade as a playable level')
                pending = read(configs / 'pending.json')
                self.assertEqual(pending['status'], 'awaiting-differences')
                self.assertEqual(pending['id'], entry['id'])
                if row['collectibleId']:
                    self.assertEqual(pending['collectibleId'], row['collectibleId'])
            with Image.open(self.chapter / 'thumbnails' / entry['folder'] / 'icon.jpg') as image:
                self.assertEqual(image.size, (306, 200))
            for target, source in zip(row['images'], row['sourceImages']):
                asset = ROOT / target
                self.assertEqual(sha(asset), source['importedSha256'])
                original = Path(self.mapping['sourceLevels']) / row['sourceFolder'] / source['file']
                self.assertEqual(sha(original), source['sha256'])
                with Image.open(asset) as image:
                    self.assertEqual(image.format, 'JPEG')
                    self.assertEqual(image.size, (1024, 672))
                    self.assertEqual(asset.name, 'scene-a.jpg' if target == row['images'][0] else 'scene-b.jpg')
                    frame = read(Path(str(asset) + '.meta'))['subMetas']['f9941']['userData']
                    self.assertEqual((frame['rawWidth'], frame['rawHeight']), image.size)
        self.assertEqual(len(list(self.chapter.rglob('pending.json'))), 0)
        self.assertEqual(len(list(self.chapter.rglob('*.png'))), 0)
        self.assertEqual(self.mapping['imageExport']['quality'], 8)
        self.assertEqual(self.mapping['imageExport']['qualityScale'], 12)
        self.assertTrue(self.mapping['imageExport']['encoder'].startswith('Photoshop '))

    def test_published_index_and_remote_bundle(self):
        index = read(ROOT / 'assets/resources/configs/cities.json')
        order = read(ROOT / 'config/chapter-order.json')
        self.assertIn('qing-hua-ci', index['cities'])
        self.assertIn('qing-hua-ci', order['chapters'])
        self.assertIn('qing-hua-ci', order['navigation'])
        self.assertTrue(self.mapping['published'])
        self.assertEqual(index['chapters']['qing-hua-ci']['levels'], self.manifest['levels'])
        meta = read(Path(str(self.chapter) + '.meta'))
        self.assertTrue(meta['userData']['isBundle'])
        self.assertEqual(meta['userData']['bundleName'], 'qing-hua-ci')
        config = read(ROOT / 'settings/v2/packages/builder.json')['bundleConfig']['custom'][meta['userData']['bundleConfigID']]
        self.assertTrue(config['configs']['miniGame']['fallbackOptions']['isRemote'])
        self.assertEqual(len(read(ROOT / 'assets/resources/configs/food-catalog.json')['foods']), 40)

    def test_asset_metadata_is_complete_and_unique(self):
        new_assets = [*self.chapter.rglob('*'), *(ROOT / 'assets/Bundle/food-icons/qing-hua-ci').rglob('*')]
        for path in new_assets:
            if path.suffix != '.meta':
                self.assertTrue(Path(str(path) + '.meta').is_file(), str(path))
        ids = set()
        for path in (ROOT / 'assets').rglob('*.meta'):
            data = read(path)
            for identity in [data['uuid'], *[sub['uuid'] for sub in data.get('subMetas', {}).values()]]:
                self.assertNotIn(identity, ids, str(path))
                ids.add(identity)


if __name__ == '__main__':
    unittest.main()
