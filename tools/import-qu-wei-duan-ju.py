"""Import 趣味短剧 in numbered source order; display names come from annotation JSONs."""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import re
from pathlib import Path
from PIL import Image
from content_jpeg_cache import PhotoshopJpegs
from art_asset_records import retain_optimized_art

spec = importlib.util.spec_from_file_location('chapter_helpers', Path(__file__).with_name('import-xun-song-ji.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
ROOT, Importer, read, slug, sha = helpers.ROOT, helpers.Importer, helpers.read, helpers.slug, helpers.sha
SOURCE = Path(r'D:\CocosCreator\关卡\趣味短剧')
KEY, NAME = 'qu-wei-duan-ju', '趣味短剧'
TARGET = ROOT / 'assets/Bundle/levels' / KEY
STAGE = ROOT / 'temp/content-jpegs-qu-wei-duan-ju'


def scan():
    rows = []
    for directory in SOURCE.iterdir():
        if not directory.is_dir():
            continue
        match = re.fullmatch(r'(\d+)[.、．]\s*(.+)', directory.name)
        if not match:
            raise ValueError('目录缺少顺序编号: ' + directory.name)
        configs = list(directory.glob('*.json'))
        if len(configs) != 1:
            raise ValueError('标注配置数量不为1: ' + directory.name)
        data = read(configs[0])
        name, points = data.get('name'), data.get('differences')
        if not isinstance(name, str) or not name.strip():
            raise ValueError('标注中缺少关卡名称: ' + directory.name)
        if not isinstance(points, list) or not points:
            raise ValueError('标注为空: ' + directory.name)
        ids, warnings = set(), []
        for point in points:
            identity = point.get('id')
            if not identity or identity in ids:
                raise ValueError('标注ID缺失或重复: ' + directory.name)
            ids.add(identity)
            if not all(isinstance(point.get(k), (int, float)) and not isinstance(point[k], bool)
                       and math.isfinite(point[k]) for k in ['x', 'y', 'radius']):
                raise ValueError('标注数值无效: ' + directory.name)
            if not 0 < point['radius'] <= 1:
                raise ValueError('标注越界: ' + directory.name + ' ' + identity)
            if not (0 <= point['x'] <= 1 and 0 <= point['y'] <= 1):
                dx = max(0, -point['x'], point['x'] - 1) * 1024
                dy = max(0, -point['y'], point['y'] - 1) * 672
                if math.hypot(dx, dy) > point['radius'] * 672 * 1.4:
                    raise ValueError('标注判定区域完全在画面外: ' + directory.name + ' ' + identity)
                warnings.append({'id': identity, 'x': point['x'], 'y': point['y'], 'radius': point['radius'],
                                 'reason': '标注中心越界，但边缘容错判定区域仍与画面相交，保留作者配置'})
        images = {}
        for stem in ['scene-a', 'scene-b']:
            files = [p for p in directory.iterdir() if p.is_file() and p.stem == stem
                     and p.suffix.lower() in {'.png', '.jpg', '.jpeg'}]
            if len(files) != 1:
                raise ValueError('图片缺失或不唯一: ' + directory.name + '/' + stem)
            with Image.open(files[0]) as image:
                image.verify()
            images[stem] = files[0]
        rows.append({'number': int(match[1]), 'name': name, 'folder': slug(name), 'source': directory,
                     'config': configs[0], 'data': data, 'images': images, 'warnings': warnings})
    rows.sort(key=lambda r: r['number'])
    if [r['number'] for r in rows] != list(range(1, 36)) or len({r['folder'] for r in rows}) != 35:
        raise ValueError('必须是顺序1–35的35关且配置名拼音目录不重复')
    return rows


def run(apply=False, check=False, refresh_cover=False):
    rows = scan()
    if not apply and not check:
        jobs = []
        for row in rows:
            for stem, source in row['images'].items():
                target = STAGE / row['folder'] / (stem + '.jpg')
                target.parent.mkdir(parents=True, exist_ok=True)
                jobs.append({'source': str(source), 'sourceSha256': sha(source), 'target': str(target)})
        plan = {'quality': 8, 'qualityScale': 12, 'width': 1024, 'height': 672,
                'progress': str(STAGE / 'progress.txt'), 'done': str(STAGE / 'done.txt'), 'jobs': jobs}
        (STAGE / 'jobs.json').write_text(json.dumps(plan, ensure_ascii=True, indent=2), encoding='utf-8')
        return {'levels': len(rows), 'images': len(jobs), 'annotationWarnings': sum(len(r['warnings']) for r in rows), 'plan': str(STAGE / 'jobs.json')}
    cache = PhotoshopJpegs(STAGE)
    images = {(r['folder'], stem): cache.get(source) for r in rows for stem, source in r['images'].items()}
    entries = [{'id': f'{KEY}/{r["folder"]}', 'name': r['name'], 'folder': r['folder']} for r in rows]
    old_manifest = TARGET / 'configs/city.json'
    if old_manifest.exists() and read(old_manifest)['levels'] != entries:
        raise ValueError('已发布关卡名称/顺序有变化，需明确迁移映射以保留关卡ID后再更新')
    writer = Importer(check)
    writer.directory(TARGET, {'isBundle': True, 'bundleName': KEY, 'priority': 7, 'bundleConfigID': '66NbM5tAFFNImQdJTJ7bY+'})
    for name in ['configs', 'thumbnails']:
        writer.directory(TARGET / name)
    records = []
    for row, entry in zip(rows, entries):
        folder = row['folder']
        for path in [TARGET / folder, TARGET / 'configs' / folder, TARGET / 'thumbnails' / folder]:
            writer.directory(path)
        image_records = []
        for stem, source in row['images'].items():
            target = TARGET / folder / (stem + '.jpg')
            data = retain_optimized_art(target, images[(folder, stem)])
            identity = writer.image(target, data)
            image_records.append({'path': target.relative_to(ROOT).as_posix(), 'sourceFile': source.name,
                                  'sha256': hashlib.sha256(data).hexdigest(), 'uuid': identity, 'sourceSha256': sha(source)})
        writer.image(TARGET / 'thumbnails' / folder / 'icon.jpg', helpers.resize(images[(folder, 'scene-a')], (306, 200)))
        config = copy.deepcopy(row['data'])
        config.update(icon=f'thumbnails/{KEY}/{folder}/icon/spriteFrame')
        writer.json(TARGET / 'configs' / folder / 'differences.json', config)
        writer.meta(TARGET / 'configs' / folder / 'differences.json', 'json')
        records.append({'number': row['number'], **entry, 'sourceFolder': row['source'].name,
                        'sourceConfig': row['config'].name, 'configSha256': sha(row['config']),
                        'differenceCount': len(config['differences']), 'images': image_records, 'annotationWarnings': row['warnings']})
    writer.json(old_manifest, {'schemaVersion': 2, 'name': NAME,
                              'banner': f'chapter-covers/{KEY}-icon/spriteFrame', 'levels': entries})
    writer.meta(old_manifest, 'json')
    cover = ROOT / f'assets/Bundle/chapter-covers/{KEY}-icon.jpg'
    if refresh_cover or not cover.exists():
        writer.image(cover, helpers.resize(images[(rows[0]['folder'], 'scene-a')], (612, 400)))
    order = read(ROOT / 'config/chapter-order.json')
    for part in ['chapters', 'navigation']:
        order[part] = [k for k in order[part] if k != KEY]
        order[part].insert(order[part].index('chong-wu-gu-shi') + 1, KEY)
    order.setdefault('badges', {})[KEY] = 'new'
    writer.json(ROOT / 'config/chapter-order.json', order)
    writer.json(ROOT / 'config/qu-wei-duan-ju-import.json', {'chapter': KEY, 'name': NAME, 'source': str(SOURCE),
                'sourceOrder': '01至35文件夹顺序，关卡名取标注JSON的name', 'imageExport': cache.provenance, 'levels': records})
    return {'levels': len(rows), 'differences': sum(len(r['data']['differences']) for r in rows), 'changed': len(writer.changed)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply', action='store_true')
    group.add_argument('--check', action='store_true')
    parser.add_argument('--refresh-cover', action='store_true', help='Explicitly regenerate cover from level one; normally preserve separately edited artwork')
    args = parser.parse_args()
    print(json.dumps(run(args.apply, args.check, args.refresh_cover), ensure_ascii=False))
