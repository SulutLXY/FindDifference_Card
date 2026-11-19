"""Validate chapter order, original annotations, remote loading layout and image metadata."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
audit = read(ROOT / 'config/xun-song-ji-import.json')
index = read(ROOT / 'assets/resources/configs/cities.json')
key = audit['chapter']
chapter_root = ROOT / 'assets/Bundle/levels' / key
chapter = read(chapter_root / 'configs/city.json')
assert chapter['name'] == '寻宋记' and len(chapter['levels']) == 30
assert index['chapters'][key] == {'key': key, **chapter}
for order in [index['cities'], index['navigation']]:
    assert order.index(key) == order.index('qing-hua-ci') + 1
assert index['badges'][key] == 'new'
ids = [level['id'] for c in index['chapters'].values() for level in c['levels']]
assert len(ids) == len(set(ids))
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


points = 0
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
        assert config['differences'] == read(source / row['sourceConfig'])['differences']
    for record in row['images']:
        path = ROOT / record['path']
        assert digest(path) == record['sha256']
        assert image_check(path, (1024, 672)) == record['uuid']
        if source.exists():
            assert digest(source / (path.stem + '.png')) == record['sourceSha256']
    image_check(chapter_root / 'thumbnails' / level['folder'] / 'icon.jpg', (306, 200))
# Chapter cover artwork is editable independently of level-one pictures.
cover = ROOT / f'assets/Bundle/chapter-covers/{key}-icon.jpg'
cover_frame = read(Path(str(cover) + '.meta'))['subMetas']['f9941']['userData']
image_check(cover, (cover_frame['rawWidth'], cover_frame['rawHeight']))
print(f'PASS 寻宋记: 30 ordered levels, {points} original differences, JPEG quality 8/12, remote bundle and navigation')
