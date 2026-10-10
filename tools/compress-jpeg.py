"""Compress game JPEGs at Pillow quality 80 (approximation, not Photoshop's exact quality 8)."""
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    files = sorted(p for p in (ROOT / 'assets').rglob('*')
                   if p.is_file() and p.suffix.lower() in ('.jpg', '.jpeg'))
    backup = ROOT / 'temp/jpeg-compression' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True)
    records = []
    with zipfile.ZipFile(backup / 'originals.zip', 'w', zipfile.ZIP_STORED) as archive:
        for path in files:
            original = path.read_bytes()
            relative = path.relative_to(ROOT).as_posix()
            meta = Path(str(path) + '.meta')
            meta_before = meta.read_bytes() if meta.exists() else None
            archive.writestr(relative, original)
            if meta_before is not None:
                archive.writestr(relative + '.meta', meta_before)
            with Image.open(io.BytesIO(original)) as image:
                image.load()
                options = {key: image.info[key] for key in ('icc_profile', 'exif', 'dpi') if key in image.info}
                output = io.BytesIO()
                image.save(output, format='JPEG', quality=80, subsampling=0,
                           optimize=True, progressive=True, **options)
                candidate = output.getvalue()
                with Image.open(io.BytesIO(candidate)) as check:
                    check.load()
                    assert check.size == image.size and check.mode == image.mode, relative
                    assert check.info.get('icc_profile') == image.info.get('icc_profile'), relative
                changed = len(candidate) < len(original)
                if changed:
                    temporary = path.with_suffix(path.suffix + '.compress-tmp')
                    temporary.write_bytes(candidate)
                    temporary.replace(path)
                assert (meta.read_bytes() if meta.exists() else None) == meta_before, relative
                records.append({'path': relative, 'before': len(original), 'after': path.stat().st_size,
                                'size': image.size, 'compressed': changed})
    report = {'quality': 80, 'subsampling': '4:4:4', 'progressive': True, 'count': len(records),
              'compressed': sum(row['compressed'] for row in records),
              'before': sum(row['before'] for row in records),
              'after': sum(row['after'] for row in records), 'files': records}
    (backup / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'files'}))
    print('Backup:', backup)


if __name__ == '__main__':
    main()
