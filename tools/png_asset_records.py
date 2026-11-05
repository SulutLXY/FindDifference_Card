"""Retain an audited optimized PNG when a source importer regenerates identical pixels."""
import hashlib
import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'config/png-compression-2026-11-05.json'


def retain_optimized_png(target, generated):
    if not AUDIT.exists() or not target.exists():
        return generated
    report = json.loads(AUDIT.read_text(encoding='utf-8'))
    if not report.get('applied'):
        return generated
    relative = target.relative_to(ROOT).as_posix()
    record = next((row for row in report['files'] if row['path'] == relative), None)
    if not record:
        return generated
    current = target.read_bytes()
    if hashlib.sha256(current).hexdigest() != record['afterSha256']:
        return generated
    with Image.open(io.BytesIO(generated)) as image:
        pixel_hash = hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest()
    return current if pixel_hash == record['rgbaBeforeSha256'] else generated
