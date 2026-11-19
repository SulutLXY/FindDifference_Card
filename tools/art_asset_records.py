"""Keep audited art compression when an importer regenerates the identical source bytes."""
import hashlib
import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def records():
    result = {}
    for path in sorted((ROOT / 'config').glob('art-optimization-*.json')):
        audit = json.loads(path.read_text(encoding='utf-8'))
        if audit.get('applied'):
            result.update((row['path'], row) for row in audit['records'])
    return result


def retain_optimized_art(target, generated):
    if not target.exists():
        return generated
    row = records().get(target.relative_to(ROOT).as_posix())
    if not row or hashlib.sha256(generated).hexdigest() != row['beforeSha256']:
        return generated
    current = target.read_bytes()
    return current if hashlib.sha256(current).hexdigest() == row['afterSha256'] else generated
