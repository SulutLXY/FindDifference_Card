"""Stage shared-palette PNG animation groups and lossless JPEG entropy optimization."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'temp/art-optimization-2026-11-19'
AUDIT = ROOT / 'config/art-optimization-2026-11-19.json'
spec = importlib.util.spec_from_file_location('png_helpers', ROOT / 'tools/optimize-png-assets.py')
png = importlib.util.module_from_spec(spec)
spec.loader.exec_module(png)
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda data: hashlib.sha256(data).hexdigest()


def pixels(data):
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        return image.convert('RGBA').tobytes()


def stage():
    plan_path = WORK / 'plan.json'
    if plan_path.exists():
        raise ValueError('Staging plan already exists; retain the previous audit')
    groups = defaultdict(list)
    for row in read(ROOT / 'temp/art-new-png-candidates.json'):
        path = ROOT / row['path']
        group = str(path.parent) if '/Animation/' in row['path'] and re.search(r'_\s*\(\d+\)$', path.stem) else str(path)
        groups[group].append(path)
    records, previews = [], []

    def record(path, candidate, kind, **details):
        original = path.read_bytes()
        meta = Path(str(path) + '.meta')
        relative = path.relative_to(ROOT).as_posix()
        if len(candidate) >= len(original):
            candidate, kind = original, 'unchanged'
        target = WORK / 'candidates' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(candidate)
        records.append(dict(path=relative, kind=kind, beforeBytes=len(original), afterBytes=len(candidate),
            beforeSha256=sha(original), afterSha256=sha(candidate), metaSha256=sha(meta.read_bytes()),
            beforePixelsSha256=sha(pixels(original)), afterPixelsSha256=sha(pixels(candidate)), **details))

    for group, paths in sorted(groups.items()):
        opened = [Image.open(p) for p in sorted(paths)]
        arrays = [np.asarray(im.convert('RGBA')) for im in opened]
        width = max(im.width for im in opened)
        atlas = Image.new('RGBA', (width, sum(im.height for im in opened)))
        offset = 0
        for im in opened:
            atlas.paste(im.convert('RGBA'), (0, offset)); offset += im.height
        original_atlas = np.asarray(atlas)
        chosen = None
        threshold = 34 if len(paths) > 1 else 35
        for quality in [80, 65]:
            try:
                raw, flat_palette = png.imagequant.quantize_raw_rgba_bytes(atlas.tobytes(), *atlas.size,
                    min_quality=quality, max_quality=100, max_colors=256, dithering_level=1.0)
                palette = np.array(flat_palette, dtype=np.uint8).reshape((-1, 4))
                indices = np.frombuffer(raw, dtype=np.uint8).reshape((atlas.height, atlas.width))
                fixed = png.remap_endpoints(indices, palette, original_atlas)
                if fixed is None: continue
                # Rare semi-transparent edge pixels may choose a distant alpha during dithering.
                # Reuse colors from the SAME group palette with a close alpha; never punch holes.
                alpha = original_atlas[...,3]
                bad = (alpha > 0) & (alpha < 255) & (np.abs(alpha.astype(np.int16)-palette[fixed,3].astype(np.int16)) > 32)
                for alpha_value in np.unique(alpha[bad]):
                    mask = bad & (alpha == alpha_value)
                    allowed = np.flatnonzero((palette[:,3] > 0) & (np.abs(palette[:,3].astype(np.int16)-int(alpha_value)) <= 32))
                    if not len(allowed): continue
                    values, choices = png.features(original_atlas[mask]), png.features(palette[allowed])
                    distances = ((values[:,None,:]-choices[None,:,:])**2).sum(axis=2)
                    fixed[mask] = allowed[np.argmin(distances,axis=1)]
                candidates, measurements, offset = [], [], 0
                for im, array in zip(opened, arrays):
                    indexed = Image.frombytes('P', im.size, fixed[offset:offset+im.height, :im.width].tobytes())
                    indexed.putpalette(palette.flatten().tolist(), rawmode='RGBA')
                    candidate = png.encode(indexed, im.info)
                    result = np.asarray(indexed.convert('RGBA'))
                    measured = png.quality(array, result)
                    if not np.array_equal(array[...,3] == 0, result[...,3] == 0): break
                    if not np.all(result[...,3][array[...,3] == 255] == 255): break
                    if measured['visiblePSNR'] < threshold or measured['alphaMaxDelta'] > 32: break
                    candidates.append(candidate); measurements.append(measured); offset += im.height
                if len(candidates) == len(opened) and all(len(data) < p.stat().st_size * .9 for p, data in zip(sorted(paths), candidates)):
                    chosen = candidates, measurements
                    break
            except RuntimeError as error:
                if 'Quality too low' not in str(error): raise
        for index, (path, im, array) in enumerate(zip(sorted(paths), opened, arrays)):
            if chosen:
                candidate, measurement = chosen[0][index], chosen[1][index]
                kind = 'png-shared-palette' if len(paths) > 1 else 'png-palette'
            else:
                candidate = png.lossless.preserve_chunks(path.read_bytes(), png.encode(im, im.info))
                measurement, kind = png.quality(array, array), 'png-lossless'
            record(path, candidate, kind, size=list(im.size), group=Path(group).relative_to(ROOT).as_posix(),
                   transparentMaskSha256=sha((array[...,3] == 0).tobytes()), **measurement)
            if len(paths) > 1 and index in [0, len(paths)-1]: previews.append((path, path.read_bytes(), candidate))
            im.close()
        print('PNG group:', Path(group).name, 'frames:', len(paths), 'palette:', bool(chosen), flush=True)

    jpegtran = WORK / 'deps/libjpeg-turbo/bin/jpegtran.exe'
    paths = []
    for key in ['xun-song-ji', 'qu-wei-duan-ju']:
        paths += list((ROOT / 'assets/Bundle/levels' / key).glob('*/scene-*.jpg'))
        paths += list((ROOT / 'assets/Bundle/levels' / key).glob('thumbnails/*/icon.jpg'))
        paths.append(ROOT / f'assets/Bundle/chapter-covers/{key}-icon.jpg')
    for path in sorted(paths):
        original = path.read_bytes()
        candidate = subprocess.run([str(jpegtran), '-copy', 'all', '-optimize', str(path)], check=True,
            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0).stdout
        with Image.open(io.BytesIO(original)) as before, Image.open(io.BytesIO(candidate)) as after:
            before.load(); after.load()
            assert before.size == after.size and before.quantization == after.quantization, path
            assert before.convert('RGB').tobytes() == after.convert('RGB').tobytes(), path
            for key in ['icc_profile', 'exif', 'photoshop']:
                assert before.info.get(key) == after.info.get(key), (path, key)
            if path.name in ['scene-a.jpg', 'scene-b.jpg']:
                assert before.size == (1024,672)
                quality = before.info.get('photoshop', {}).get(0x0406)
                assert quality and int.from_bytes(quality[:2], 'big', signed=True)+4 == 8
            if len(candidate) > len(original) * .99 or len(original)-len(candidate) < 512:
                candidate = original
            record(path, candidate, 'jpeg-lossless', size=list(before.size), pixelsIdentical=True)
    plan = dict(date='2026-11-19', applied=False, pngThreshold=dict(minQuality=65, animationMinPSNR=34, staticMinPSNR=35, alphaMaxDelta=32,
        sharedPalettePerAnimation=True), jpegTool='libjpeg-turbo 3.2.1 jpegtran -copy all -optimize',
        records=records, summary=summary(records))
    png.write_json(plan_path, plan)
    # Before/after frames share the same checkerboard, scale and display color treatment.
    preview = Image.new('RGB', (840, len(previews)*205 + 40), '#f0f0f0')
    draw = ImageDraw.Draw(preview)
    label = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
    draw.text((20, 5), '原图 / 压缩后（各组首尾帧）', font=label, fill='#222222')
    for i, (path, before, after) in enumerate(previews):
        y = 40+i*205
        draw.text((8,y), path.parent.name, font=label, fill='#222222')
        for x, data in [(245,before),(535,after)]:
            with Image.open(io.BytesIO(data)) as im:
                rgba=im.convert('RGBA'); rgba.thumbnail((180,180))
                preview.paste(rgba,(x,y+20),rgba)
    preview.save(WORK/'animation-preview.png')
    print(json.dumps(plan['summary'], ensure_ascii=False))


def summary(records):
    result = {}
    for kind in ['png','jpeg']:
        rows = [r for r in records if Path(r['path']).suffix.lower() == ('.png' if kind == 'png' else '.jpg')]
        result[kind] = dict(inspected=len(rows), changed=sum(r['beforeSha256'] != r['afterSha256'] for r in rows),
            beforeBytes=sum(r['beforeBytes'] for r in rows), afterBytes=sum(r['afterBytes'] for r in rows))
    return result


def apply():
    if AUDIT.exists(): raise ValueError('Audit already exists; do not overwrite earlier results')
    plan = read(WORK/'plan.json')
    backup = WORK/'originals.zip'
    changed = [r for r in plan['records'] if r['beforeSha256'] != r['afterSha256']]
    for row in plan['records']:
        path = (ROOT/row['path']).resolve()
        assert path.is_relative_to((ROOT/'assets').resolve())
        assert sha(path.read_bytes()) == row['beforeSha256'], path
        assert sha(Path(str(path)+'.meta').read_bytes()) == row['metaSha256']
        assert sha((WORK/'candidates'/row['path']).read_bytes()) == row['afterSha256']
    with zipfile.ZipFile(backup,'w',zipfile.ZIP_DEFLATED) as archive:
        for row in changed:
            for relative in [row['path'],row['path']+'.meta']: archive.write(ROOT/relative,relative)
    try:
        for row in changed: (ROOT/row['path']).write_bytes((WORK/'candidates'/row['path']).read_bytes())
        for row in plan['records']:
            assert sha((ROOT/row['path']).read_bytes()) == row['afterSha256']
            assert sha((ROOT/(row['path']+'.meta')).read_bytes()) == row['metaSha256']
    except BaseException:
        with zipfile.ZipFile(backup) as archive:
            for row in changed: (ROOT/row['path']).write_bytes(archive.read(row['path']))
        raise
    plan.update(applied=True,backup=backup.relative_to(ROOT).as_posix())
    png.write_json(AUDIT,plan)
    print(json.dumps(plan['summary'],ensure_ascii=False))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    apply() if args.apply else stage()
