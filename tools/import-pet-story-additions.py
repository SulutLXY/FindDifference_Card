"""Append the 51 new pet levels without rewriting the 20 published levels or their UUIDs."""
import argparse
import copy
import hashlib
import importlib.util
import io
import json
import math
import re
from pathlib import Path
from PIL import Image, ImageChops
from content_jpeg_cache import PhotoshopJpegs

spec = importlib.util.spec_from_file_location('pet_import_helpers', Path(__file__).with_name('prepare-qing-hua-ci.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
ROOT, read, sha, slug, Importer = helpers.ROOT, helpers.read_json, helpers.sha, helpers.slug, helpers.Importer
KEY = 'chong-wu-gu-shi'
SOURCE = Path(r'D:\CocosCreator\关卡\萌宠关卡')
TARGET = ROOT / 'assets/Bundle/levels' / KEY
STAGE = ROOT / 'temp/content-jpegs-pet-story-2026-11-25'
AUDIT = ROOT / 'config/pet-story-additions-2026-11-25.json'


def stem(file):
    return 'scene-b' if file.stem == 'scene-v' else file.stem


def scan():
    rows = []
    for folder in SOURCE.iterdir():
        if not folder.is_dir():
            continue
        match = re.fullmatch(r'(\d+)[.、．]\s*(.+)', folder.name)
        if not match:
            raise ValueError('源目录缺少编号: ' + folder.name)
        configs = list(folder.glob('*.json'))
        if len(configs) != 1:
            raise ValueError('配置不唯一: ' + folder.name)
        data = read(configs[0])
        if not data.get('name') or data.get('type') != 'normal' or data.get('food'):
            raise ValueError('配置名称或类型需确认: ' + folder.name)
        points = data.get('differences')
        if not points or len({d['id'] for d in points}) != len(points):
            raise ValueError('缺少点位或重复ID: ' + folder.name)
        for d in points:
            if not d.get('id') or not all(isinstance(d.get(k), (int, float)) and not isinstance(d[k], bool)
                    and math.isfinite(d[k]) for k in ['x', 'y', 'radius']):
                raise ValueError('点位数值无效: ' + folder.name)
            if not (0 <= d['x'] <= 1 and 0 <= d['y'] <= 1 and 0 < d['radius'] <= 1):
                raise ValueError('点位越界: ' + folder.name)
        images = [folder / 'scene-a.png', folder / 'scene-b.png']
        if int(match[1]) == 49 and not images[1].exists():
            images[1] = folder / 'scene-v.png'
        decoded = []
        for f in images:
            with Image.open(f) as image:
                image.load()
                decoded.append(image.convert('RGB'))
        if decoded[0].size == decoded[1].size and ImageChops.difference(*decoded).getbbox() is None:
            raise ValueError('上下图完全相同: ' + folder.name)
        rows.append(dict(sourceNumber=int(match[1]), source=folder, config=configs[0], data=data,
                         name=match[2], folder=slug(match[2]), images=images))
    rows.sort(key=lambda r: r['sourceNumber'])
    if [r['sourceNumber'] for r in rows] != list(range(1, 52)) or len({r['folder'] for r in rows}) != 51:
        raise ValueError('需完整的1–51关且名称不重复')
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    rows = scan()
    if not args.apply and not args.check:
        jobs = []
        for row in rows:
            for f in row['images']:
                target = STAGE / row['folder'] / (stem(f) + '.jpg')
                target.parent.mkdir(parents=True, exist_ok=True)
                jobs.append(dict(source=str(f), sourceSha256=sha(f), target=str(target)))
        plan = dict(quality=8, qualityScale=12, width=1024, height=672, progress=str(STAGE/'progress.txt'),
                    done=str(STAGE/'done.txt'), jobs=jobs)
        Importer().json(STAGE/'jobs.json', plan)
        worker = (ROOT/'tools/export-content-jpeg.ps1').read_text(encoding='utf-8-sig')
        worker = worker.split("$script = @'", 1)[1].split("'@", 1)[0]
        (STAGE/'export.jsx').write_text(worker.replace('__SPEC__', json.dumps(plan, ensure_ascii=True)), encoding='utf-8')
        print(json.dumps(dict(newLevels=51, newImages=102, newDifferences=657, script=str(STAGE/'export.jsx'))))
        return
    cache = PhotoshopJpegs(STAGE)
    images = {(r['folder'], stem(f)): cache.get(f) for r in rows for f in r['images']}
    manifest_path = TARGET/'configs/city.json'
    manifest = read(manifest_path)
    previous = read(AUDIT) if AUDIT.exists() else None
    original = previous['previousLevels'] if previous else copy.deepcopy(manifest['levels'])
    assert len(original) == 20
    new_entries = [dict(id=f'{KEY}/{r["folder"]}', name=r['name'], folder=r['folder']) for r in rows]
    expected = original + new_entries
    assert len({e['id'] for e in expected}) == len({e['folder'] for e in expected}) == 71
    assert manifest['levels'] in (original, expected), 'Published level list changed; stop rather than overwrite it'
    before = previous['chapterFilesBefore'] if previous else {
        p.relative_to(ROOT).as_posix(): sha(p) for p in TARGET.rglob('*') if p.is_file()}
    backup = ROOT/'temp/pet-story-additions-2026-11-25/before'
    if not previous and not args.check:
        backup.mkdir(parents=True, exist_ok=True)
        for f in [manifest_path, ROOT/'config/chapter-order.json', ROOT/'assets/resources/configs/cities.json',
                  ROOT/'assets/PleyGame/fonts/FDTitleBobohei-Bold.ttf']:
            dest = backup/f.relative_to(ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(f.read_bytes())
    writer = Importer(args.check)
    records = []
    for r, entry in zip(rows, new_entries):
        folder = r['folder']
        for d in [TARGET/folder, TARGET/'configs'/folder, TARGET/'thumbnails'/folder]:
            writer.directory(d)
        picture_records = []
        for f in r['images']:
            target = TARGET/folder/(stem(f) + '.jpg')
            data = images[(folder, stem(f))]
            identity = writer.image(target, data)
            picture_records.append(dict(path=target.relative_to(ROOT).as_posix(), sourceFile=f.name,
                sourceSha256=sha(f), sha256=sha(target), uuid=identity))
        with Image.open(io.BytesIO(images[(folder, 'scene-a')])) as top:
            thumbnail = top.resize((306, 200), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            thumbnail.save(buf, 'JPEG', quality=85, optimize=True)
        writer.image(TARGET/'thumbnails'/folder/'icon.jpg', buf.getvalue())
        config = copy.deepcopy(r['data'])
        config['name'] = r['name']
        config['icon'] = f'thumbnails/{KEY}/{folder}/icon/spriteFrame'
        config_path = TARGET/'configs'/folder/'differences.json'
        writer.json(config_path, config)
        writer.meta(config_path, 'json')
        records.append(dict(**entry, sourceNumber=r['sourceNumber'], chapterNumber=20+r['sourceNumber'],
            sourceFolder=r['source'].name, sourceConfig=r['config'].name, sourceConfigName=r['data']['name'], configSha256=sha(r['config']),
            differenceCount=len(config['differences']), images=picture_records))
    manifest['levels'] = expected
    writer.json(manifest_path, manifest)
    for f, digest in before.items():
        if f != manifest_path.relative_to(ROOT).as_posix():
            assert sha(ROOT/f) == digest, 'An existing pet resource changed: ' + f
    writer.json(AUDIT, dict(date='2026-11-25', chapter=KEY, source=str(SOURCE), previousLevels=original,
        chapterFilesBefore=before, imageExport=cache.provenance, levels=records,
        oldLevelCount=20, addedLevelCount=51, levelCount=71, addedDifferences=657, differenceCount=899))
    print(json.dumps(dict(levels=71, addedLevels=51, addedDifferences=657, changedFiles=len(writer.changed))))


if __name__ == '__main__':
    main()
