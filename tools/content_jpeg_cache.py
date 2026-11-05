"""Verify JPEGs exported by the Photoshop quality-8 worker before importing them."""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STAGE = ROOT / 'temp/content-jpegs-2026-11-05'


class PhotoshopJpegs:
    def __init__(self, stage=DEFAULT_STAGE):
        self.stage = Path(stage)
        self.spec = json.loads((self.stage / 'jobs.json').read_text(encoding='utf-8-sig'))
        self.done = (self.stage / 'done.txt').read_text(encoding='utf-8-sig')
        if 'JPEGSaveOptions.quality=8' not in self.done or self.spec['quality'] != 8 or self.spec['qualityScale'] != 12:
            raise ValueError('Photoshop 品质8导出尚未完成或参数不一致')
        if int(self.done.strip().splitlines()[-1]) != len(self.spec['jobs']):
            raise ValueError('Photoshop 导出数量不完整')
        self.by_source = {str(Path(job['source']).resolve()).casefold(): job for job in self.spec['jobs']}

    def get(self, source):
        key = str(Path(source).resolve()).casefold()
        if key not in self.by_source:
            raise ValueError('导出计划缺少源图片: ' + str(source))
        job = self.by_source[key]
        if hashlib.sha256(Path(source).read_bytes()).hexdigest() != job['sourceSha256']:
            raise ValueError('源图片已变化，请重新导出: ' + str(source))
        output = Path(job['target'])
        with Image.open(output) as image:
            if image.format != 'JPEG' or image.size != (1024, 672):
                raise ValueError('导出 JPEG 格式或尺寸错误: ' + str(output))
            image.load()
        return output.read_bytes()

    @property
    def provenance(self):
        return {'encoder': self.done.splitlines()[0], 'quality': 8, 'qualityScale': 12,
                'format': 'JPEG', 'size': [1024, 672], 'resize': 'full-image-bicubic-no-crop'}
