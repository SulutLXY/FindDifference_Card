"""Losslessly optimize source PNGs; keep dimensions, pixels and Cocos metadata."""
import hashlib
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    files = sorted(p for p in (ROOT/'assets').rglob('*') if p.suffix.lower() == '.png')
    backup = ROOT/'temp/png-compression'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True)
    records = []
    with zipfile.ZipFile(backup/'originals.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            original = path.read_bytes()
            meta = Path(str(path)+'.meta')
            meta_before = meta.read_bytes() if meta.exists() else None
            record = {'path': path.relative_to(ROOT).as_posix(), 'before': len(original), 'after':len(original)}
            with Image.open(io.BytesIO(original)) as image:
                image.load()
                if getattr(image, 'n_frames', 1) != 1 or image.mode not in ('RGB','RGBA','P','L','LA'):
                    record['status'] = 'skipped unsupported image'
                    records.append(record)
                    continue
                # Preserve all original ancillary chunks by using only a new IDAT stream.
                stream = io.BytesIO()
                image.save(stream, format='PNG', optimize=True, compress_level=9)
                candidate = preserve_chunks(original, stream.getvalue())
                with Image.open(io.BytesIO(candidate)) as check:
                    assert check.size == image.size
                    assert check.convert('RGBA').tobytes() == image.convert('RGBA').tobytes(), path
                if len(candidate) < len(original):
                    archive.writestr(record['path'], original)
                    if meta_before is not None: archive.writestr(record['path']+'.meta',meta_before)
                    temp = path.with_suffix('.png.compress-tmp')
                    temp.write_bytes(candidate)
                    temp.replace(path)
                    record['after'] = len(candidate)
                    record['status'] = 'compressed'
                else:
                    record['status'] = 'kept smaller original'
                assert (meta.read_bytes() if meta.exists() else None) == meta_before
                record['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
                records.append(record)
    result = {'count':len(records), 'compressed':sum(r['status']=='compressed' for r in records),
              'before':sum(r['before'] for r in records),'after':sum(r['after'] for r in records),'files':records}
    (backup/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='files'},ensure_ascii=False))
    print('Backup:',backup)


def chunks(data):
    offset = 8
    while offset < len(data):
        size = int.from_bytes(data[offset:offset+4], 'big')
        yield data[offset+4:offset+8],data[offset:offset+size+12]
        offset += size+12


def preserve_chunks(original, optimized):
    old, new = list(chunks(original)), list(chunks(optimized))
    # Encoding (bit depth, palette, interlace) must match to reuse original ancillary data.
    for kind in (b'IHDR',b'PLTE',b'tRNS'):
        if [c for k,c in old if k==kind] != [c for k,c in new if k==kind]:
            return original
    idat = b''.join(c for k,c in new if k==b'IDAT')
    result = original[:8]
    written = False
    for kind, chunk in old:
        if kind == b'IDAT':
            if not written: result += idat; written = True
        else: result += chunk
    return result


if __name__ == '__main__':
    main()
