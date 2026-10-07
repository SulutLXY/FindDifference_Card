"""Compress only the newly added lobby PNGs to 256 colors, preserving dimensions and metadata."""
from pathlib import Path
from datetime import datetime
from PIL import Image
import io
import json
import zipfile

root = Path(__file__).resolve().parents[1]
icons = root / 'assets/resources/textures/UI_Sprite/V3/icons'
files = [root / 'assets/Bundle/Texture' / name for name in ['ADDSubscription_01.png', 'ADDSubscription_02.png']]
files += [icons / name for name in ['icon_AddDesktop.png', 'icon_Gameflow.png', 'icon_Shar.png', 'icon_Subscription.png', '脑洞转的快icon_05.png']]
backup = root / 'temp/png-compression' / datetime.now().strftime('lobby-%Y%m%d-%H%M%S-%f')
backup.mkdir(parents=True)
records = []
with zipfile.ZipFile(backup / 'originals.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        original = path.read_bytes()
        meta = Path(str(path) + '.meta')
        meta_before = meta.read_bytes()
        with Image.open(io.BytesIO(original)) as image:
            rgba = image.convert('RGBA')
            out = io.BytesIO()
            quantized = rgba.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
            # Keep fully transparent / opaque endpoints despite palette averaging.
            palette = quantized.getpalette('RGBA')
            used = [index for _, index in quantized.getcolors(256)]
            low, high = rgba.getchannel('A').getextrema()
            lowest = min(used, key=lambda index: palette[index * 4 + 3])
            highest = max(used, key=lambda index: palette[index * 4 + 3])
            palette[lowest * 4 + 3] = low
            palette[highest * 4 + 3] = high
            quantized.putpalette(palette, rawmode='RGBA')
            quantized.save(out, format='PNG', optimize=True, compress_level=9)
            candidate = out.getvalue()
            with Image.open(io.BytesIO(candidate)) as check:
                assert check.size == image.size
                assert check.mode == 'P' and len(check.getcolors(256)) <= 256
                assert check.convert('RGBA').getchannel('A').getextrema() == rgba.getchannel('A').getextrema()
            archive.writestr(path.relative_to(root).as_posix(), original)
            archive.writestr(path.relative_to(root).as_posix() + '.meta', meta_before)
            if len(candidate) < len(original):
                path.write_bytes(candidate)
            assert meta.read_bytes() == meta_before
            records.append({'file': path.relative_to(root).as_posix(), 'size': image.size, 'before': len(original), 'after': path.stat().st_size})
report = {'before': sum(r['before'] for r in records), 'after': sum(r['after'] for r in records), 'files': records}
(backup / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
print('Backup:', backup)
