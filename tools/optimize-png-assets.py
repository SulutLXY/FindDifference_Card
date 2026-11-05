"""Stage/apply PNG optimization; preserve Cocos metadata, sizes and transparent outlines.

Collection icons and UI reference sheets use libimagequant with visual error checks.
Other assets and already indexed PNGs receive lossless recompression only.
Dependencies: Pillow/numpy; imagequant 1.1.5 may be installed in temp/png-tools.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import math
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOCAL_TOOLS = ROOT / 'temp/png-tools'
if LOCAL_TOOLS.exists():
    sys.path.insert(0, str(LOCAL_TOOLS))
import imagequant

spec = importlib.util.spec_from_file_location('png_lossless', ROOT / 'tools/compress-png.py')
lossless = importlib.util.module_from_spec(spec); spec.loader.exec_module(lossless)
AUDIT = ROOT / 'config/png-compression-2026-11-05.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def encode(image, info):
    stream = io.BytesIO()
    options = {key: info[key] for key in ('icc_profile', 'dpi') if key in info}
    image.save(stream, format='PNG', optimize=True, compress_level=9, **options)
    return stream.getvalue()


def features(rgba):
    values = rgba.astype(np.float32)
    alpha = values[..., 3:4] / 255.0
    black = values[..., :3] * alpha
    return np.concatenate((black, black + 255.0 * (1.0 - alpha)), axis=-1)


def remap_endpoints(indices, palette, original):
    """Preserve transparent outlines and keep source-opaque pixels fully opaque."""
    alpha = original[..., 3]
    # Near-opaque palette averaging must not make originally opaque artwork translucent.
    palette[palette[:, 3] >= 250, 3] = 255
    if np.any(alpha == 255) and not np.any(palette[:, 3] == 255):
        palette[np.argmax(palette[:, 3]), 3] = 255
    result = indices.copy()
    for mask, allowed in [(alpha == 0, palette[:, 3] == 0),
                          (alpha > 0, palette[:, 3] > 0),
                          (alpha == 255, palette[:, 3] == 255)]:
        bad = mask & ~allowed[result]
        if not np.any(bad):
            continue
        choices = np.flatnonzero(allowed)
        if not len(choices):
            return None
        pixels = features(original[bad])
        candidates = features(palette[choices])
        mapped = np.empty(len(pixels), dtype=np.uint8)
        for start in range(0, len(pixels), 1024):
            distance = ((pixels[start:start + 1024, None, :] - candidates[None, :, :]) ** 2).sum(axis=2)
            mapped[start:start + 1024] = choices[np.argmin(distance, axis=1)]
        result[bad] = mapped
    return result


def quality(before, after):
    visible = before[..., 3] > 0
    delta = features(before)[visible] - features(after)[visible]
    mse = float(np.mean(delta ** 2)) if delta.size else 0.0
    psnr = 99.0 if mse == 0 else 10 * math.log10(255 ** 2 / mse)
    alpha_delta = np.abs(before[..., 3].astype(np.int16) - after[..., 3].astype(np.int16))
    return {'visiblePSNR': round(psnr, 4), 'alphaMaxDelta': int(alpha_delta.max()),
            'alphaMeanDelta': round(float(alpha_delta.mean()), 6)}


def stage():
    folder = ROOT / 'temp/png-compression' / datetime.now().strftime('assets-%Y%m%d-%H%M%S-%f')
    folder.mkdir(parents=True)
    records = []
    files = sorted((ROOT / 'assets').rglob('*.png'))
    for number, path in enumerate(files, 1):
        original = path.read_bytes()
        meta = Path(str(path) + '.meta')
        meta_bytes = meta.read_bytes() if meta.exists() else None
        relative = path.relative_to(ROOT).as_posix()
        group = 'collection' if '/food-icons/' in relative else 'reference' if '/resources/UISet/' in relative else 'other'
        with Image.open(io.BytesIO(original)) as image:
            image.load()
            rgba = image.convert('RGBA')
            pixels = np.asarray(rgba)
            candidate = lossless.preserve_chunks(original, encode(image, image.info))
            mode = 'lossless' if len(candidate) < len(original) else 'unchanged'
            if len(candidate) >= len(original):
                candidate = original
            details = quality(pixels, pixels)
            if group in ('collection', 'reference') and image.mode != 'P' and getattr(image, 'n_frames', 1) == 1:
                try:
                    raw, flat_palette = imagequant.quantize_raw_rgba_bytes(rgba.tobytes(), *rgba.size,
                        min_quality=65, max_quality=100, max_colors=256, dithering_level=1.0)
                    palette = np.array(flat_palette, dtype=np.uint8).reshape((-1, 4))
                    indices = np.frombuffer(raw, dtype=np.uint8).reshape((rgba.height, rgba.width))
                    fixed = remap_endpoints(indices, palette, pixels)
                    if fixed is not None:
                        indexed = Image.frombytes('P', image.size, fixed.tobytes())
                        indexed.putpalette(palette.flatten().tolist(), rawmode='RGBA')
                        encoded = encode(indexed, image.info)
                        measured = quality(pixels, np.asarray(indexed.convert('RGBA')))
                        threshold = 35.0 if group == 'collection' else 34.0
                        if measured['visiblePSNR'] >= threshold and measured['alphaMaxDelta'] <= 64 and len(encoded) < len(candidate) * .90:
                            candidate, mode, details = encoded, 'palette256', measured
                except RuntimeError as error:
                    if 'Quality too low' not in str(error):
                        raise
            with Image.open(io.BytesIO(candidate)) as final:
                final.load()
                result = np.asarray(final.convert('RGBA'))
                assert final.size == image.size
                assert np.array_equal(pixels[..., 3] == 0, result[..., 3] == 0), relative
                assert np.all(result[..., 3][pixels[..., 3] == 255] == 255), relative
                if mode != 'palette256':
                    assert np.array_equal(pixels, result), relative
                record = {'path': relative, 'group': group, 'mode': mode, 'dimensions': list(image.size),
                          'before': len(original), 'after': len(candidate), 'beforeSha256': sha(original),
                          'afterSha256': sha(candidate), 'rgbaBeforeSha256': sha(rgba.tobytes()),
                          'rgbaAfterSha256': sha(final.convert('RGBA').tobytes()),
                          'metaSha256': sha(meta_bytes) if meta_bytes is not None else None,
                          'transparentMaskSha256': sha((pixels[..., 3] == 0).tobytes()),
                          'opaqueMaskSha256': sha((pixels[..., 3] == 255).tobytes()), **details}
            if len(candidate) < len(original):
                target = folder / 'candidates' / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(candidate)
            records.append(record)
        if number % 10 == 0:
            print(f'{number}/{len(files)} processed', flush=True)
    report = {'date': '2026-11-05', 'tool': 'imagequant 1.1.5 / libimagequant', 'minQuality': 65,
              'maxQuality': 100, 'maxColors': 256, 'dithering': 1.0, 'applied': False,
              'count': len(records), 'before': sum(row['before'] for row in records),
              'after': sum(row['after'] for row in records), 'files': records}
    write_json(folder / 'plan.json', report)
    print(json.dumps({'plan': str(folder / 'plan.json'), **summary(report)}, ensure_ascii=False), flush=True)
    return folder / 'plan.json'


def summary(report):
    output = {'count': report['count'], 'before': report['before'], 'after': report['after'], 'saved': report['before'] - report['after']}
    for group in ['collection', 'reference', 'other']:
        rows = [row for row in report['files'] if row['group'] == group]
        output[group] = {'count': len(rows), 'changed': sum(row['before'] != row['after'] for row in rows),
                         'before': sum(row['before'] for row in rows), 'after': sum(row['after'] for row in rows)}
    return output


def apply(plan):
    plan = plan.resolve()
    if not plan.is_relative_to((ROOT / 'temp/png-compression').resolve()):
        raise ValueError('压缩计划不在项目暂存目录')
    report = json.loads(plan.read_text(encoding='utf-8'))
    originals = {}
    for row in report['files']:
        target = (ROOT / row['path']).resolve()
        if not target.is_relative_to((ROOT / 'assets').resolve()):
            raise ValueError('目标超出项目资产目录')
        assert sha(target.read_bytes()) == row['beforeSha256'], f'{target}: source changed since preview'
        meta = Path(str(target) + '.meta')
        assert (sha(meta.read_bytes()) if meta.exists() else None) == row['metaSha256']
        if row['before'] != row['after']:
            candidate = plan.parent / 'candidates' / row['path']
            assert sha(candidate.read_bytes()) == row['afterSha256']
            originals[row['path']] = target.read_bytes()
    backup = plan.parent / 'originals.zip'
    with zipfile.ZipFile(backup, 'w', zipfile.ZIP_DEFLATED) as archive:
        for relative, data in originals.items():
            archive.writestr(relative, data)
            meta = ROOT / (relative + '.meta')
            if meta.exists(): archive.writestr(relative + '.meta', meta.read_bytes())
    try:
        for relative in originals:
            target = ROOT / relative
            temporary = target.with_suffix('.png.compress-tmp')
            temporary.write_bytes((plan.parent / 'candidates' / relative).read_bytes())
            temporary.replace(target)
        for row in report['files']:
            target = ROOT / row['path']; meta = Path(str(target) + '.meta')
            assert sha(target.read_bytes()) == row['afterSha256']
            assert (sha(meta.read_bytes()) if meta.exists() else None) == row['metaSha256']
    except BaseException:
        for relative, data in originals.items(): (ROOT / relative).write_bytes(data)
        raise
    report.update(applied=True, backup=str(backup.relative_to(ROOT)), summary=summary(report))
    write_json(AUDIT, report)
    write_json(plan.parent / 'report.json', report)
    print(json.dumps(report['summary'], ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', type=Path)
    args = parser.parse_args()
    apply(args.apply) if args.apply else stage()
