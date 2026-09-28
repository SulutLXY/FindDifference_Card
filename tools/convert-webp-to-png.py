"""Convert Cocos source images while preserving image/texture/sprite-frame UUIDs."""
import json
import zipfile
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'


def main():
    sources = sorted(ASSETS.rglob('*.webp'))
    if not sources:
        print('No WebP source assets remain.')
        return
    records = []
    for source in sources:
        target = source.with_suffix('.png')
        meta = Path(str(source) + '.meta')
        assert meta.is_file(), f'Missing metadata: {meta}'
        assert not target.exists() and not Path(str(target) + '.meta').exists(), target
        data = json.loads(meta.read_text(encoding='utf-8-sig'))
        with Image.open(source) as image:
            assert getattr(image, 'n_frames', 1) == 1, f'Animated image: {source}'
            image.load()
        records.append((source, target, meta, data))

    backup = ROOT / 'temp' / 'asset-migration' / datetime.now().strftime('%Y%m%d-%H%M%S')
    backup.mkdir(parents=True)
    with zipfile.ZipFile(backup / 'webp-originals.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for source, _, meta, _ in records:
            for path in (source, meta):
                archive.write(path, path.relative_to(ROOT))

    # Verify every conversion before removing any original source.
    report = []
    for source, target, meta, data in records:
        with Image.open(source) as image:
            image.save(target, format='PNG')
            with Image.open(target) as result:
                assert result.format == 'PNG' and result.size == image.size
                assert result.convert('RGBA').tobytes() == image.convert('RGBA').tobytes()
        original = meta.read_text(encoding='utf-8-sig')
        updated = original.replace('.webp', '.png')
        # No changes beyond extension strings are allowed in metadata.
        assert json.loads(updated) == json.loads(json.dumps(data).replace('.webp', '.png'))
        Path(str(target) + '.meta').write_text(updated, encoding='utf-8')
        report.append({'source': str(source.relative_to(ROOT)),
                       'target': str(target.relative_to(ROOT)), 'uuid': data['uuid'],
                       'before_bytes': source.stat().st_size, 'after_bytes': target.stat().st_size})

    for source, _, meta, _ in records:
        source.unlink()
        meta.unlink()
    (backup / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'converted': len(report), 'backup': str(backup),
                      'before_bytes': sum(r['before_bytes'] for r in report),
                      'after_bytes': sum(r['after_bytes'] for r in report)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
