"""Regression checks for the editable catalog; all mutations use temporary copies."""
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).with_name('build-food-catalog.py'))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class CatalogTests(unittest.TestCase):
    def setUp(self):
        parent = catalog.ROOT / 'temp'
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.table = Path(self.temp.name) / 'food.xlsx'
        self.table.write_bytes((catalog.ROOT / 'config/food-catalog.xlsx').read_bytes())
        self.output = Path(self.temp.name) / 'food.json'

    def change(self, updates):
        parts, name, xml, rows = catalog.read_table(self.table)
        for address, text in updates.items():
            cell = next(c for c in xml.iter(catalog.Q+'c') if c.get('r') == address)
            for child in list(cell): cell.remove(child)
            cell.set('t','inlineStr')
            ET.SubElement(ET.SubElement(cell,catalog.Q+'is'),catalog.Q+'t').text = text
        parts[name] = ET.tostring(xml, encoding='utf-8',xml_declaration=True)
        with zipfile.ZipFile(self.table,'w') as z:
            for part, data in parts.items(): z.writestr(part,data)

    def test_complete_catalog_and_stable_output(self):
        report = catalog.build(self.table,self.output)
        self.assertEqual((report['foods'],report['linked'],report['unlinked']),(40,30,10))
        foods = json.loads(self.output.read_text(encoding='utf-8'))['foods']
        self.assertEqual(len({f['id'] for f in foods}),40)
        for food in foods:
            self.assertTrue((catalog.ROOT/food['assetPath']).is_file())
            self.assertTrue(food['spriteFrameUuid'].startswith(food['assetUuid']+'@'))
        before = Path(str(self.output)+'.meta').read_bytes()
        catalog.build(self.table,self.output)
        self.assertEqual(before,Path(str(self.output)+'.meta').read_bytes())

    def test_unique_uuid_repairs_path_and_filename(self):
        self.change({'F2':'wrong.jpg','G2':'assets/missing/wrong.jpg'})
        before = self.table.read_bytes()
        self.assertEqual(len(catalog.build(self.table,self.output,True)['fixes']),2)
        self.assertEqual(before,self.table.read_bytes())
        self.assertFalse(self.output.exists())
        catalog.build(self.table,self.output)
        self.assertEqual(catalog.build(self.table,self.output,True)['fixes'],[])

    def test_missing_asset_keeps_last_good_output(self):
        self.output.write_text('last good')
        self.change({'H2':'unknown-uuid','G2':'missing'})
        before = self.table.read_bytes()
        with self.assertRaises(ValueError): catalog.build(self.table,self.output)
        self.assertEqual(self.output.read_text(),'last good')
        self.assertEqual(self.table.read_bytes(),before)

    def test_ambiguous_filename_rejected(self):
        self.change({'H2':'','F2':'scene-a.jpg','G2':'missing'})
        with self.assertRaisesRegex(ValueError,'匹配到'): catalog.build(self.table,self.output)

    def test_duplicate_level_rejected(self):
        self.change({'E3':'level-03'})
        with self.assertRaisesRegex(ValueError,'关卡重复'): catalog.build(self.table,self.output)

    def test_invalid_city_or_level_rejected(self):
        self.change({'C2':'../'})
        with self.assertRaisesRegex(ValueError,'城市ID格式错误'): catalog.build(self.table,self.output)

    def test_content_limits_and_name_correction(self):
        catalog.build(self.table,self.output)
        foods = json.loads(self.output.read_text(encoding='utf-8'))['foods']
        for food in foods:
            self.assertTrue(0 < len(food['desc']) <= 40)
            self.assertEqual(len(food['reviews']),10)
            self.assertEqual(len(set(food['reviews'])),10)
            self.assertTrue(all(2 <= len(s) <= 20 for s in food['reviews']))
        bao = next(f for f in foods if f['id'].endswith('-NanXiangXiaoLongBao'))
        self.assertEqual(bao['name'],'南京小笼包')

    def test_invalid_copy_preserves_last_good_output(self):
        original = self.table.read_bytes()
        samples = [({'I2':'字'*41},'介绍'), ({'J2':'字'},'2至20'),
                   ({'J2':'字'*21},'2至20'), ({'J2':'好吃'},'10条'),
                   ({'J2':'|'.join(['好吃']*10)},'重复')]
        for update, error in samples:
            with self.subTest(update=update):
                self.table.write_bytes(original)
                self.output.write_text('last good')
                self.change(update)
                with self.assertRaisesRegex(ValueError,error): catalog.build(self.table,self.output)
                self.assertEqual(self.output.read_text(),'last good')


if __name__ == '__main__': unittest.main()
