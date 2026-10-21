# -*- coding: utf-8 -*-
"""
关卡清单生成与资源校验工具。

用法（在工程根目录执行）：
    python tools/build-manifest.py

行为：
1. 扫描 assets/Bundle/levels/ 下所有 city-* 目录，生成 resources/configs/cities.json；
2. 每城生成/刷新 configs/city-XX-name.json 的 levels 清单，
   城市展示信息（name/banner 等手工字段）已存在时保留、不覆盖；
3. 逐关校验 differences.json 与引用的图片资源，输出校验报告；
4. 校验失败时以非零码退出，可接入打包前检查。

目录约定：
    assets/resources/configs/cities.json 城市索引（首包）
    configs/city-XX-name.json 城市信息 + 关卡清单（本工具生成 levels 部分）
    configs/city-XX-name-icon.jpg 城市图标
    configs/city-XX-name/level-YY/differences.json 关卡配置
    thumbnails/city-XX-name/level-YY/icon.jpg 选关封面
    levels/city-XX-name/level-YY/
            scene-a.jpg       上图（图片路径被覆盖时可省略）
            scene-b.jpg       下图
"""

import json
import os
import re
import sys

LEVELS_ROOT = 'assets/Bundle/levels'
def chapter_config_root(city):
    return os.path.join(LEVELS_ROOT, city, 'configs')
CITY_INDEX_PATH = 'assets/resources/configs/cities.json'
CITY_RE = re.compile(r'^city-(?:\d{2}-)?[a-zA-Z0-9]+$')
LEVEL_RE = re.compile(r'^level-\d{2}$')

# 首次生成城市配置时的城市名（之后以手工修改为准）
CITY_NAMES = {
    'city-00-HotTips': '网络热点',
    'city-01-2026Hotmeme': '2026热梗',
    'city-PetStory': '宠物故事',
    'city-02-beijing': '北京',
    'city-03-shanghai': '上海',
    'city-04-nanjing': '南京',
    'city-05-xiamen': '厦门',
    'city-06-changsha': '长沙',
    'city-07-guangzhou': '广州',
    'city-08-chengdu': '成都',
    'city-09-xian': '西安',
}


def sprite_path_to_file(sprite_path):
    """把 resources 相对路径（.../spriteFrame）转为磁盘文件路径（自动补扩展名）。"""
    rel = sprite_path.replace('/spriteFrame', '')
    thumbnail = re.match(r'^thumbnails/(city-(?:\d{2}-)?[a-zA-Z0-9]+)/(.*)$', rel)
    banner = re.match(r'^configs/(city-(?:\d{2}-)?[a-zA-Z0-9]+)-icon$', rel)
    if thumbnail:
        rel = f'levels/{thumbnail[1]}/thumbnails/{thumbnail[2]}'
    elif banner:
        rel = f'levels/{banner[1]}/configs/{banner[1]}-icon'
    base = os.path.join('assets/Bundle', rel)
    for ext in ('.png', '.jpg', '.jpeg'):
        if os.path.isfile(base + ext):
            return base + ext
    return base  # 找不到时返回无扩展名路径，供报错展示


def check_level(city_dir, level_dir):
    """校验单个关卡，返回问题列表。"""
    problems = []
    base = os.path.join(LEVELS_ROOT, city_dir, level_dir)
    diff_path = os.path.join(chapter_config_root(city_dir), level_dir, 'differences.json')
    label = f'{city_dir}/{level_dir}'

    if not os.path.isfile(diff_path):
        return [f'{label}: 缺少 differences.json']

    try:
        data = json.load(open(diff_path, encoding='utf-8'))
    except Exception as error:
        return [f'{label}: differences.json 解析失败: {error}']

    if not data.get('name'):
        problems.append(f'{label}: 缺少 name（关卡名）')
    # type 为开放标记（normal 普通 / food 美食 / travel 风土 等），只校验存在性
    if not data.get('type'):
        problems.append(f'{label}: 缺少 type（关卡类型标记）')

    differences = data.get('differences')
    if not isinstance(differences, list) or len(differences) == 0:
        problems.append(f'{label}: differences 为空或缺失')
    else:
        for index, item in enumerate(differences):
            if not isinstance(item, dict):
                problems.append(f'{label}: 差异点 #{index + 1} 不是对象')
                continue
            x, y, radius = item.get('x'), item.get('y'), item.get('radius')
            if not isinstance(x, (int, float)) or not (0 <= x <= 1):
                problems.append(f'{label}: 差异点 #{index + 1} x 越界: {x!r}')
            if not isinstance(y, (int, float)) or not (0 <= y <= 1):
                problems.append(f'{label}: 差异点 #{index + 1} y 越界: {y!r}')
            if not isinstance(radius, (int, float)) or not (0 < radius <= 0.2):
                problems.append(f'{label}: 差异点 #{index + 1} radius 非法: {radius!r}')

    # 图片资源：优先显式配置，其次目录推导
    top = data.get('topImage') or f'levels/{city_dir}/{level_dir}/scene-a/spriteFrame'
    bottom = data.get('bottomImage') or f'levels/{city_dir}/{level_dir}/scene-b/spriteFrame'
    for tag, sprite in (('topImage', top), ('bottomImage', bottom)):
        if not os.path.isfile(sprite_path_to_file(sprite)):
            problems.append(f'{label}: {tag} 图片不存在: {sprite}')

    icon = data.get('icon')
    if icon and not os.path.isfile(sprite_path_to_file(icon)):
        problems.append(f'{label}: icon 封面不存在: {icon}')

    return problems


def city_sort_key(city):
    # 命名不含数字的专题明确插在 2026 热梗后；原城市目录和存档 key 不变。
    if city == 'city-PetStory':
        return (1, 1, city)
    match = re.match(r'^city-(\d{2})-', city)
    return (int(match.group(1)), 0, city) if match else (100, 0, city)


def main():
    if not os.path.isdir(LEVELS_ROOT):
        print(f'错误: 未找到 {LEVELS_ROOT}')
        return 1

    city_dirs = sorted(
        (d for d in os.listdir(LEVELS_ROOT)
         if os.path.isdir(os.path.join(LEVELS_ROOT, d)) and CITY_RE.match(d)),
        key=city_sort_key,
    )
    if not city_dirs:
        print(f'错误: {LEVELS_ROOT} 下没有 city-* 目录')
        return 1

    # 1. 全局城市索引
    os.makedirs(LEVELS_ROOT, exist_ok=True)
    index_path = CITY_INDEX_PATH
    json.dump({'cities': city_dirs}, open(index_path, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print(f'已生成 {index_path}: {len(city_dirs)} 个城市')

    all_problems = []
    total_levels = 0

    for city_dir in city_dirs:
        city_path = os.path.join(LEVELS_ROOT, city_dir)
        # level-00 旧占位目录及没有 differences.json 的目录不进正式关卡清单
        level_dirs = sorted(
            d for d in os.listdir(city_path)
            if os.path.isdir(os.path.join(city_path, d)) and LEVEL_RE.match(d) and d != 'level-00'
            and os.path.isfile(os.path.join(chapter_config_root(city_dir), d, 'differences.json'))
        )
        skipped = sorted(
            d for d in os.listdir(city_path)
            if os.path.isdir(os.path.join(city_path, d)) and LEVEL_RE.match(d)
            and d not in level_dirs
        )
        if skipped:
            print(f'  提示: {city_dir} 下 {", ".join(skipped)} 为旧占位或无 differences.json，已排除出清单')

        # 2. 刷新城市配置：保留手工字段，更新 levels
        manifest_path = os.path.join(chapter_config_root(city_dir), 'city.json')
        manifest = {}
        if os.path.isfile(manifest_path):
            try:
                manifest = json.load(open(manifest_path, encoding='utf-8'))
            except Exception:
                manifest = {}
        manifest.setdefault('name', CITY_NAMES.get(city_dir, city_dir))
        manifest.setdefault('unlockMode', 'sequential' if city_dir in ('city-00-HotTips', 'city-01-2026Hotmeme') else 'rewarded')
        if city_dir == 'city-01-2026Hotmeme':
            manifest.setdefault('prerequisiteCity', 'city-00-HotTips')
        manifest.setdefault('banner', f'configs/{city_dir}-icon/spriteFrame')
        manifest['levels'] = level_dirs
        json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)

        # 3. 逐关校验
        for level_dir in level_dirs:
            total_levels += 1
            all_problems.extend(check_level(city_dir, level_dir))

        done = sum(
            1 for d in level_dirs
            if os.path.isfile(os.path.join(chapter_config_root(city_dir), d, 'differences.json'))
        )
        banner = ' | '.join(f'{p}' for p in all_problems[-3:]) if all_problems else ''
        print(f'{city_dir} ({manifest["name"]}): {done}/{len(level_dirs)} 关')

    print(f'\n共 {len(city_dirs)} 城 {total_levels} 关')
    if all_problems:
        print(f'校验发现 {len(all_problems)} 个问题:')
        for p in all_problems:
            print(f'  - {p}')
        return 1
    print('校验通过: 配置与图片资源齐全')
    return 0


if __name__ == '__main__':
    sys.exit(main())
