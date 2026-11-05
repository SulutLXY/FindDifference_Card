"""Insert ten fully annotated levels after 闪身步, retaining all existing level IDs."""
import copy
import hashlib
import importlib.util
import io
import json
import re
from pathlib import Path

from PIL import Image, ImageOps
from content_jpeg_cache import PhotoshopJpegs

spec = importlib.util.spec_from_file_location('qinghua_import', Path(__file__).with_name('prepare-qing-hua-ci.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
ROOT, Importer, read_json, slug, sha = module.ROOT, module.Importer, module.read_json, module.slug, module.sha
CHAPTER = 'wang-luo-re-dian'
CHAPTER_ROOT = ROOT / 'assets/Bundle/levels' / CHAPTER
SOURCE = Path(r'D:\CocosCreator\关卡\热点玩法')
MAP = ROOT / 'config/hot-gameplay-import-2026-11-05.json'


def run():
    cache = PhotoshopJpegs()
    imports = Importer()
    rows = []
    for folder in SOURCE.iterdir():
        if not folder.is_dir():
            continue
        images = [p for p in folder.iterdir() if p.suffix.lower() in {'.png', '.jpg', '.jpeg'}]
        top = [p for p in images if not p.name.startswith('图片_')]
        bottom = [p for p in images if p.name.startswith('图片_')]
        configs = list(folder.glob('*.json'))
        if len(top) != 1 or len(bottom) != 1 or len(configs) != 1:
            raise ValueError('不能唯一识别关卡素材: ' + folder.name)
        number = int(re.match(r'^图片_(\d+)', bottom[0].name)[1])
        data = read_json(configs[0])
        points = data.get('differences')
        if not points:
            raise ValueError('缺少差异点: ' + folder.name)
        ids = set()
        for point in points:
            if not point.get('id') or point['id'] in ids or not (0 <= point['x'] <= 1 and 0 <= point['y'] <= 1 and 0 < point['radius'] <= .2):
                raise ValueError('无效差异点: ' + folder.name)
            ids.add(point['id'])
        key = slug(folder.name)
        rows.append({'number': number, 'name': folder.name, 'folder': key, 'id': CHAPTER + '/' + key,
                     'source': folder, 'top': top[0], 'bottom': bottom[0], 'config': configs[0], 'data': data})
    rows.sort(key=lambda row: row['number'])
    if [row['number'] for row in rows] != list(range(1, 11)):
        raise ValueError('参考图编号必须完整覆盖001–010')
    manifest_path = CHAPTER_ROOT / 'configs/city.json'
    manifest = read_json(manifest_path)
    new_ids = {row['id'] for row in rows}
    original = [entry for entry in manifest['levels'] if entry['id'] not in new_ids]
    anchor = next(i for i, entry in enumerate(original) if entry['id'] == 'city-00-HotTips/level-02')
    if original[anchor]['name'] != '闪身步':
        raise ValueError('插入锚点不匹配')
    records = []
    for row in rows:
        directory = CHAPTER_ROOT / row['folder']
        configs = CHAPTER_ROOT / 'configs' / row['folder']
        thumbs = CHAPTER_ROOT / 'thumbnails' / row['folder']
        if any(entry['folder'] == row['folder'] for entry in original):
            raise ValueError('新目录与原关卡冲突: ' + row['folder'])
        for target in [directory, configs, thumbs]:
            imports.directory(target)
        image_rows = []
        for key, filename in [('top', 'scene-a.jpg'), ('bottom', 'scene-b.jpg')]:
            data = cache.get(row[key]); target = directory / filename
            identity = imports.image(target, data)
            image_rows.append({'sourceFile': row[key].name, 'sourceSha256': sha(row[key]),
                               'assetPath': module.relative(target), 'importedSha256': hashlib.sha256(data).hexdigest(), 'uuid': identity})
        with Image.open(io.BytesIO(cache.get(row['top']))) as original_image:
            output = io.BytesIO()
            ImageOps.fit(original_image, (306, 200), method=Image.Resampling.LANCZOS).save(output, format='JPEG', quality=90, subsampling=0, optimize=True)
        imports.image(thumbs / 'icon.jpg', output.getvalue())
        data = copy.deepcopy(row['data'])
        data.update(name=row['name'], icon=f'thumbnails/{CHAPTER}/{row["folder"]}/icon/spriteFrame')
        imports.json(configs / 'differences.json', data)
        imports.meta(configs / 'differences.json', 'json')
        records.append({'number': row['number'], 'chapterPosition': anchor + 1 + row['number'],
                        'id': row['id'], 'name': row['name'], 'folder': row['folder'],
                        'sourceFolder': row['source'].name, 'sourceConfig': row['config'].name,
                        'configSha256': sha(row['config']), 'differenceCount': len(row['data']['differences']), 'images': image_rows})
    entries = [{field: row[field] for field in ['id', 'name', 'folder']} for row in rows]
    manifest['levels'] = original[:anchor + 1] + entries + original[anchor + 1:]
    imports.json(manifest_path, manifest)
    imports.json(MAP, {'chapter': CHAPTER, 'name': '网络热点', 'source': str(SOURCE),
                      'insertAfterId': 'city-00-HotTips/level-02', 'sourceOrder': '图片_001 至 图片_010',
                      'imageExport': cache.provenance, 'preservedLevels': original, 'levels': records})
    return {'newLevels': len(rows), 'positions': [anchor + 2, anchor + 1 + len(rows)],
            'chapterLevels': len(manifest['levels']), 'differences': sum(row['differenceCount'] for row in records), 'changedFiles': len(imports.changed)}


if __name__ == '__main__':
    print(json.dumps(run(), ensure_ascii=False, indent=2))
