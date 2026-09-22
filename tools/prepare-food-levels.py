"""Split the five supplied paired pictures and reproduce reviewed hit regions.

Coordinates below use the original 1086-wide picture; lower-panel Y is
translated by 724 pixels. No image generation or content repainting is used.
Run from any directory: python tools/prepare-food-levels.py
"""
import json
import math
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'D:\CocosCreator\FindDifferenceTex')
REVIEW = ROOT / 'docs/art-source/food-levels'
# Equal, horizontally centered crops; remove the separator and orange surround.
LEFT, TOP, WIDTH, HEIGHT, STEP = 31, 26, 1024, 672, 724

# id, Chinese description, source-half center x/y, radius in source pixels.
LEVELS = [
    ('北京炸酱面', [
        ('cloth-sign', '左侧布招牌：面 / 食', 128, 190, 79),
        ('chef-hat', '厨师帽：白色 / 黑色', 300, 182, 100),
        ('lantern', '灯笼：红色 / 黄色', 532, 111, 54),
        ('shop-sign', '店铺招牌：老北京 / 京味', 746, 76, 82),
        ('vertical-sign', '右侧木牌文字与碗图案', 1007, 259, 112),
        ('boy-shirt', '男孩衣服：白色 / 红色', 567, 390, 105),
        ('noodle-topping', '面碗中增加葱花', 545, 452, 45),
        ('girl-dress', '女孩衣服：红色 / 蓝色', 774, 452, 82),
        ('hair-tassel', '发饰流苏：红色 / 蓝色', 832, 348, 38),
        ('counter-animal', '柜台动物：猫 / 鸽子', 978, 458, 81),
        ('sauce-jar', '酱罐标签：酱 / 甜酱', 153, 592, 48),
        ('vegetable-bowl', '中间配菜：豆芽 / 胡萝卜丝', 451, 622, 69),
        ('right-bowl', '右侧配菜：黄豆 / 紫色菜丝', 745, 641, 76),
        ('chalkboard', '黑板图案：面碗 / 蒜头', 985, 610, 56),
    ]),
    ('海南椰子鸡', [
        ('lantern', '灯笼：橙色 / 绿色', 330, 90, 61),
        ('held-fruit', '摊主手持：椰子 / 菠萝', 279, 315, 73),
        ('boy-shirt', '男孩上衣：蓝色 / 黄色', 446, 400, 111),
        ('hair-flower', '女孩发饰：贝壳蝴蝶结 / 红花', 777, 220, 59),
        ('seaside-animal', '右上动物：海鸟 / 螃蟹', 1000, 213, 56),
        ('raw-ingredients', '左下食材：鸡肉 / 虾', 293, 567, 90),
        ('chili-saucer', '左下红辣椒碟消失', 317, 657, 44),
        ('coconut-opening', '右下椰子：切开 / 完整', 986, 586, 78),
    ]),
    ('深圳猪脚饭', [
        ('hanging-sign', '左上：圆灯笼 / 方形招牌', 330, 114, 70),
        ('pet', '左侧动物：猫 / 狗', 135, 475, 71),
        ('chopsticks', '筷子：深色 / 红色', 240, 509, 44),
        ('table-sign', '桌牌：猪脚饭 / 卤肉饭', 298, 624, 87),
        ('egg', '左侧饭盘：鸡蛋 / 西兰花', 393, 542, 45),
        ('pickle-plate', '小菜：腌菜 / 黄瓜片', 556, 590, 58),
        ('sauce-jar', '酱料罐：红色 / 绿色', 863, 582, 59),
    ]),
    ('顺德双皮奶', [
        ('window-decoration', '左侧窗台：盆栽 / 招财猫', 96, 279, 70),
        ('lantern', '灯笼：橙色 / 绿色', 485, 93, 61),
        ('hair-accessory', '女孩发饰：黑色蝴蝶结 / 白花', 836, 235, 78),
        ('boy-shirt', '男孩上衣：白色 / 蓝色', 630, 442, 110),
        ('tray-bowl', '托盘左边红豆碗消失', 287, 434, 57),
        ('dessert-topping', '中间甜品：红豆 / 芒果', 585, 534, 58),
        ('milk-container', '左下容器：鲜奶罐 / 花纹茶壶', 284, 581, 76),
        ('spoon', '右侧白瓷勺消失', 868, 579, 42),
    ]),
    ('云南米线', [
        ('sky-bird', '背景天空新增飞鸟', 505, 119, 34),
        ('fragrant-banner', '香字旗：浅底深字 / 红底浅字', 742, 95, 77),
        ('hanging-corn', '右侧：云南米线木牌 / 玉米', 1008, 240, 113),
        ('cat-color', '左侧猫：橙色 / 灰色', 163, 348, 64),
        ('vendor-clothes', '摊主衣服：深色 / 蓝色', 890, 406, 88),
        ('serving-utensil', '摊主工具：筷子 / 汤勺', 751, 421, 74),
        ('bowl-rooster', '右侧碗上公鸡：黑红 / 蓝色', 1020, 496, 37),
        ('chopstick-color', '右侧筷子：黄色 / 棕色', 938, 543, 58),
        ('left-seasoning', '中排左碗：浅色配料 / 棕色配料', 490, 546, 40),
        ('middle-seasoning', '中排中碗：棕色配料 / 深色配料', 593, 543, 40),
        ('right-seasoning', '中排右碗：黄色配料 / 红色辣椒', 683, 563, 46),
        ('front-seasoning', '前排中碗：红色辣椒 / 深色菌菇', 626, 603, 49),
        ('lime-bowl', '前排右碗：菌菇 / 青柠', 747, 612, 53),
    ]),
]


def main():
    REVIEW.mkdir(parents=True, exist_ok=True)
    backup = REVIEW / 'original-levels-01-05.zip'
    if not backup.exists():
        with zipfile.ZipFile(backup, 'w', zipfile.ZIP_DEFLATED) as archive:
            for number in range(1, 6):
                for path in (ROOT / f'assets/resources/levels/level-{number:02}').iterdir():
                    archive.write(path, path.relative_to(ROOT))
            path = ROOT / 'assets/resources/configs/levels.json'
            archive.write(path, path.relative_to(ROOT))
    report = []
    config_path = ROOT / 'assets/resources/configs/levels.json'
    config = json.loads(config_path.read_text(encoding='utf-8-sig'))
    font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 23)
    for number, (name, spots) in enumerate(LEVELS, 1):
        # Smaller details take precedence when they sit beside a broad clothing region.
        spots = sorted(spots, key=lambda item: item[4])
        directory = ROOT / f'assets/resources/levels/level-{number:02}'
        source = Image.open(SOURCE / f'FindDifferenceLevel ({number}).png').convert('RGB')
        assert source.size == (1086, 1448)
        differences = [dict(id=id_, x=round((x-LEFT)/WIDTH, 6),
                            y=round((y-TOP)/HEIGHT, 6), radius=round(r/WIDTH, 6))
                       for id_, _, x, y, r in spots]
        assert len({d['id'] for d in differences}) == len(differences)
        for d in differences:
            assert 0 < d['x'] < 1 and 0 < d['y'] < 1 and 0 < d['radius'] < .2
        # Every center must select its own region using the game's first-hit rule.
        for index, d in enumerate(differences):
            for other in differences[:index]:
                distance = math.hypot((d['x']-other['x'])*WIDTH, (d['y']-other['y'])*HEIGHT)
                assert distance > other['radius']*WIDTH, (number, d['id'], other['id'])
        (directory / 'differences.json').write_text(json.dumps({'differences': differences}, indent=2)+'\n', encoding='utf-8')
        review = Image.new('RGB', (WIDTH, HEIGHT*2+40), '#20242c')
        for panel, letter in enumerate('ab'):
            y = TOP + panel*STEP
            crop = source.crop((LEFT, y, LEFT+WIDTH, y+HEIGHT))
            target = directory / f'scene-{letter}.webp'
            crop.save(target, 'WEBP', quality=95, method=6)
            old_meta = directory / f'scene-{letter}.png.meta'
            meta_path = directory / f'scene-{letter}.webp.meta'
            meta = json.loads((meta_path if meta_path.exists() else old_meta).read_text(encoding='utf-8-sig'))
            meta['files'] = ['.json', '.webp']
            frame = meta['subMetas']['f9941']['userData']
            frame.update(width=WIDTH, height=HEIGHT, rawWidth=WIDTH, rawHeight=HEIGHT,
                         offsetX=0, offsetY=0, trimX=0, trimY=0, pivotX=.5, pivotY=.5)
            vertices = frame['vertices']
            vertices['rawPosition'] = [-WIDTH/2,-HEIGHT/2,0,WIDTH/2,-HEIGHT/2,0,-WIDTH/2,HEIGHT/2,0,WIDTH/2,HEIGHT/2,0]
            vertices['uv'] = [0,HEIGHT,WIDTH,HEIGHT,0,0,WIDTH,0]
            vertices['minPos'] = [-WIDTH/2,-HEIGHT/2,0]
            vertices['maxPos'] = [WIDTH/2,HEIGHT/2,0]
            meta_path.write_text(json.dumps(meta, indent=2)+'\n', encoding='utf-8')
            # Exact old PNG assets are backed up above. Avoid duplicate resource names.
            for old in (directory / f'scene-{letter}.png', old_meta):
                if old.exists():
                    old.unlink()
            assert Image.open(target).size == (WIDTH, HEIGHT)
            draw = ImageDraw.Draw(crop)
            for index, (_, _, x, sy, radius) in enumerate(spots, 1):
                x, sy = x-LEFT, sy-TOP
                draw.ellipse((x-radius,sy-radius,x+radius,sy+radius), outline='#00ffff', width=3)
                draw.text((x, sy), str(index), font=font, fill='white', stroke_width=3, stroke_fill='black', anchor='mm')
            review.paste(crop, (0,panel*(HEIGHT+40)))
        review.save(REVIEW / f'level-{number:02}-review.jpg', quality=92)
        for level in config['levels']:
            if level['id'] == number:
                level['name'] = name
        report.append({'level': number, 'name': name, 'count': len(spots),
                       'source': str(SOURCE / f'FindDifferenceLevel ({number}).png'),
                       'cropA': [LEFT, TOP, WIDTH, HEIGHT],
                       'cropB': [LEFT, TOP+STEP, WIDTH, HEIGHT],
                       'regions': [{'number': i, 'id': s[0], 'description': s[1]} for i,s in enumerate(spots,1)]})
        print(f'level-{number:02}: {name}, {len(spots)} regions, {WIDTH}x{HEIGHT}')
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    (REVIEW / 'review-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
