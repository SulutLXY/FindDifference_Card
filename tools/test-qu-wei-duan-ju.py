"""Validate 趣味短剧 source order/names, annotations, image metadata and isolated bundle."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
audit = read(ROOT / 'config/qu-wei-duan-ju-import.json')
index = read(ROOT / 'assets/resources/configs/cities.json')
key = audit['chapter']
chapter_root = ROOT / 'assets/Bundle/levels' / key
chapter = read(chapter_root / 'configs/city.json')
assert chapter['name'] == '趣味短剧' and len(chapter['levels']) == 35
assert index['chapters'][key] == {'key': key, **chapter}
for order in [index['cities'], index['navigation']]:
    assert order.index(key) == order.index('chong-wu-gu-shi') + 1
    assert order.index('meng-chong-san-guo') == order.index(key) + 1
ids = [level['id'] for c in index['chapters'].values() for level in c['levels']]
assert len(ids) == len(set(ids)) == 390
bundle = read(Path(str(chapter_root) + '.meta'))['userData']
assert bundle['isBundle'] and bundle['bundleName'] == key
builder = read(ROOT / 'settings/v2/packages/builder.json')
assert builder['bundleConfig']['custom'][bundle['bundleConfigID']]['configs']['miniGame']['fallbackOptions']['isRemote']
assert audit['imageExport']['encoder'].startswith('Photoshop ')
assert (audit['imageExport']['quality'], audit['imageExport']['qualityScale']) == (8, 12)


def image_check(path, size):
    with Image.open(path) as image:
        assert image.format == 'JPEG' and image.size == size, path
        image.load()
    meta = read(Path(str(path) + '.meta'))
    frame = meta['subMetas']['f9941']['userData']
    assert (frame['rawWidth'], frame['rawHeight']) == size
    return meta['uuid']


points, warnings = 0, []
for number, (level, row) in enumerate(zip(chapter['levels'], audit['levels']), 1):
    assert row['number'] == number and level == {k: row[k] for k in ['id', 'name', 'folder']}
    assert level['id'] == key + '/' + level['folder'] and 'level-' not in level['folder']
    config_path = chapter_root / 'configs' / level['folder'] / 'differences.json'
    config = read(config_path)
    assert config['name'] == level['name'] and config['type'] == 'normal'
    assert config['icon'] == f"thumbnails/{key}/{level['folder']}/icon/spriteFrame"
    assert read(Path(str(config_path) + '.meta'))['importer'] == 'json'
    assert len(config['differences']) == row['differenceCount']
    points += row['differenceCount']
    source = Path(audit['source']) / row['sourceFolder']
    if source.exists():
        assert digest(source / row['sourceConfig']) == row['configSha256']
        original = read(source / row['sourceConfig'])
        imported = {k: v for k, v in config.items() if k != 'icon'}
        assert imported == original, 'Preserve author title, type and annotations exactly'
    for record in row['images']:
        path = ROOT / record['path']
        assert digest(path) == record['sha256']
        assert image_check(path, (1024, 672)) == record['uuid']
        if source.exists():
            assert digest(source / record['sourceFile']) == record['sourceSha256']
    image_check(chapter_root / 'thumbnails' / level['folder'] / 'icon.jpg', (306, 200))
    warnings.extend((row['number'], warning) for warning in row['annotationWarnings'])
assert len(warnings) == 1 and warnings[0][0] == 27
assert warnings[0][1]['id'] == 'diff-5' and warnings[0][1]['y'] == -0.125806
assert chapter['levels'][0]['name'] == '三十年河东'
assert chapter['levels'][-1]['name'] == '猛将哥哥'
assert audit['levels'][8]['images'][0]['sourceFile'] == 'scene-a.jpeg'
cover = ROOT / f'assets/Bundle/chapter-covers/{key}-icon.jpg'
frame = read(Path(str(cover) + '.meta'))['subMetas']['f9941']['userData']
image_check(cover, (frame['rawWidth'], frame['rawHeight']))
sys.path.insert(0, str(ROOT / 'output/font-matching/python-deps'))
from fontTools.ttLib import TTFont
with TTFont(ROOT / 'assets/PleyGame/fonts/FDTitleBobohei-Bold.ttf') as font:
    chars = font.getBestCmap()
    assert all(ord(c) in chars for row in chapter['levels'] for c in row['name'])
    assert all(ord(c) in chars for c in chapter['name'])
print(f'PASS 趣味短剧: 35 ordered JSON titles, {points} exact author differences, 70 quality-8 JPEGs, isolated remote bundle and title font; 1 recorded edge-center warning')
