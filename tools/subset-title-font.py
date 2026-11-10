"""Subset the title font from current chapter/level names, ASCII and punctuation.

Run from any directory: python tools/subset-title-font.py
Dependencies: fonttools brotli Pillow (local output/font-matching/python-deps supported).
Produces standalone artifacts; does not replace any game UI fonts.
"""

from pathlib import Path
import argparse
import hashlib
import json
import shutil
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'output/font-matching/python-deps'))
from fontTools import __version__ as fonttools_version
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from PIL import Image, ImageChops, ImageDraw, ImageFont

PUNCTUATION = '，。！？：；、（）【】《》“”‘’—…·￥¥～〈〉「」『』〔〕［］｛｝＋－×÷＝％＃＠＆＊'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def inventory():
    records, paths = [], set()

    def add(path, kind, chapter, name, identity=''):
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f'Missing display name: {path}, {identity}')
        paths.add(path)
        records.append(dict(source=path.relative_to(ROOT).as_posix(), kind=kind,
                            chapter=chapter, id=identity, name=name))

    index_path = ROOT / 'assets/resources/configs/cities.json'
    index = read(index_path)
    for key, chapter in index['chapters'].items():
        add(index_path, 'chapter', key, chapter['name'], key)
        for level in chapter['levels']:
            if isinstance(level, str):
                raise ValueError(f'Expected explicit level name: {key}/{level}')
            add(index_path, 'level', key, level['name'], level['id'])
    for topic in index.get('topics', []):
        add(index_path, 'topic', topic['key'], topic['name'], topic['key'])

    # Source manifests and fallback level names may contain unpublished or renamed text.
    for path in sorted(ROOT.glob('assets/Bundle/levels/*/configs/city.json')):
        data, key = read(path), path.parts[-3]
        add(path, 'source-chapter', key, data['name'], key)
        for level in data['levels']:
            if isinstance(level, dict):
                add(path, 'source-level', key, level['name'], level['id'])
    for path in sorted(ROOT.glob('assets/Bundle/levels/*/configs/*/differences.json')):
        data = read(path)
        add(path, 'fallback-level', path.parts[-4], data['name'], path.parts[-2])
    for path in sorted(ROOT.glob('config/topics/*.json')):
        data = read(path)
        add(path, 'source-topic', data['key'], data['name'], data['key'])
    return index, records, paths


def rename_font(font):
    # A separate family avoids collisions with the full font in design tools/caches.
    names = font['name']
    replacements = {1: 'FD Title Bobohei', 2: 'Bold', 3: 'FDTitleBobohei-Bold-Subset-1.710',
                    4: 'FD Title Bobohei Bold', 6: 'FDTitleBobohei-Bold',
                    16: 'FD Title Bobohei', 17: 'Bold'}
    for record in list(names.names):
        if record.nameID in replacements:
            names.removeNames(nameID=record.nameID, platformID=record.platformID,
                              platEncID=record.platEncID, langID=record.langID)
    for identity, value in replacements.items():
        names.setName(value, identity, 3, 1, 0x409)
        names.setName(value, identity, 1, 0, 0)


def verify_rendering(original, trimmed, texts, required):
    # Verify outlines independently of FreeType's automatic hinting sample selection,
    # which can change when a font has fewer glyphs even with identical contours.
    source, result = TTFont(original), TTFont(trimmed)
    for code in sorted(required):
        drawings, metrics = [], []
        for font in (source, result):
            name = font.getBestCmap()[code]
            glyphs = font.getGlyphSet()
            pen = DecomposingRecordingPen(glyphs)
            glyphs[name].draw(pen)
            drawings.append(pen.value)
            metrics.append(font['hmtx'][name])
        assert drawings[0] == drawings[1], f'Outline changed: U+{code:04X}'
        assert metrics[0] == metrics[1], f'Advance/bearing changed: U+{code:04X}'
    for table, fields in [('head', ['unitsPerEm']), ('hhea', ['ascent', 'descent', 'lineGap']),
                          ('OS/2', ['sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'usWinAscent', 'usWinDescent'])]:
        for field in fields:
            assert getattr(source[table], field) == getattr(result[table], field), f'Line metrics changed: {field}'
    source.close()
    result.close()
    fonts = [ImageFont.truetype(str(p), 48) for p in (original, trimmed)]
    identical, auto_hint_changes = 0, []
    for text in texts:
        boxes = [f.getbbox(text) for f in fonts]
        if fonts[0].getlength(text) != fonts[1].getlength(text):
            raise AssertionError(f'Metrics changed: {text}')
        left, top = min(b[0] for b in boxes), min(b[1] for b in boxes)
        right, bottom = max(b[2] for b in boxes), max(b[3] for b in boxes)
        images = []
        for font in fonts:
            im = Image.new('L', (max(1, right-left+8), max(1, bottom-top+8)))
            ImageDraw.Draw(im).text((4-left, 4-top), text, font=font, fill=255)
            images.append(im)
        if ImageChops.difference(*images).getbbox():
            auto_hint_changes.append(text)
        else:
            identical += 1
    return dict(outlinesAndMetricsPassed=len(required), titleWidthsPassed=len(texts),
                rasterPixelIdentical=identical, rasterAutoHintDifferences=len(auto_hint_changes),
                rasterNote='FreeType auto-hinting may differ after subsetting; outlines and advances verified identical.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', type=Path, default=ROOT / 'docs/art-source/fonts/KNBobohei-Bold/KNBobohei-Bold.ttf')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/font-matching/KNBobohei-Titles')
    parser.add_argument('--install', action='store_true', help='Copy TTF and OFL into assets/PleyGame/fonts, preserving existing UUIDs')
    args = parser.parse_args()
    original, out = args.font.resolve(), args.output.resolve()
    license_path = original.with_name('OFL.txt')
    license_text = license_path.read_text(encoding='utf-8')
    if 'SIL OPEN FONT LICENSE' not in license_text:
        raise ValueError('Expected original OFL license alongside the source font')
    index, records, sources = inventory()
    names = list(dict.fromkeys(item['name'] for item in records))
    ascii_text = ''.join(chr(code) for code in range(0x20, 0x7f))
    text = ''.join(sorted(set(''.join(names) + ascii_text + PUNCTUATION), key=ord))
    required = {ord(char) for char in text}
    font = TTFont(original, recalcTimestamp=False)
    missing = sorted(required - font.getBestCmap().keys())
    if missing:
        raise ValueError('Source font is missing: ' + ', '.join(f'U+{code:04X} {chr(code)}' for code in missing))
    original_count = len(font.getGlyphOrder())
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.name_legacy = True
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.hinting = True
    options.ignore_missing_unicodes = False
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=required)
    subsetter.subset(font)
    rename_font(font)
    out.mkdir(parents=True, exist_ok=True)
    ttf = out / 'FDTitleBobohei-Bold.ttf'
    font.save(ttf)
    font.close()
    trimmed = TTFont(ttf, recalcTimestamp=False)
    assert required <= trimmed.getBestCmap().keys(), 'Subset dropped required characters'
    subset_count = len(trimmed.getGlyphOrder())
    for identity in (0, 13, 14):
        assert trimmed['name'].getDebugName(identity), 'Missing copyright/license metadata'
    trimmed.flavor = 'woff2'
    woff2 = out / 'FDTitleBobohei-Bold.woff2'
    trimmed.save(woff2)
    trimmed.close()
    webfont = TTFont(woff2)
    assert required <= webfont.getBestCmap().keys(), 'WOFF2 dropped required characters'
    webfont.close()
    verification = verify_rendering(original, ttf, names + [ascii_text, PUNCTUATION], required)
    shutil.copyfile(license_path, out / 'OFL.txt')
    (out / 'characters.txt').write_text(text + '\n', encoding='utf-8')
    (out / 'names.txt').write_text('\n'.join(names) + '\n', encoding='utf-8')
    write_json(out / 'name-inventory.json', records)
    counts = dict(chapters=len(index['chapters']), topics=len(index.get('topics', [])),
                  publishedLevels=sum(len(c['levels']) for c in index['chapters'].values()),
                  nameRecords=len(records), uniqueNames=len(names),
                  titleCharacters=len(set(''.join(names))), retainedCharacters=len(required),
                  originalGlyphs=original_count, subsetGlyphs=subset_count)
    report = dict(counts=counts, fontTools=fonttools_version, sourceFont=original.relative_to(ROOT).as_posix(),
                  originalBytes=original.stat().st_size, ttfBytes=ttf.stat().st_size,
                  woff2Bytes=woff2.stat().st_size,
                  ttfReductionPercent=round((1-ttf.stat().st_size/original.stat().st_size)*100, 2),
                  missingCharacters=[], verification=verification,
                  inputSha256={p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in sorted(sources | {original, license_path})},
                  outputSha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ttf, woff2)})
    write_json(out / 'report.json', report)
    chapters = list(dict.fromkeys(r['name'] for r in records if r['kind'] in ('chapter', 'topic')))
    # Preview current chapter names plus a sample from each chapter.
    preview_texts = chapters + [chapter['levels'][0]['name'] for chapter in index['chapters'].values() if chapter['levels']]
    preview_texts += ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz 0123456789', PUNCTUATION]
    im = Image.new('RGB', (1500, 90 + ((len(preview_texts)+2)//3)*90), '#faf8f1')
    draw = ImageDraw.Draw(im)
    label = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 28)
    display = ImageFont.truetype(str(ttf), 40)
    draw.text((30, 20), '荆南波波黑 · 章节与关卡专用子集（字形保持不变）', font=label, fill='#512c0c')
    for i, value in enumerate(preview_texts):
        # Fit long punctuation and alphabet strings within their column.
        size = min(40, int(450 / max(1, display.getlength(value)) * 40))
        f = ImageFont.truetype(str(ttf), max(12, size))
        draw.text((30+(i%3)*490, 90+(i//3)*90), value, font=f, fill='#512c0c')
    im.save(out / 'preview.png')
    md = f'''# 荆南波波黑：章节与关卡名称子集

由项目当前配置自动提取：{counts['chapters']} 个章节、{counts['topics']} 个上层专题、{counts['publishedLevels']} 个关卡。
同时扫描章节源清单和 differences.json 的备用名称，详见 name-inventory.json（每个名称含来源）。

- 名称用字去重：{counts['titleCharacters']} 个；加上大小写英文字母、数字和标点后保留 {counts['retainedCharacters']} 个 Unicode 字符。
- 原始 TTF：{report['originalBytes']:,} 字节。
- 专用 TTF：{report['ttfBytes']:,} 字节，减少 {report['ttfReductionPercent']}%。
- 网页 WOFF2：{report['woff2Bytes']:,} 字节（网页备用；Cocos Creator 优先使用 TTF）。
- 全部 {counts['retainedCharacters']} 个保留字符均通过原版/子集轮廓与字宽/侧边距一致性检查，缺字为 0。
- 全部 {len(names)} 个不同名称、英文符号集、中文符号集均通过排版宽度一致性检查，字体行高参数保持不变。
- 子集化后 FreeType 的自动微调可能导致像素栅格化细节不同；轮廓不变，像素对比统计见 report.json。

## 文件

- FDTitleBobohei-Bold.ttf：Cocos/设计软件可用的子集字体，字体家族名为 FD Title Bobohei，Bold。
- FDTitleBobohei-Bold.woff2：网页备用格式。
- characters.txt：准确保留的字符列表，包含 ASCII 空格。
- names.txt / name-inventory.json：名称清单及来源。
- report.json：统计、配置哈希、字体哈希、验证结果。
- OFL.txt：原始商用许可证，随字体发布时一并保留。

## 授权与范围

原字体：https://github.com/maoken-fonts/KNBobohei ，版本 1.710，SIL OFL 1.1。
允许免费商用、嵌入、子集与再分发；本子集继续按 OFL 1.1 发布，保留原版权与许可元数据。
仅裁剪不需要的字形并修改字体名称，保留 hinting/栅格化设置，未修改字形轮廓。字体名称单独命名避免与完整版缓存冲突。

此字体专用于当前章节/关卡名称及所列字符，不能充当任意中文正文或用户昵称字体。
新增章节、改名或新增关卡后，应重新执行裁剪命令；缺少字符时脚本会报错，不会静默漏字。

## 重建

在工程根目录运行：

```powershell
python tools/subset-title-font.py
```

重新生成并同步到 PleyGame 资源包（保留现有资源 UUID）：

```powershell
python tools/subset-title-font.py --install
```

依赖：fonttools、brotli、Pillow。脚本支持从 output/font-matching/python-deps 读取本项目安装的依赖。
原始字体与许可证默认位于 docs/art-source/fonts/KNBobohei-Bold；也可通过 --font 指定。
已创建可直接导入的字体文件；尚未更改游戏预制体或 Label 字体绑定。
'''
    (out / 'README.md').write_text(md, encoding='utf-8')
    if args.install:
        target = ROOT / 'assets/PleyGame/fonts'
        target.mkdir(parents=True, exist_ok=True)
        for source in (ttf, out / 'OFL.txt'):
            destination = target / source.name
            if not destination.exists() or source.read_bytes() != destination.read_bytes():
                shutil.copyfile(source, destination)
            assert source.read_bytes() == destination.read_bytes()
        for asset, importer, version in [(target, 'directory', '1.2.0'),
                                          (target / ttf.name, 'ttf-font', '1.0.1'),
                                          (target / 'OFL.txt', 'text', '1.0.1')]:
            meta = asset.with_name(asset.name + '.meta')
            if not meta.exists():
                write_json(meta, dict(ver=version, importer=importer, imported=False,
                                      uuid=str(uuid.uuid4()), files=[], subMetas={}, userData={}))
        print('Installed TTF and OFL: assets/PleyGame/fonts (bundle: MainGameSources)')
    with zipfile.ZipFile(out.with_suffix('.zip'), 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(out.iterdir()):
            if path.is_file():
                archive.write(path, path.name)
    print(json.dumps({k: v for k, v in report.items() if 'Sha256' not in k}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
