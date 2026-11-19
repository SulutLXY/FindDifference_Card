"""Optimize source PNGs, optionally quantizing to 256 colors; preserve dimensions and Cocos metadata."""
import hashlib
import argparse
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--colors', type=int, choices=[256], help='Lossy 256-color palette compression, including alpha')
    parser.add_argument('--paths', type=Path, help='JSON array of selected project-relative PNG asset paths')
    parser.add_argument('--report', type=Path, help='Persist report to a new JSON file inside config')
    args = parser.parse_args()
    files = sorted(p for p in (ROOT/'assets').rglob('*') if p.suffix.lower() == '.png')
    if args.paths:
        paths = json.loads(args.paths.read_text(encoding='utf-8-sig'))
        if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
            raise ValueError('Expected a JSON array of PNG asset paths')
        files = sorted({(ROOT/p).resolve() for p in paths})
        if any(not p.is_relative_to((ROOT/'assets').resolve()) or not p.is_file() or p.suffix.lower() != '.png' for p in files):
            raise ValueError('Selected PNG is missing or outside assets')
    report_path = args.report.resolve() if args.report else None
    if report_path and (not report_path.is_relative_to((ROOT/'config').resolve()) or report_path.exists()):
        raise ValueError('Use a new report filename inside config; existing audit reports are retained')
    backup = ROOT/'temp/png-compression'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True)
    records = []
    with zipfile.ZipFile(backup/'originals.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            original = path.read_bytes()
            meta = Path(str(path)+'.meta')
            meta_before = meta.read_bytes() if meta.exists() else None
            record = {'path': path.relative_to(ROOT).as_posix(), 'before': len(original), 'after':len(original),
                      'beforeSha256': hashlib.sha256(original).hexdigest(),
                      'metaSha256': hashlib.sha256(meta_before).hexdigest() if meta_before else None}
            with Image.open(io.BytesIO(original)) as image:
                image.load()
                if getattr(image, 'n_frames', 1) != 1 or image.mode not in ('RGB','RGBA','P','L','LA'):
                    record['status'] = 'skipped unsupported image'
                    records.append(record)
                    continue
                stream = io.BytesIO()
                if args.colors and image.mode != 'P':
                    rgba = image.convert('RGBA')
                    quantized = rgba.quantize(colors=args.colors, method=Image.Quantize.FASTOCTREE)
                    # Preserve transparent/opaque endpoints when palette colors are averaged.
                    palette = quantized.getpalette('RGBA')
                    used = [index for _, index in quantized.getcolors(256)]
                    low, high = rgba.getchannel('A').getextrema()
                    lowest = min(used, key=lambda index: palette[index * 4 + 3])
                    highest = max(used, key=lambda index: palette[index * 4 + 3])
                    palette[lowest * 4 + 3] = low
                    palette[highest * 4 + 3] = high
                    quantized.putpalette(palette, rawmode='RGBA')
                    options = {k:image.info[k] for k in ('icc_profile','dpi') if k in image.info}
                    quantized.save(stream, format='PNG', optimize=True, compress_level=9, **options)
                    candidate = stream.getvalue()
                else:
                    # Already indexed PNGs avoid another lossy pass.
                    image.save(stream, format='PNG', optimize=True, compress_level=9)
                    candidate = preserve_chunks(original, stream.getvalue())
                with Image.open(io.BytesIO(candidate)) as check:
                    assert check.size == image.size
                    if args.colors:
                        assert check.mode == 'P' and len(check.getcolors(256) or []) > 0, path
                        before_alpha = image.convert('RGBA').getchannel('A')
                        after_alpha = check.convert('RGBA').getchannel('A')
                        record['alpha_range_before'] = before_alpha.getextrema()
                        record['alpha_range_after'] = after_alpha.getextrema()
                        assert before_alpha.getextrema() == after_alpha.getextrema(), path
                        record['colors'] = len(check.getcolors(256))
                    else:
                        assert check.convert('RGBA').tobytes() == image.convert('RGBA').tobytes(), path
                if len(candidate) < len(original) or (args.colors and image.mode != 'P'):
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
    result = {'mode':'palette256' if args.colors else 'lossless', 'count':len(records), 'compressed':sum(r['status']=='compressed' for r in records),
              'backup':str((backup/'originals.zip').relative_to(ROOT)),
              'before':sum(r['before'] for r in records),'after':sum(r['after'] for r in records),'files':records}
    (backup/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    if report_path: report_path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
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
