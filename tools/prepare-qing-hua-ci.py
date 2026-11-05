"""Import 20 porcelain icons and 60 annotated levels using verified Photoshop JPEGs.

Requires Pillow and pypinyin. Sources are read-only. Existing .meta UUIDs are retained.
--publish appends the chapter to global navigation; --check verifies without writing.
"""
import argparse
import copy
import hashlib
import io
import json
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps
from pypinyin import lazy_pinyin
from content_jpeg_cache import PhotoshopJpegs, DEFAULT_STAGE
from png_asset_records import retain_optimized_png

ROOT = Path(__file__).resolve().parents[1]
CHAPTER = 'qing-hua-ci'
CHAPTER_NAME = '青花瓷'
ICON_ROOT = ROOT / 'assets/Bundle/food-icons' / CHAPTER
LEVEL_ROOT = ROOT / 'assets/Bundle/levels' / CHAPTER
CATALOG_PATH = ROOT / 'assets/resources/configs/porcelain-catalog.json'
MAP_PATH = ROOT / 'config/qing-hua-ci-source-map.json'
ICON_SLUGS = [
    'shou-er-da-guan', 'long-wen-da-pan', 'feng-shou-bian-hu', 'hai-ao-shan-xing-bi-jia',
    'ya-shou-bei', 'fan-wen-da-shao-yu-e-xing-zuo', 'xiao-he-zhui-han-xin-mei-ping', 'si-ai-tu-mei-ping',
    'da-wei-de-xiang-er-shuang-ping', 'wan-shou-da-zun', 'hua-kou-pu-tao-pan', 'qing-hua-gao-zu-pan',
    'seng-mao-hu', 'a-la-bo-wen-zhu-tai', 'ying-xi-tu-yuan-he', 'lan-ting-hui-bi-tong',
    'qing-hua-hua-jiao', 'xi-shuai-guan', 'lian-chi-yu-zao-wen-guan', 'dang-dai-qing-hua-ri-yong-qi',
]


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def relative(path):
    return path.relative_to(ROOT).as_posix()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def number_and_name(path):
    match = re.fullmatch(r'(\d+)[.、．]\s*(.+)', path.stem if path.is_file() else path.name)
    if not match:
        raise ValueError('缺少编号: ' + str(path))
    return int(match[1]), match[2]


def slug(name):
    clean = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff]', '', name)
    value = '-'.join(lazy_pinyin(clean)).lower()
    if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', value):
        raise ValueError('无法生成拼音目录: ' + name)
    return value


class Importer:
    def __init__(self, check=False):
        self.check = check
        self.changed = []

    def put(self, path, data):
        if path.exists() and path.read_bytes() == data:
            return
        if self.check:
            raise ValueError('文件缺失或需要更新: ' + relative(path))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.changed.append(relative(path))

    def json(self, path, value):
        if path.exists() and read_json(path) == value:
            return
        self.put(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))

    def meta(self, path, importer='directory', user_data=None):
        target = Path(str(path) + '.meta')
        if target.exists():
            return read_json(target)['uuid']
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, 'find-difference/' + relative(path)))
        self.json(target, {'ver': '1.2.0' if importer == 'directory' else '2.0.1', 'importer': importer,
                           'imported': True, 'uuid': identity, 'files': [] if importer == 'directory' else ['.json'],
                           'subMetas': {}, 'userData': user_data or {}})
        return identity

    def directory(self, path, user_data=None):
        if not self.check:
            path.mkdir(parents=True, exist_ok=True)
        self.meta(path, user_data=user_data)

    def image(self, path, data):
        with Image.open(io.BytesIO(data)) as im:
            width, height = im.size
            has_alpha = 'A' in im.getbands() or 'transparency' in im.info
        self.put(path, data)
        meta_path = Path(str(path) + '.meta')
        identity = read_json(meta_path)['uuid'] if meta_path.exists() else str(uuid.uuid5(uuid.NAMESPACE_URL, 'find-difference/' + relative(path)))
        template = ROOT / 'assets/Bundle/food-icons/city-02-beijing/city-02-beijing-BeiJingKaoYa.png.meta'
        meta = copy.deepcopy(read_json(meta_path if meta_path.exists() else template))
        old = meta['uuid']
        meta = json.loads(json.dumps(meta).replace(old, identity))
        meta['uuid'] = identity
        meta['files'] = sorted(['.json', path.suffix])
        meta['userData']['hasAlpha'] = has_alpha
        for sub in meta['subMetas'].values():
            sub['displayName'] = path.stem
        frame = meta['subMetas']['f9941']['userData']
        frame.update(width=width, height=height, rawWidth=width, rawHeight=height,
                     trimX=0, trimY=0, offsetX=0, offsetY=0, trimType='none')
        frame['vertices'] = {
            'rawPosition': [-width/2, -height/2, 0, width/2, -height/2, 0, -width/2, height/2, 0, width/2, height/2, 0],
            'indexes': [0, 1, 2, 2, 1, 3], 'uv': [0, height, width, height, 0, 0, width, 0],
            'nuv': [0, 0, 1, 0, 0, 1, 1, 1], 'minPos': [-width/2, -height/2, 0], 'maxPos': [width/2, height/2, 0],
        }
        self.json(meta_path, meta)
        return identity

    def normalized_jpeg(self, path, data):
        """Carry the existing PNG's UUID into its JPEG replacement, then remove only that PNG."""
        old = path.with_suffix('.png')
        old_meta = Path(str(old) + '.meta')
        target_meta = Path(str(path) + '.meta')
        if old.exists():
            if not old_meta.exists():
                raise ValueError('旧 PNG 缺少 meta: ' + relative(old))
            if target_meta.exists() and read_json(old_meta)['uuid'] != read_json(target_meta)['uuid']:
                raise ValueError('PNG/JPEG UUID 冲突，需确认: ' + relative(path))
            if not target_meta.exists():
                if self.check:
                    raise ValueError('旧 PNG 尚未迁移为 JPEG: ' + relative(old))
                old_meta.replace(target_meta)
        identity = self.image(path, data)
        if old.exists():
            if self.check:
                raise ValueError('仍有旧 PNG 待替换: ' + relative(old))
            if not old.resolve().is_relative_to(LEVEL_ROOT.resolve()):
                raise ValueError('替换路径超出青花瓷章节')
            old.unlink(); old_meta.unlink(missing_ok=True)
        return identity


def prepare(icon_source, level_source, check=False, publish=False, jpeg_stage=DEFAULT_STAGE):
    imports = Importer(check)
    jpeg_cache = PhotoshopJpegs(jpeg_stage)
    icon_paths = sorted((p for p in icon_source.iterdir() if p.suffix.lower() == '.png'), key=lambda p: number_and_name(p)[0])
    folders = sorted((p for p in level_source.iterdir() if p.is_dir()), key=lambda p: number_and_name(p)[0])
    if [number_and_name(p)[0] for p in icon_paths] != list(range(1, 21)):
        raise ValueError('图标编号必须完整覆盖 1–20，不能重复')
    if [number_and_name(p)[0] for p in folders] != list(range(1, 61)):
        raise ValueError('关卡编号必须完整覆盖 1–60，不能重复')
    # Build and validate the complete mapping before writing any assets.
    rows, used = [], set()
    for source in folders:
        number, name = number_and_name(source)
        folder = slug(name)
        if folder in used:
            raise ValueError('关卡拼音目录重复: ' + folder)
        used.add(folder)
        images = [p for p in source.iterdir() if p.suffix.lower() in {'.png', '.jpg', '.jpeg'}]
        numbered = [p for p in images if re.match(r'^' + str(number) + r'[.、．]', p.name)]
        reference = [p for p in images if p.name.startswith('图片_')]
        if len(numbered) != 1 or len(reference) != 1 or len(images) != 2:
            raise ValueError('无法唯一识别上下图: ' + source.name)
        configs = list(source.glob('*.json'))
        if len(configs) > 1:
            raise ValueError('同一关有多个 JSON: ' + source.name)
        data = read_json(configs[0]) if configs else None
        if data is not None:
            points = data.get('differences')
            if not isinstance(points, list) or not points:
                raise ValueError('差异点配置为空: ' + source.name)
            seen = set()
            for point in points:
                if not point.get('id') or point['id'] in seen or not (0 <= point['x'] <= 1 and 0 <= point['y'] <= 1 and 0 < point['radius'] <= 1):
                    raise ValueError('差异点配置无效: ' + source.name)
                seen.add(point['id'])
        rows.append({'number': number, 'name': name, 'folder': folder, 'id': CHAPTER + '/' + folder,
                     'source': source, 'top': numbered[0], 'bottom': reference[0], 'config': configs[0] if configs else None, 'data': data})
    if publish and any(row['data'] is None for row in rows):
        raise ValueError('仍有待标注关卡，不能开放章节')
    old_catalog = {item['id']: item for item in read_json(CATALOG_PATH).get('items', [])} if CATALOG_PATH.exists() else {}
    imports.directory(ICON_ROOT)
    imports.directory(LEVEL_ROOT, {'isBundle': True, 'bundleName': CHAPTER, 'priority': 7, 'bundleConfigID': '66NbM5tAFFNImQdJTJ7bY+'})
    for name in ['configs', 'thumbnails']:
        imports.directory(LEVEL_ROOT / name)
    items, icon_records = [], []
    for source, icon_slug in zip(icon_paths, ICON_SLUGS):
        number, name = number_and_name(source)
        level = rows[number * 3 - 1]
        target = ICON_ROOT / (icon_slug + '.png')
        # Supplied canvases are square: scale the whole canvas, retaining every pixel's location and alpha.
        with Image.open(source) as original:
            if original.width != original.height:
                raise ValueError('图标不是方形，请先确认裁剪范围: ' + source.name)
            result = original.convert('RGBA').resize((512, 512), Image.Resampling.LANCZOS)
            output = io.BytesIO(); result.save(output, format='PNG', optimize=True)
            source_size = list(original.size)
        identity = imports.image(target, retain_optimized_png(target, output.getvalue()))
        item_id = CHAPTER + '-' + icon_slug
        previous = old_catalog.get(item_id, {})
        items.append({'id': item_id, 'category': 'porcelain', 'assetNumber': number,
                      'name': name, 'cityKey': CHAPTER, 'cityName': CHAPTER_NAME, 'levelKey': level['id'],
                      'desc': previous.get('desc', ''), 'reviews': previous.get('reviews', []),
                      'icon': 'food-icons/' + CHAPTER + '/' + icon_slug + '/spriteFrame',
                      'assetPath': relative(target), 'assetUuid': identity, 'spriteFrameUuid': identity + '@f9941'})
        icon_records.append({'number': number, 'name': name, 'sourceFile': source.name, 'sourceSize': source_size,
                             'sourceSha256': sha(source), 'assetPath': relative(target), 'outputSize': [512, 512],
                             'collectibleId': item_id, 'acquisitionNumber': number * 3, 'levelKey': level['id'], 'levelName': level['name']})
    by_number = {item['assetNumber'] * 3: item for item in items}
    level_records = []
    for row in rows:
        number, folder = row['number'], row['folder']
        art = LEVEL_ROOT / folder
        configs = LEVEL_ROOT / 'configs' / folder
        thumbs = LEVEL_ROOT / 'thumbnails' / folder
        for directory in [art, configs, thumbs]:
            imports.directory(directory)
        paths = []
        for key, stem in [('top', 'scene-a'), ('bottom', 'scene-b')]:
            source = row[key]
            target = art / (stem + '.jpg')
            imports.normalized_jpeg(target, jpeg_cache.get(source))
            paths.append(relative(target))
        with Image.open(io.BytesIO(jpeg_cache.get(row['top']))) as original:
            thumbnail = ImageOps.fit(original.convert('RGB'), (306, 200), method=Image.Resampling.LANCZOS)
            output = io.BytesIO(); thumbnail.save(output, format='JPEG', quality=90, subsampling=0, optimize=True)
        imports.image(thumbs / 'icon.jpg', output.getvalue())
        collectible = by_number.get(number)
        if row['data'] is not None:
            data = copy.deepcopy(row['data'])
            data.update(name=row['name'], icon=f'thumbnails/{CHAPTER}/{folder}/icon/spriteFrame')
            if collectible:
                data.update(type='porcelain', collectibleId=collectible['id'])
            imports.json(configs / 'differences.json', data)
            imports.meta(configs / 'differences.json', 'json')
            pending = configs / 'pending.json'
            if pending.exists():
                if check:
                    raise ValueError('已补配置但 pending 尚未清理: ' + relative(pending))
                if read_json(pending).get('status') != 'awaiting-differences':
                    raise ValueError('pending 被编辑，需手动确认: ' + relative(pending))
                pending.unlink()
                Path(str(pending) + '.meta').unlink(missing_ok=True)
        else:
            # Never write an empty differences.json that could masquerade as a playable level.
            pending = {'id': row['id'], 'name': row['name'], 'status': 'awaiting-differences',
                       'sourceFolder': row['source'].name, 'type': 'porcelain' if collectible else 'normal',
                       'collectibleId': collectible['id'] if collectible else '',
                       'topImage': f'levels/{CHAPTER}/{folder}/scene-a/spriteFrame',
                       'bottomImage': f'levels/{CHAPTER}/{folder}/scene-b/spriteFrame',
                       'icon': f'thumbnails/{CHAPTER}/{folder}/icon/spriteFrame'}
            imports.json(configs / 'pending.json', pending)
            imports.meta(configs / 'pending.json', 'json')
        level_records.append({'number': number, 'id': row['id'], 'name': row['name'], 'folder': folder,
                              'sourceFolder': row['source'].name, 'images': paths,
                              'sourceImages': [{'file': row[key].name, 'sha256': sha(row[key]),
                                                'importedSha256': hashlib.sha256(jpeg_cache.get(row[key])).hexdigest()} for key in ['top', 'bottom']],
                              'sourceConfig': row['config'].name if row['config'] else None,
                              'configSha256': sha(row['config']) if row['config'] else None,
                              'differenceCount': len(row['data']['differences']) if row['data'] else 0,
                              'status': 'marked' if row['data'] else 'awaiting-differences',
                              'collectibleId': collectible['id'] if collectible else None})
    chapter = {'schemaVersion': 2, 'name': CHAPTER_NAME, 'banner': f'chapter-covers/{CHAPTER}-icon/spriteFrame',
               'levels': [{key: row[key] for key in ['id', 'name', 'folder']} for row in rows]}
    imports.json(LEVEL_ROOT / 'configs/city.json', chapter)
    imports.meta(LEVEL_ROOT / 'configs/city.json', 'json')
    cover = ROOT / 'assets/Bundle/chapter-covers' / (CHAPTER + '-icon.jpg')
    with Image.open(rows[0]['top']) as original:
        output = io.BytesIO(); ImageOps.fit(original.convert('RGB'), (612, 400), method=Image.Resampling.LANCZOS).save(output, format='JPEG', quality=90, subsampling=0, optimize=True)
    imports.image(cover, output.getvalue())
    imports.json(CATALOG_PATH, {'version': 1, 'items': items})
    imports.meta(CATALOG_PATH, 'json')
    order_path = ROOT / 'config/chapter-order.json'
    order = read_json(order_path)
    if publish:
        for field in ['chapters', 'navigation']:
            if CHAPTER not in order[field]:
                order[field].append(CHAPTER)
        imports.json(order_path, order)
    published = CHAPTER in order['chapters']
    imports.json(MAP_PATH, {'chapter': CHAPTER, 'name': CHAPTER_NAME, 'published': published,
                           'sourceIcons': str(icon_source), 'sourceLevels': str(level_source),
                           'iconSize': [512, 512], 'acquisitionRule': 'iconNumber * 3', 'imageExport': jpeg_cache.provenance,
                           'icons': icon_records, 'levels': level_records})
    return {'icons': len(items), 'levels': len(rows), 'marked': sum(row['data'] is not None for row in rows),
            'pending': [row['number'] for row in rows if row['data'] is None], 'changedFiles': len(imports.changed), 'published': published}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--icons', type=Path, default=Path(r'D:\CocosCreator\关卡\瓷器图标'))
    parser.add_argument('--levels', type=Path, default=Path(r'D:\CocosCreator\关卡\青花瓷'))
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--jpeg-stage', type=Path, default=DEFAULT_STAGE)
    args = parser.parse_args()
    print(json.dumps(prepare(args.icons.resolve(), args.levels.resolve(), args.check, args.publish, args.jpeg_stage), ensure_ascii=False, indent=2))
