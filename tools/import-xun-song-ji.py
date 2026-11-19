"""Import 寻宋记 in source folder order, using staged Photoshop quality-8 JPEGs."""
import argparse
import copy
import hashlib
import importlib.util
import io
import json
import math
import re
from pathlib import Path
from PIL import Image, ImageOps
from content_jpeg_cache import PhotoshopJpegs
from art_asset_records import retain_optimized_art

spec = importlib.util.spec_from_file_location('chapter_import', Path(__file__).with_name('prepare-qing-hua-ci.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROOT, Importer, read, slug, sha = module.ROOT, module.Importer, module.read_json, module.slug, module.sha
SOURCE = Path(r'D:\CocosCreator\关卡\寻宋记')
KEY = 'xun-song-ji'
TARGET = ROOT / 'assets/Bundle/levels' / KEY
STAGE = ROOT / 'temp/content-jpegs-xun-song-ji'


def scan():
    rows = []
    for directory in SOURCE.iterdir():
        if not directory.is_dir():
            continue
        match = re.fullmatch(r'(\d+)[.、．]\s*(.+)', directory.name)
        if not match:
            raise ValueError('目录缺少顺序编号: ' + directory.name)
        number, name = int(match[1]), match[2]
        configs = list(directory.glob('*.json'))
        if len(configs) != 1:
            raise ValueError('标注配置数量不为1: ' + directory.name)
        data = read(configs[0])
        points = data.get('differences')
        if not points or len({p['id'] for p in points}) != len(points):
            raise ValueError('标注为空或ID重复: ' + directory.name)
        for p in points:
            if not all(isinstance(p[k], (int, float)) and not isinstance(p[k], bool) and math.isfinite(p[k]) for k in ['x', 'y', 'radius']):
                raise ValueError('标注数值无效: ' + directory.name)
            if not (0 <= p['x'] <= 1 and 0 <= p['y'] <= 1 and 0 < p['radius'] <= 1):
                raise ValueError('标注越界: ' + directory.name)
        for stem in ['scene-a', 'scene-b']:
            with Image.open(directory / (stem + '.png')) as image:
                image.verify()
        rows.append({'number': number, 'name': name, 'folder': slug(name), 'source': directory,
                     'config': configs[0], 'data': data})
    rows.sort(key=lambda r: r['number'])
    if [r['number'] for r in rows] != list(range(1, 31)) or len({r['folder'] for r in rows}) != 30:
        raise ValueError('必须是顺序1–30的30关且拼音目录不重复')
    return rows


def resize(data, size):
    with Image.open(io.BytesIO(data)) as image:
        output = io.BytesIO()
        ImageOps.fit(image.convert('RGB'), size, method=Image.Resampling.LANCZOS).save(
            output, format='JPEG', quality=90, subsampling=0, optimize=True)
        return output.getvalue()


def run(apply=False, check=False, refresh_cover=False):
    rows = scan()
    if not apply and not check:
        jobs = []
        for row in rows:
            for stem in ['scene-a', 'scene-b']:
                source = row['source'] / (stem + '.png')
                target = STAGE / row['folder'] / (stem + '.jpg')
                target.parent.mkdir(parents=True, exist_ok=True)
                jobs.append({'source': str(source), 'sourceSha256': sha(source), 'target': str(target)})
        plan = {'quality': 8, 'qualityScale': 12, 'width': 1024, 'height': 672,
                'progress': str(STAGE / 'progress.txt'), 'done': str(STAGE / 'done.txt'), 'jobs': jobs}
        (STAGE / 'jobs.json').write_text(json.dumps(plan, ensure_ascii=True, indent=2), encoding='utf-8')
        return {'levels': 30, 'images': 60, 'plan': str(STAGE / 'jobs.json')}
    cache = PhotoshopJpegs(STAGE)
    # Validate every staged image and source hash before writing project assets.
    images = {(r['folder'], stem): cache.get(r['source'] / (stem + '.png'))
              for r in rows for stem in ['scene-a', 'scene-b']}
    writer = Importer(check)
    writer.directory(TARGET, {'isBundle': True, 'bundleName': KEY, 'priority': 7, 'bundleConfigID': '66NbM5tAFFNImQdJTJ7bY+'})
    for part in ['configs', 'thumbnails']:
        writer.directory(TARGET / part)
    entries, records = [], []
    for row in rows:
        folder = row['folder']
        entries.append({'id': f'{KEY}/{folder}', 'name': row['name'], 'folder': folder})
        for path in [TARGET / folder, TARGET / 'configs' / folder, TARGET / 'thumbnails' / folder]:
            writer.directory(path)
        image_records = []
        for stem in ['scene-a', 'scene-b']:
            target = TARGET / folder / (stem + '.jpg')
            data = retain_optimized_art(target, images[(folder, stem)])
            identity = writer.image(target, data)
            image_records.append({'path': module.relative(target), 'sha256': hashlib.sha256(data).hexdigest(), 'uuid': identity,
                                  'sourceSha256': sha(row['source'] / (stem + '.png'))})
        writer.image(TARGET / 'thumbnails' / folder / 'icon.jpg', resize(images[(folder, 'scene-a')], (306, 200)))
        config = copy.deepcopy(row['data'])
        config.update(name=row['name'], type='normal', icon=f'thumbnails/{KEY}/{folder}/icon/spriteFrame')
        writer.json(TARGET / 'configs' / folder / 'differences.json', config)
        writer.meta(TARGET / 'configs' / folder / 'differences.json', 'json')
        records.append({'number': row['number'], **entries[-1], 'sourceFolder': row['source'].name,
                        'sourceConfig': row['config'].name, 'configSha256': sha(row['config']),
                        'differenceCount': len(config['differences']), 'images': image_records})
    writer.json(TARGET / 'configs/city.json', {'schemaVersion': 2, 'name': '寻宋记',
                'banner': f'chapter-covers/{KEY}-icon/spriteFrame', 'levels': entries})
    writer.meta(TARGET / 'configs/city.json', 'json')
    cover = ROOT / 'assets/Bundle/chapter-covers' / (KEY + '-icon.jpg')
    if refresh_cover or not cover.exists():
        writer.image(cover, resize(images[(rows[0]['folder'], 'scene-a')], (612, 400)))
    order = read(ROOT / 'config/chapter-order.json')
    for part in ['chapters', 'navigation']:
        order[part] = [k for k in order[part] if k != KEY]
        order[part].insert(order[part].index('qing-hua-ci') + 1, KEY)
    order.setdefault('badges', {})[KEY] = 'new'
    writer.json(ROOT / 'config/chapter-order.json', order)
    writer.json(ROOT / 'config/xun-song-ji-import.json', {'chapter': KEY, 'name': '寻宋记', 'source': str(SOURCE),
                'sourceOrder': '01至30文件夹顺序', 'imageExport': cache.provenance, 'levels': records})
    return {'levels': len(rows), 'differences': sum(len(r['data']['differences']) for r in rows), 'changed': len(writer.changed)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply', action='store_true')
    group.add_argument('--check', action='store_true')
    parser.add_argument('--refresh-cover', action='store_true', help='Explicitly regenerate cover from level one; normally preserve separately edited artwork')
    args = parser.parse_args()
    print(json.dumps(run(args.apply, args.check, args.refresh_cover), ensure_ascii=False))
