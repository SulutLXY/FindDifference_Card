"""Validate config/food-catalog.xlsx, repair unique asset matches, export Cocos JSON.

Uses only the Python standard library. Run with --check for read-only validation.
"""
import argparse
import json
import posixpath
import re
import shutil
import sys
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
Q = '{' + NS['s'] + '}'
HEADERS = ['美食ID', '美食名称', '城市ID', '城市名称', '关卡目录', '素材名称', '资产路径', '素材UUID', '美食介绍', '预设评价', '关联说明']
FOOD_ALIASES = {'南翔小笼': '南京小笼包', '鸭血粉丝': '鸭血粉丝汤', '肉丸糊辣汤': '肉丸胡辣汤'}


def food_name(name):
    name = str(name).strip()
    return FOOD_ALIASES.get(name, name).casefold()


def read_table(path):
    with zipfile.ZipFile(path) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    book = ET.fromstring(parts['xl/workbook.xml'])
    sheet = next(s for s in book.find(Q + 'sheets') if s.get('name') == '美食配置')
    rid = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
    rel = next(r for r in ET.fromstring(parts['xl/_rels/workbook.xml.rels']) if r.get('Id') == rid)
    target = rel.get('Target')
    name = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
    xml = ET.fromstring(parts[name])
    strings = []
    if 'xl/sharedStrings.xml' in parts:
        strings = [''.join(e.itertext()) for e in ET.fromstring(parts['xl/sharedStrings.xml'])]
    def value(c):
        if c.find(Q + 'f') is not None:
            raise ValueError('配置单元格不能使用公式: ' + c.get('r'))
        if c.get('t') == 'inlineStr':
            return ''.join(c.find(Q + 'is').itertext())
        v = c.findtext(Q + 'v', '')
        return strings[int(v)] if c.get('t') == 's' else v
    rows = []
    for row in xml.findall('s:sheetData/s:row', NS):
        cells = {''.join(filter(str.isalpha, c.get('r'))): c for c in row}
        values = [value(cells[chr(65+i)]) if chr(65+i) in cells else '' for i in range(len(HEADERS))]
        if not any(values): continue
        if not rows and values != HEADERS: raise ValueError('第一行字段不匹配')
        rows.append((row, cells, values))
    if len(rows) < 2: raise ValueError('表格没有美食数据')
    return parts, name, xml, rows[1:]


def build(table, output, check=False):
    parts, sheet_name, xml, rows = read_table(table)
    bundle = ROOT / 'assets/Bundle'
    images = sorted(p for p in bundle.rglob('*') if p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'})
    metadata = {}
    for p in images:
        m = Path(str(p) + '.meta')
        if m.exists(): metadata[p] = json.loads(m.read_text(encoding='utf-8-sig'))
    errors, fixes, foods, ids, levels = [], [], [], set(), set()
    cities = set(json.loads((bundle/'levels/cities.json').read_text(encoding='utf-8-sig'))['cities'])
    for row, cells, v in rows:
        try:
            id_, food, city, city_name, level, asset, path, asset_uuid, desc, reviews, note = [x.strip() for x in v]
            preset_reviews = [s.strip() for s in reviews.split('|') if s.strip()]
            if len(desc) > 40: raise ValueError('美食介绍不能超过40字（含标点）')
            if any(not 2 <= len(s) <= 20 for s in preset_reviews): raise ValueError('每条预设评价须为2至20字（含标点）')
            if preset_reviews and len(preset_reviews) != 10: raise ValueError('填写预设评价时须为10条，以 | 分隔')
            if len(set(preset_reviews)) != len(preset_reviews): raise ValueError('同一道美食的预设评价不能重复')
            if not all([id_, food, city, city_name, asset]): raise ValueError('ID、名称、城市和素材名称不能为空')
            if not re.fullmatch(r'city-\d{2}-[a-z]+',city): raise ValueError('城市ID格式错误')
            if level and not re.fullmatch(r'level-\d{2}',level): raise ValueError('关卡目录格式错误')
            if id_ in ids: raise ValueError('重复美食ID: ' + id_)
            ids.add(id_)
            if not (bundle/'levels'/city).is_dir(): raise ValueError('城市目录不存在: ' + city)
            key = ''
            if level:
                city_config = bundle/'levels'/city/'city.json'
                if city not in cities or not city_config.exists(): raise ValueError('该城市尚未配置可玩关卡')
                if level not in json.loads(city_config.read_text(encoding='utf-8-sig'))['levels']: raise ValueError('关卡未列入城市配置: '+level)
                if not (city_config.parent/level/'differences.json').exists(): raise ValueError('关卡文件不存在: '+level)
                key = city+'/'+level
                if key in levels: raise ValueError('关卡重复关联: '+key)
                levels.add(key)
                level_data = json.loads((city_config.parent/level/'differences.json').read_text(encoding='utf-8-sig'))
                label = level_data.get('food', '')
                if level_data.get('type') == 'food' and label and food_name(label) != food_name(food):
                    raise ValueError(f'美食与关卡不匹配: {food} → {key}（关卡美食为 {label}）')
            requested = (ROOT/path.replace('\\', '/')).resolve()
            if asset_uuid:
                matches = [p for p, m in metadata.items() if m.get('uuid') == asset_uuid]
            else:
                matches = [p for p in images if p.resolve() == requested and p.name == asset]
                if not matches: matches = [p for p in images if p.name == asset]
                if not matches: matches = [p for p in images if p.stem == Path(asset).stem]
            if len(matches) != 1: raise ValueError(f'素材匹配到 {len(matches)} 个文件，需手动确认: {asset}')
            image = matches[0]
            if not image.is_relative_to(bundle/'levels'/city): raise ValueError('素材实际目录与城市不一致: '+str(image))
            meta = metadata.get(image, {})
            frames = [m for m in meta.get('subMetas', {}).values() if m.get('importer') == 'sprite-frame']
            if len(frames) != 1 or not meta.get('uuid'): raise ValueError('素材未导入为 SpriteFrame: '+str(image))
            sprite_uuid = frames[0].get('uuid')
            if not sprite_uuid or not sprite_uuid.startswith(meta['uuid']+'@'): raise ValueError('SpriteFrame UUID 无效')
            for i, new in [(5, image.name), (6, image.relative_to(ROOT).as_posix()), (7, meta['uuid'])]:
                if v[i] == new: continue
                fixes.append({'row':row.get('r'), 'field':HEADERS[i], 'old':v[i], 'new':new})
                column = chr(65+i)
                cell = cells.get(column)
                if cell is None: cell = ET.SubElement(row, Q+'c', {'r':column+row.get('r')})
                for child in list(cell): cell.remove(child)
                cell.set('t','inlineStr')
                ET.SubElement(ET.SubElement(cell,Q+'is'),Q+'t').text = new
            foods.append({'id':id_, 'cityKey':city, 'cityName':city_name, 'levelKey':key,
                          'name':food, 'desc':desc, 'icon':image.relative_to(bundle).with_suffix('').as_posix()+'/spriteFrame',
                          'assetPath':image.relative_to(ROOT).as_posix(), 'assetUuid':meta['uuid'], 'spriteFrameUuid':sprite_uuid,
                          'reviews':preset_reviews})
        except (ValueError, KeyError) as e:
            errors.append(f'第 {row.get("r")} 行: {e}')
    if errors: raise ValueError('\n'.join(errors))
    report = {'foods':len(foods), 'linked':len(levels), 'unlinked':len(foods)-len(levels), 'fixes':fixes}
    if not check:
        if fixes:
            backup = ROOT/'temp/food-catalog-backups'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            backup.mkdir(parents=True)
            shutil.copy2(table,backup/table.name)
            parts[sheet_name] = ET.tostring(xml,encoding='utf-8',xml_declaration=True)
            temp = table.with_suffix('.tmp.xlsx')
            with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as z:
                for name, data in parts.items(): z.writestr(name,data)
            temp.replace(table)
        output.parent.mkdir(parents=True,exist_ok=True)
        temp = output.with_suffix('.tmp')
        temp.write_text(json.dumps({'version':1,'foods':foods},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        temp.replace(output)
        meta = Path(str(output)+'.meta')
        if not meta.exists():
            meta.write_text(json.dumps({'ver':'2.0.1','importer':'json','imported':True,'uuid':str(uuid.uuid4()),'files':['.json'],'subMetas':{},'userData':{}},indent=2),encoding='utf-8')
        (ROOT/'temp/food-catalog-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--table',type=Path,default=ROOT/'config/food-catalog.xlsx')
    parser.add_argument('--output',type=Path,default=ROOT/'assets/resources/configs/food-catalog.json')
    parser.add_argument('--check',action='store_true')
    args = parser.parse_args()
    try: print(json.dumps(build(args.table.resolve(),args.output.resolve(),args.check),ensure_ascii=False,indent=2))
    except (ValueError,KeyError,OSError,StopIteration,zipfile.BadZipFile) as e:
        print('配置生成失败（保留原配置）: '+str(e),file=sys.stderr);sys.exit(1)
