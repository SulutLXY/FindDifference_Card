"""Stage/apply high-bitrate MP3 compression and oversized level thumbnails.

Only MP3s above 96kbps and thumbnails above the existing 306x200 standard are
changed. Full-size scene-a/b JPEGs are inspected, never re-encoded. Originals
and metadata are backed up before --apply; existing UUIDs are preserved.
Requires ffmpeg, ffprobe, Pillow and numpy.
"""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'output/font-matching/python-deps'))
import numpy as np
from PIL import Image, ImageOps


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def probe(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration:stream=sample_rate,channels,bit_rate', '-of', 'json', str(path)]))


def decoded(path):
    values = np.frombuffer(run(['ffmpeg', '-v', 'error', '-i', str(path),
        '-f', 'f32le', '-ac', '2', '-ar', '44100', 'pipe:1']), dtype='<f4')
    if not len(values) or not np.all(np.isfinite(values)):
        raise ValueError('Invalid decoded audio: ' + str(path))
    return dict(duration=len(values) / 88200,
                rms=float(np.sqrt(np.mean(values.astype(np.float64) ** 2))),
                peak=float(np.max(np.abs(values))))


def image_meta(meta, width, height):
    frame = meta['subMetas']['f9941']['userData']
    frame.update(width=width, height=height, rawWidth=width, rawHeight=height,
                 trimX=0, trimY=0, offsetX=0, offsetY=0, trimType='none')
    frame['vertices'] = dict(
        rawPosition=[-width/2, -height/2, 0, width/2, -height/2, 0, -width/2, height/2, 0, width/2, height/2, 0],
        indexes=[0, 1, 2, 2, 1, 3], uv=[0, height, width, height, 0, 0, width, 0],
        nuv=[0, 0, 1, 0, 0, 1, 1, 1], minPos=[-width/2, -height/2, 0], maxPos=[width/2, height/2, 0])
    return (json.dumps(meta, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    stamp = datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%d-%H%M%S-%f')
    work = ROOT / 'temp/media-optimization' / stamp
    work.mkdir(parents=True)
    records, changes, scene_report, scene_hashes, skipped = [], [], [], {}, 0
    retained_for_quality = []

    def stage(source, data, kind, **details):
        relative = source.relative_to(ROOT).as_posix()
        original = source.read_bytes()
        candidate = work / 'candidates' / relative
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(data)
        record = dict(path=relative, kind=kind, beforeBytes=len(original), afterBytes=len(data),
                      beforeSha256=sha(original), afterSha256=sha(data), **details)
        records.append(record)
        changes.append((source, candidate, original))

    for source in sorted((ROOT / 'assets').rglob('*')):
        if not source.is_file() or source.suffix.lower() != '.mp3':
            continue
        before_info = probe(source)
        bitrate = int(before_info['streams'][0].get('bit_rate', 0))
        if bitrate <= 96000:
            skipped += 1
            continue
        target = work / 'encode.mp3'
        before = decoded(source)

        def encode(rate, gain=1):
            run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-map_metadata', '-1', '-vn',
                 '-af', f'volume={gain:.10f}', '-c:a', 'libmp3lame', '-b:a', str(rate), '-ar', '44100', '-ac', '2', str(target)])
            return decoded(target)

        accepted = False
        for target_rate in (96000, 128000, 160000):
            if target_rate >= bitrate:
                continue
            after = encode(target_rate)
            gain = before['rms'] / after['rms'] if after['rms'] else 1
            if abs(gain - 1) > .02:
                after = encode(target_rate, gain)
            else:
                gain = 1
            ratio = after['rms'] / before['rms'] if before['rms'] else 1
            if abs(before['duration'] - after['duration']) > .01 or not .98 <= ratio <= 1.02:
                continue
            if after['peak'] > max(1, before['peak']) * 1.05:
                continue
            accepted = True
            break
        if not accepted:
            retained_for_quality.append(source.relative_to(ROOT).as_posix())
            continue
        after_info = probe(target)
        if after_info['streams'][0].get('channels') != 2 or after_info['streams'][0].get('sample_rate') != '44100':
            raise ValueError('Audio channel/sample-rate mismatch: ' + str(source))
        meta = Path(str(source) + '.meta')
        raw = target.read_bytes()
        if len(raw) >= source.stat().st_size * .95:
            continue
        stage(source, raw, 'audio', oldBitrate=bitrate, newBitrate=target_rate, channels=2,
              uuid=json.loads(meta.read_text(encoding='utf-8'))['uuid'], metaSha256=sha(meta.read_bytes()),
              beforeAudio=before, afterAudio=after, rmsRatio=ratio, gainCorrection=gain)

    for source in sorted((ROOT / 'assets/Bundle/levels').rglob('*.jpg')):
        if source.name in ('scene-a.jpg', 'scene-b.jpg'):
            scene_hashes[source] = sha(source.read_bytes())
            with Image.open(source) as im:
                block = im.info.get('photoshop', {}).get(0x0406)
                # ExifTool Photoshop.pm JPEG_Quality: signed int16 + 4.
                quality = int.from_bytes(block[:2], 'big', signed=True) + 4 if isinstance(block, bytes) and len(block) >= 2 else None
                scene_report.append(dict(path=source.relative_to(ROOT).as_posix(), size=list(im.size), photoshopQuality=quality))
            continue
        if source.name != 'icon.jpg' or 'thumbnails' not in source.parts:
            continue
        with Image.open(source) as im:
            if im.size == (306, 200):
                continue
            if im.size != (1024, 672):
                raise ValueError('Unexpected thumbnail size, inspect first: ' + str(source))
            resized = ImageOps.fit(im.convert('RGB'), (306, 200), method=Image.Resampling.LANCZOS)
            output = io.BytesIO()
            resized.save(output, format='JPEG', quality=90, subsampling=0, optimize=True)
            data = output.getvalue()
            with Image.open(io.BytesIO(data)) as check:
                check.load()
                assert check.size == (306, 200)
            meta_path = Path(str(source) + '.meta')
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            stage(source, data, 'thumbnail', oldSize=[1024, 672], newSize=[306, 200], uuid=meta['uuid'])
            stage(meta_path, image_meta(meta, 306, 200), 'thumbnail-meta', uuid=meta['uuid'])

    archive = work / 'originals.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as backup:
        seen = set()
        for source, _, original in changes:
            for p, raw in [(source, original), (Path(str(source) + '.meta'), None)]:
                if not p.exists() or p in seen:
                    continue
                backup.writestr(p.relative_to(ROOT).as_posix(), raw if raw is not None else p.read_bytes())
                seen.add(p)
    # No writes to assets until every candidate and its backup has been validated.
    for source, _, original in changes:
        if sha(source.read_bytes()) != sha(original):
            raise ValueError('Asset changed while staging: ' + str(source))
    if args.apply:
        for index, (source, candidate, _) in enumerate(changes):
            buffer = work / f'apply-{index}'
            shutil.copyfile(candidate, buffer)
            os.replace(buffer, source)
        for row in records:
            p = ROOT / row['path']
            if p.suffix.lower() in ('.mp3', '.jpg'):
                assert json.loads(Path(str(p) + '.meta').read_text(encoding='utf-8'))['uuid'] == row['uuid']
            if row['kind'] == 'audio':
                assert sha(Path(str(p) + '.meta').read_bytes()) == row['metaSha256']
        for path, digest in scene_hashes.items():
            assert sha(path.read_bytes()) == digest, 'Full-size scene JPEG changed'
    media = [r for r in records if r['kind'] in ('audio', 'thumbnail')]
    report = dict(date='2026-11-12', applied=args.apply, backup=archive.relative_to(ROOT).as_posix(),
        audioFiles=sum(r['kind'] == 'audio' for r in records), skippedLowBitrateAudio=skipped,
        retainedForQuality=retained_for_quality,
        thumbnailFiles=sum(r['kind'] == 'thumbnail' for r in records),
        beforeBytes=sum(r['beforeBytes'] for r in media), afterBytes=sum(r['afterBytes'] for r in media),
        savedBytes=sum(r['beforeBytes']-r['afterBytes'] for r in media),
        sceneJpegsInspected=len(scene_report), fullSizeSceneJpegsModified=0,
        confirmedPhotoshop8=sum(r['photoshopQuality'] == 8 for r in scene_report),
        photoshopQualityUnknown=sum(r['photoshopQuality'] is None for r in scene_report),
        records=records, sceneJpegInspection=scene_report)
    (work / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.apply:
        (ROOT / 'config/media-optimization-2026-11-12.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('records','sceneJpegInspection')}, ensure_ascii=True))
    print('Report: ' + str(work / 'report.json'))


if __name__ == '__main__':
    main()
