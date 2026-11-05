"""Plan read-only source imports and stage Photoshop quality 8/12 JPEG exports."""
import hashlib
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / 'temp/content-jpegs-2026-11-05'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plan():
    jobs = []
    for chapter, source in [('qing-hua-ci', Path(r'D:\CocosCreator\关卡\青花瓷')),
                            ('wang-luo-re-dian', Path(r'D:\CocosCreator\关卡\热点玩法'))]:
        records = []
        for folder in source.iterdir():
            if not folder.is_dir():
                continue
            pictures = [p for p in folder.iterdir() if p.suffix.lower() in {'.png', '.jpg', '.jpeg'}]
            reference = [p for p in pictures if p.name.startswith('图片_')]
            other = [p for p in pictures if not p.name.startswith('图片_')]
            if len(reference) != 1 or len(other) != 1 or len(list(folder.glob('*.json'))) != 1:
                raise ValueError('图片或标注不能唯一匹配: ' + str(folder))
            number = int(re.match(r'^图片_(\d+)', reference[0].name)[1]) if chapter == 'wang-luo-re-dian' else int(folder.name.split('.')[0])
            records.append((number, folder, other[0], reference[0]))
        records.sort()
        expected = 60 if chapter == 'qing-hua-ci' else 10
        if len(records) != expected or (chapter == 'wang-luo-re-dian' and [r[0] for r in records] != list(range(1, 11))):
            raise ValueError('源关卡数量或顺序不完整: ' + chapter)
        for number, folder, top, bottom in records:
            for source_file, stem in [(top, 'scene-a'), (bottom, 'scene-b')]:
                target = STAGE / chapter / folder.name / (stem + '.jpg')
                target.parent.mkdir(parents=True, exist_ok=True)
                jobs.append({'chapter': chapter, 'number': number, 'folder': folder.name, 'stem': stem,
                             'source': str(source_file), 'sourceSha256': sha(source_file), 'target': str(target)})
    STAGE.mkdir(parents=True, exist_ok=True)
    spec = {'quality': 8, 'qualityScale': 12, 'width': 1024, 'height': 672,
            'progress': str(STAGE / 'progress.txt'), 'done': str(STAGE / 'done.txt'), 'jobs': jobs}
    target = STAGE / 'jobs.json'
    content = json.dumps(spec, ensure_ascii=True, indent=2) + '\n'
    changed = not target.exists() or target.read_text(encoding='utf-8') != content
    if changed:
        target.write_text(content, encoding='utf-8')
        (STAGE / 'done.txt').unlink(missing_ok=True)
    # Capture existing validator warnings before changing the published chapter index.
    module_spec = importlib.util.spec_from_file_location('manifest', ROOT / 'tools/build-manifest.py')
    module = importlib.util.module_from_spec(module_spec); module_spec.loader.exec_module(module)
    index = json.loads((ROOT / 'assets/resources/configs/cities.json').read_text(encoding='utf-8-sig'))
    problems = [issue for key in index['cities'] for level in index['chapters'][key]['levels']
                for issue in module.check_level(key, level['folder'])]
    baseline = STAGE / 'baseline-validation.json'
    if not baseline.exists():
        baseline.write_text(json.dumps(problems, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'jobs': len(jobs), 'manifest': str(target), 'existingWarnings': len(problems)}


if __name__ == '__main__':
    print(json.dumps(plan(), ensure_ascii=False, indent=2))
