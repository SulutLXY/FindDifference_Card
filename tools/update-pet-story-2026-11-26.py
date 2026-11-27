"""Apply the eight named pet-story corrections, preserving IDs, order and metadata."""
import argparse
import copy
import hashlib
import io
import json
import math
import re
from pathlib import Path
from PIL import Image, ImageChops
from content_jpeg_cache import PhotoshopJpegs

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'D:\AppData\WeixinSave\xwechat_files\wxid_ms7vi7fri1g321_9354\msg\file\2026-11\新建文件夹(2)\新建文件夹')
TARGET = ROOT/'assets/Bundle/levels/chong-wu-gu-shi'
STAGE = ROOT/'temp/pet-story-update-2026-11-26'
AUDIT = ROOT/'config/pet-story-updates/2026-11-26.json'
NAMES = ['鼠鼠我呀', '和班主任同坐大巴', '有人管管吗', '小羊炫蜜雪', '赖皮不回家', '烤馒头真香', '鲨鱼也怕痒', '图图试毛衣']
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
rel = lambda p: p.relative_to(ROOT).as_posix()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')


def inventory():
    return {rel(f): sha(f) for f in TARGET.rglob('*') if f.is_file()}


def check():
    audit = read(AUDIT)
    current = inventory()
    expected_files = dict(audit['chapterFilesBefore'])
    expected_files.update({c['target']: c['afterSha256'] for c in audit['changes']})
    removal_path = ROOT/'config/pet-story-removals-2026-11-26.json'
    removal = read(removal_path) if removal_path.exists() else None
    if removal:
        for f in removal['removedFiles']:
            expected_files.pop(f)
        expected_files[rel(TARGET/'configs/city.json')] = removal['manifestAfterSha256']
    assert current == expected_files, 'Unexpected chapter change'
    assert len(audit['changes']) == 14
    for c in audit['changes']:
        assert current[c['target']] == c['afterSha256'], c['target']
        if c['kind'] in ('image', 'thumbnail'):
            with Image.open(ROOT/c['target']) as image:
                image.load()
                assert image.format == 'JPEG' and image.size == ((306, 200) if c['kind'] == 'thumbnail' else (1024, 672))
    for f, h in audit['globalsBefore'].items():
        if removal and f == 'assets/resources/configs/cities.json':
            h = removal['indexAfterSha256']
        assert sha(ROOT/f) == h, 'Unrelated global asset changed: '+f
    for row in audit['updatedLevels']:
        target = TARGET/'configs'/row['folder']/'differences.json'
        actual = read(target)
        if row['config']:
            revision = row['config']
            expected = copy.deepcopy(revision['before'])
            expected['differences'] = actual['differences']
            assert actual == expected, 'Integration fields changed'
            source = Path(revision['source'])
            if source.exists():
                assert sha(source) == revision['sourceSha256']
                assert actual['differences'] == read(source)['differences']
    total = sum(len(read(TARGET/'configs'/e['folder']/'differences.json')['differences'])
                for e in read(TARGET/'configs/city.json')['levels'])
    assert total == (removal['differenceCount'] if removal else audit['differenceCount'])
    return dict(levels=len(read(TARGET/'configs/city.json')['levels']), updatedLevels=8, changedImages=7, changedConfigs=6, changedThumbnails=1, differenceCount=total)


def plan():
    if AUDIT.exists():
        raise ValueError('This correction is already applied; use --check')
    original = read(ROOT/'config/pet-story-additions-2026-11-25.json')
    origins = {r['id']: r for r in original['levels']}
    entries = read(TARGET/'configs/city.json')['levels']
    by_name = {r['name']: (i+1, r) for i, r in enumerate(entries)}
    rows, jobs = [], []
    for folder in sorted(SOURCE.iterdir()):
        if not folder.is_dir():
            continue
        name = re.sub(r'^\d+[.、．]\s*', '', folder.name)
        assert name in NAMES
        number, entry = by_name[name]
        configs = list(folder.glob('*.json'))
        assert len(configs) == 1
        data = read(configs[0])
        old_target = TARGET/'configs'/entry['folder']/'differences.json'
        old = read(old_target)
        assert all(old.get(k) == data.get(k) for k in set(old)|set(data) if k not in ('icon', 'differences'))
        ids = set()
        for d in data['differences']:
            assert d.get('id') and d['id'] not in ids
            ids.add(d['id'])
            assert all(isinstance(d.get(k), (int, float)) and not isinstance(d[k], bool) and math.isfinite(d[k]) for k in ('x', 'y', 'radius'))
            assert 0 <= d['x'] <= 1 and 0 <= d['y'] <= 1 and 0 < d['radius'] <= 1
        assert ids
        pictures, decoded = [], []
        for stem in ('scene-a', 'scene-b'):
            source = folder/(stem+'.png')
            with Image.open(source) as image:
                image.load()
                decoded.append(image.convert('RGB'))
            origin = next(im for im in origins[entry['id']]['images'] if Path(im['path']).stem == stem)
            target = ROOT/origin['path']
            assert sha(target) == origin['sha256'], 'Unexpected existing correction; review before overwriting'
            if sha(source) != origin['sourceSha256']:
                staged = STAGE/'images'/entry['folder']/(stem+'.jpg')
                staged.parent.mkdir(parents=True, exist_ok=True)
                job = dict(source=str(source), sourceSha256=sha(source), target=str(staged))
                jobs.append(job)
                pictures.append(dict(source=str(source), sourceSha256=sha(source), staged=str(staged),
                                     target=rel(target), beforeSha256=sha(target), kind='image'))
        assert decoded[0].size != decoded[1].size or ImageChops.difference(*decoded).getbbox() is not None
        config = None
        if old['differences'] != data['differences']:
            config = dict(source=str(configs[0]), sourceSha256=sha(configs[0]), target=rel(old_target),
                          beforeSha256=sha(old_target), before=old, oldDifferenceCount=len(old['differences']),
                          differenceCount=len(data['differences']), differences=data['differences'])
        rows.append(dict(**entry, chapterNumber=number, sourceFolder=folder.name, images=pictures, config=config))
    assert sorted(r['name'] for r in rows) == sorted(NAMES)
    assert len(jobs) == 7 and sum(r['config'] is not None for r in rows) == 6
    globals_ = [ROOT/'assets/resources/configs/cities.json', ROOT/'config/chapter-order.json',
                ROOT/'assets/PleyGame/fonts/FDTitleBobohei-Bold.ttf', ROOT/'config/app-version.json']
    write(STAGE/'plan.json', dict(date='2026-11-26', chapter='chong-wu-gu-shi', source=str(SOURCE),
        chapterFilesBefore=inventory(), globalsBefore={rel(f):sha(f) for f in globals_},
        updatedLevels=rows, differenceCountBefore=899, differenceCount=902))
    export = dict(quality=8, qualityScale=12, width=1024, height=672, progress=str(STAGE/'progress.txt'),
                  done=str(STAGE/'done.txt'), jobs=jobs)
    write(STAGE/'jobs.json', export)
    worker = (ROOT/'tools/export-content-jpeg.ps1').read_text(encoding='utf-8-sig').split("$script = @'", 1)[1].split("'@", 1)[0]
    (STAGE/'export.jsx').write_text(worker.replace('__SPEC__', json.dumps(export, ensure_ascii=True)), encoding='utf-8')
    return dict(images=7, configs=6, thumbnails=1, script=str(STAGE/'export.jsx'))


def apply():
    if AUDIT.exists():
        return check()
    audit = read(STAGE/'plan.json')
    assert inventory() == audit['chapterFilesBefore'], 'Project changed after review; regenerate the plan'
    cache = PhotoshopJpegs(STAGE)
    writes = []
    for row in audit['updatedLevels']:
        for picture in row['images']:
            data = cache.get(picture['source'])
            writes.append((ROOT/picture['target'], data, picture))
            if Path(picture['target']).stem == 'scene-a':
                with Image.open(io.BytesIO(data)) as image:
                    buf = io.BytesIO()
                    image.resize((306, 200), Image.Resampling.LANCZOS).save(buf, 'JPEG', quality=85, optimize=True)
                target = TARGET/'thumbnails'/row['folder']/'icon.jpg'
                writes.append((target, buf.getvalue(), dict(target=rel(target), kind='thumbnail', beforeSha256=sha(target))))
        revision = row['config']
        if revision:
            assert sha(Path(revision['source'])) == revision['sourceSha256']
            data = copy.deepcopy(revision['before'])
            data['differences'] = revision.pop('differences')
            encoded = (json.dumps(data, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
            writes.append((ROOT/revision['target'], encoded, dict(target=revision['target'], kind='config',
                                                               beforeSha256=revision['beforeSha256'])))
    assert len(writes) == 14
    backup = STAGE/'before'
    changes = []
    for target, data, record in writes:
        assert sha(target) == record['beforeSha256']
        saved = backup/target.relative_to(ROOT)
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(target.read_bytes())
        target.write_bytes(data)
        record['afterSha256'] = sha(target)
        changes.append({k:v for k,v in record.items() if k != 'staged'})
    audit['backup'] = rel(backup)
    audit['imageExport'] = cache.provenance
    audit['changes'] = changes
    for row in audit['updatedLevels']:
        if row['config']:
            row['config']['afterSha256'] = sha(ROOT/row['config']['target'])
    write(AUDIT, audit)
    return check()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    print(json.dumps(check() if args.check else apply() if args.apply else plan(), ensure_ascii=False))
