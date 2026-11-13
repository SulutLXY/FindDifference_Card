"""Sync hand-edited JSON next to level images into runtime configs.

Default is a dry run. --apply writes changed differences only and saves an audit/backup.
--check exits nonzero if a source has not been synchronized. Source images/JSON,
published names, stable IDs, icons, types and collectible associations are preserved.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ROOT / 'assets/Bundle/levels'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def rel(path):
    return path.relative_to(ROOT).as_posix()


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def validate_points(points, label):
    if not isinstance(points, list) or not points:
        raise ValueError(f'{label}: missing differences')
    ids = set()
    for point in points:
        if not isinstance(point, dict) or not isinstance(point.get('id'), str) or not point['id'] or point['id'] in ids:
            raise ValueError(f'{label}: missing or duplicate difference ID')
        ids.add(point['id'])
        for key in ('x', 'y', 'radius'):
            value = point.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f'{label}/{point["id"]}: invalid {key}')
        if not (0 <= point['x'] <= 1 and 0 <= point['y'] <= 1 and 0 < point['radius'] <= 1):
            raise ValueError(f'{label}/{point["id"]}: outside normalized coordinates/radius')


def plan():
    index = read(ROOT / 'assets/resources/configs/cities.json')
    result, chapter_counts = [], {}
    for chapter in sorted(LEVELS.iterdir()):
        if not chapter.is_dir():
            continue
        for directory in sorted(chapter.iterdir()):
            if not directory.is_dir() or directory.name in ('configs', 'thumbnails', 'BGmusic'):
                continue
            sources = sorted(directory.glob('*.json'))
            if not sources:
                continue
            if len(sources) != 1:
                raise ValueError(f'{rel(directory)}: ambiguous source JSON files')
            entries = index['chapters'].get(chapter.name, {}).get('levels', [])
            entry = next((item for item in entries if isinstance(item, dict) and item['folder'] == directory.name), None)
            if entry is None:
                raise ValueError(f'{rel(directory)}: not in published level index')
            target = chapter / 'configs' / directory.name / 'differences.json'
            source = sources[0]
            src, old = read(source), read(target)
            validate_points(src.get('differences'), rel(source))
            validate_points(old.get('differences'), rel(target))
            if not (directory / 'scene-a.jpg').is_file() or not (directory / 'scene-b.jpg').is_file():
                raise ValueError(f'{rel(directory)}: missing image pair')
            if old['name'] != entry['name']:
                raise ValueError(f'{rel(target)}: canonical name/index mismatch')
            new = copy.deepcopy(old)
            new['differences'] = copy.deepcopy(src['differences'])
            images = []
            for filename in ('scene-a.jpg', 'scene-b.jpg'):
                image = directory / filename
                meta = image.with_name(image.name + '.meta')
                images.append(dict(path=rel(image), sha256=sha(image.read_bytes()), uuid=read(meta)['uuid'], metaSha256=sha(meta.read_bytes())))
            chapter_counts[chapter.name] = chapter_counts.get(chapter.name, 0) + 1
            result.append(dict(chapter=chapter.name, entry=entry, source=source, target=target,
                               old=old, new=new, sourceData=src, images=images,
                               sourceSha256=sha(source.read_bytes()), beforeBytes=target.read_bytes()))
    return result, chapter_counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check', action='store_true')
    parser.add_argument('--report', type=Path, default=ROOT / 'config/level-config-updates/2026-11-13.json')
    args = parser.parse_args()
    rows, chapters = plan()
    changes = [row for row in rows if row['old'] != row['new']]
    print(json.dumps(dict(discovered=chapters, pending=len(changes), pointCountChanged=sum(
        len(row['old']['differences']) != len(row['new']['differences']) for row in changes)), ensure_ascii=False))
    if args.check:
        return int(bool(changes))
    if not args.apply or not changes:
        return 0
    report = args.report.resolve()
    report.relative_to(ROOT)
    backup = report.with_name(report.stem + '.before.json')
    if report.exists() or backup.exists():
        raise ValueError('Audit/backup already exists; use a new --report path for another update')
    dump(backup, {rel(row['target']): row['old'] for row in changes})
    records = []
    for row in changes:
        # Preserve every integration field and use source annotation values verbatim.
        dump(row['target'], row['new'])
        previous = {point['id']: point for point in row['old']['differences']}
        current = {point['id']: point for point in row['new']['differences']}
        records.append(dict(chapter=row['chapter'], id=row['entry']['id'], folder=row['entry']['folder'],
            name=row['entry']['name'], sourceName=row['sourceData'].get('name'), source=rel(row['source']),
            target=rel(row['target']), sourceSha256=row['sourceSha256'],
            previousConfigSha256=sha(row['beforeBytes']), configSha256=sha(row['target'].read_bytes()),
            oldDifferenceCount=len(previous), differenceCount=len(current),
            changedPointIds=[key for key in current if key in previous and current[key] != previous[key]],
            addedPointIds=[key for key in current if key not in previous], removedPointIds=[key for key in previous if key not in current],
            largeRadiusPoints=[point for point in current.values() if point['radius'] > .2], images=row['images']))
    dump(report, dict(date='2026-11-13', backup=rel(backup), sourcePolicy='JSON beside current project level images; external art source JSON remains historical',
                     replacedFields=['differences'], discovered=chapters, updatedLevels=records))
    print(f'Updated {len(records)} levels; audit: {rel(report)}; backup: {rel(backup)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
