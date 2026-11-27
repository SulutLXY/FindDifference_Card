"""Remove the five screenshot-selected levels; preserve surviving order and IDs."""
import argparse
import copy
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAPTER = ROOT/'assets/Bundle/levels/chong-wu-gu-shi'
INDEX = ROOT/'assets/resources/configs/cities.json'
MANIFEST = CHAPTER/'configs/city.json'
AUDIT = ROOT/'config/pet-story-removals-2026-11-26.json'
BACKUP = ROOT/'temp/pet-story-removals-2026-11-26/before'
NAMES = {'Happy 猫', '大开门稍息', '猫咪采访', '边牧智商压制', '狗狗萝卜纸巾挑战'}
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
rel = lambda p: p.relative_to(ROOT).as_posix()


def write(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')


def inventory():
    return {rel(p): sha(p) for p in CHAPTER.rglob('*') if p.is_file()}


def check():
    audit = read(AUDIT)
    expected = dict(audit['chapterFilesBefore'])
    for file in audit['removedFiles']:
        expected.pop(file)
        assert not (ROOT/file).exists(), file
    expected[rel(MANIFEST)] = audit['manifestAfterSha256']
    assert inventory() == expected, 'Unexpected chapter change'
    assert sha(INDEX) == audit['indexAfterSha256']
    manifest = read(MANIFEST)
    assert manifest['levels'] == audit['remainingLevels']
    assert len(manifest['levels']) == 66
    index = read(INDEX)
    prior = copy.deepcopy(audit['indexBefore'])
    prior['chapters']['chong-wu-gu-shi']['levels'] = audit['remainingLevels']
    assert index == prior, 'Other chapter/index fields changed'
    total = sum(len(read(CHAPTER/'configs'/row['folder']/'differences.json')['differences']) for row in manifest['levels'])
    assert total == audit['differenceCount']
    assert sum(len(c['levels']) for c in index['chapters'].values()) == 436
    return dict(removedLevels=5, levels=66, differenceCount=total, removedFiles=len(audit['removedFiles']), totalLevels=436)


def apply():
    if AUDIT.exists():
        return check()
    manifest, index = read(MANIFEST), read(INDEX)
    entries = manifest['levels']
    removed = [dict(row, previousNumber=i+1, differenceCount=len(read(CHAPTER/'configs'/row['folder']/'differences.json')['differences']))
               for i, row in enumerate(entries) if row['name'] in NAMES]
    assert len(entries) == 71 and len(removed) == 5 and {row['name'] for row in removed} == NAMES
    remaining = [row for row in entries if row['name'] not in NAMES]
    assert index['chapters']['chong-wu-gu-shi']['levels'] == entries
    roots = []
    for row in removed:
        folder = row['folder']
        assert folder and Path(folder).name == folder
        for parent in (CHAPTER, CHAPTER/'configs', CHAPTER/'thumbnails'):
            for target in (parent/folder, parent/(folder+'.meta')):
                # Check resolved absolute paths before moving directories recursively.
                target = target.resolve()
                assert target.is_relative_to(CHAPTER.resolve()) and target.exists()
                destination = BACKUP/target.relative_to(ROOT)
                assert destination.resolve().is_relative_to(BACKUP.resolve()) and not destination.exists()
                roots.append((target, destination))
    files = {rel(p): sha(p) for target, _ in roots for p in (target.rglob('*') if target.is_dir() else [target]) if p.is_file()}
    before = inventory()
    audit = dict(date='2026-11-26', chapter='chong-wu-gu-shi', removedLevels=removed, remainingLevels=remaining,
                 chapterFilesBefore=before, removedFiles=files, indexBefore=index, backup=rel(BACKUP),
                 differenceCount=902-sum(row['differenceCount'] for row in removed))
    # Back up both manifests before changing the runtime assets.
    for p in (MANIFEST, INDEX):
        saved = BACKUP/p.relative_to(ROOT)
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, saved)
    for target, destination in roots:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(target), str(destination))
    manifest['levels'] = remaining
    updated_index = copy.deepcopy(index)
    updated_index['chapters']['chong-wu-gu-shi']['levels'] = remaining
    write(MANIFEST, manifest)
    write(INDEX, updated_index)
    audit.update(manifestAfterSha256=sha(MANIFEST), indexAfterSha256=sha(INDEX))
    write(AUDIT, audit)
    return check()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(apply() if args.apply else check(), ensure_ascii=False))
