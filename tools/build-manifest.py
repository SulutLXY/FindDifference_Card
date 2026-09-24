# -*- coding: utf-8 -*-
"""
关卡清单生成与资源校验工具。

用法（在工程根目录执行）：
    python tools/build-manifest.py

行为：
1. 扫描 assets/resources/levels/ 下所有 city-* 目录，按目录名排序生成 cities.json；
2. 每城生成/刷新 city.json 的 levels 清单（level-* 目录名排序），
   城市展示信息（name/banner 等手工字段）已存在时保留、不覆盖；
3. 逐关校验 differences.json 与引用的图片资源，输出校验报告；
4. 校验失败时以非零码退出，可接入打包前检查。

目录约定：
    levels/city-XX-name/
        city.json           城市信息 + 关卡清单（本工具生成 levels 部分）
        level-YY/
            differences.json  关卡配置：name / type / differences / 可选图片路径覆盖
            scene-a.webp      上图（图片路径被覆盖时可省略）
            scene-b.webp      下图
            icon.webp         封面（可选，缺省用 scene-a）
"""

import json
import os
import re
import sys

LEVELS_ROOT = 'assets/resources/levels'
CITY_RE = re.compile(r'^city-\d{2}-[a-z]+$')
LEVEL_RE = re.compile(r'^level-\d{2}$')

# 首次生成 city.json 时的城市名（之后以手工修改为准）
CITY_NAMES = {
    'city-01-beijing': '北京',
    'city-02-shanghai': '上海',
    'city-03-nanjing': '南京',
    'city-04-xiamen': '厦门',
    'city-05-changsha': '长沙',
    'city-06-guangzhou': '广州',
    'city-07-chengdu': '成都',
    'city-08-xian': '西安',
}


def sprite_path_to_file(sprite_path):
    """把 resources 相对路径（.../spriteFrame）转为磁盘文件路径（自动补扩展名）。"""
    rel = sprite_path.replace('/spriteFrame', '')
    base = os.path.join('assets/resources', rel)
    for ext in ('.webp', '.png', '.jpg', '.jpeg'):
        if os.path.isfile(base + ext):
            return base + ext
    return base  # 找不到时返回无扩展名路径，供报错展示


def check_level(city_dir, level_dir):
    """校验单个关卡，返回问题列表。"""
    problems = []
    base = os.path.join(LEVELS_ROOT, city_dir, level_dir)
    diff_path = os.path.join(base, 'differences.json')
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


def main():
    if not os.path.isdir(LEVELS_ROOT):
        print(f'错误: 未找到 {LEVELS_ROOT}')
        return 1

    city_dirs = sorted(
        d for d in os.listdir(LEVELS_ROOT)
        if os.path.isdir(os.path.join(LEVELS_ROOT, d)) and CITY_RE.match(d)
    )
    if not city_dirs:
        print(f'错误: {LEVELS_ROOT} 下没有 city-* 目录')
        return 1

    # 1. 全局城市索引
    index_path = os.path.join(LEVELS_ROOT, 'cities.json')
    json.dump({'cities': city_dirs}, open(index_path, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print(f'已生成 {index_path}: {len(city_dirs)} 个城市')

    all_problems = []
    total_levels = 0

    for city_dir in city_dirs:
        city_path = os.path.join(LEVELS_ROOT, city_dir)
        # 没有 differences.json 的目录（如敬请期待占位）不算关卡，不进清单
        level_dirs = sorted(
            d for d in os.listdir(city_path)
            if os.path.isdir(os.path.join(city_path, d)) and LEVEL_RE.match(d)
            and os.path.isfile(os.path.join(city_path, d, 'differences.json'))
        )
        skipped = sorted(
            d for d in os.listdir(city_path)
            if os.path.isdir(os.path.join(city_path, d)) and LEVEL_RE.match(d)
            and d not in level_dirs
        )
        if skipped:
            print(f'  提示: {city_dir} 下 {", ".join(skipped)} 无 differences.json，已排除出清单')

        # 2. 刷新 city.json：保留手工字段，仅更新 levels
        manifest_path = os.path.join(city_path, 'city.json')
        manifest = {}
        if os.path.isfile(manifest_path):
            try:
                manifest = json.load(open(manifest_path, encoding='utf-8'))
            except Exception:
                manifest = {}
        manifest.setdefault('name', CITY_NAMES.get(city_dir, city_dir))
        manifest['levels'] = level_dirs
        json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)

        # 3. 逐关校验
        for level_dir in level_dirs:
            total_levels += 1
            all_problems.extend(check_level(city_dir, level_dir))

        done = sum(
            1 for d in level_dirs
            if os.path.isfile(os.path.join(city_path, d, 'differences.json'))
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
