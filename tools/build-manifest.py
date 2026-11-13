# -*- coding: utf-8 -*-
"""
关卡清单生成与资源校验工具。

用法（在工程根目录执行）：
    python tools/build-manifest.py

行为：
1. 按 config/chapter-order.json 的明确顺序读取各章节，生成 resources/configs/cities.json；
2. schemaVersion=2 时只读取各章 configs/city.json 的显式 id/name/folder 列表，保留人工顺序；
   兼容旧格式时才扫描 level-NN。内容不变时不写文件；
3. 逐关校验 differences.json 与引用的图片资源，输出校验报告；
4. 校验失败时以非零码退出，可接入打包前检查。

目录约定：
    assets/resources/configs/cities.json 城市索引（首包）
    chapter-covers/city-XX-name-icon.jpg 章节封面（独立包）
    food-icons/city-XX-name/美食图片.png 美食图标（独立包）
    levels/city-XX-name/configs/city.json 章节源清单
    levels/<chapter>/configs/<folder>/differences.json 关卡配置
    levels/<chapter>/thumbnails/<folder>/icon.jpg 小关选关封面
    levels/<chapter>/<folder>/
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
CHAPTER_ORDER_PATH = 'config/chapter-order.json'
TOPICS_ROOT = 'config/topics'
CITY_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9-]*$')
LEVEL_RE = re.compile(r'^level-\d{2}$')
# 解锁由 GameFlow 的公共逻辑控制。旧源清单中的字段只为保持已发布包字节稳定而保留。
LEGACY_RULE_FIELDS = {'unlockMode', 'prerequisiteCity'}

# 首次生成城市配置时的城市名（之后以手工修改为准）
CITY_NAMES = {
    'city-00-HotTips': '网络热点',
    'city-01-2026Hotmeme': '2026热梗',
    'city-2025Hotmeme': '2025热梗',
    'city-PetThreeKingdoms': '萌宠三国',
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
    thumbnail = re.match(r'^thumbnails/([a-zA-Z0-9-]+)/(.*)$', rel)
    banner = re.match(r'^configs/(city-(?:\d{2}-)?[a-zA-Z0-9]+)-icon$', rel)
    if thumbnail:
        rel = f'levels/{thumbnail[1]}/thumbnails/{thumbnail[2]}'
    elif banner:
        rel = f'chapter-covers/{banner[1]}-icon'
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
        with open(diff_path, encoding='utf-8') as source:
            data = json.load(source)
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
            # Exported radius is normalized to the short image side, as at runtime.
            # Large re-drawn differences can legitimately exceed the former 0.2 heuristic.
            if isinstance(radius, bool) or not isinstance(radius, (int, float)) or not (0 < radius <= 1):
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
    # 新专题使用独立 key 插入展示列表，原城市目录和存档 key 不变。
    if city == 'city-2025Hotmeme':
        return (1, 3, city)
    if city == 'city-PetThreeKingdoms':
        return (1, 2, city)
    if city == 'city-PetStory':
        return (1, 1, city)
    match = re.match(r'^city-(\d{2})-', city)
    return (int(match.group(1)), 0, city) if match else (100, 0, city)


def write_json_if_changed(path, data, trailing_newline=False):
    """保留语义未变文件的原始字节，避免格式化/字段排序使无关章节重新生成哈希。"""
    try:
        with open(path, encoding='utf-8') as source:
            if json.load(source) == data:
                return
    except (FileNotFoundError, ValueError):
        pass
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        if trailing_newline:
            output.write('\n')


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

    order_config = {}
    if os.path.isfile(CHAPTER_ORDER_PATH):
        try:
            with open(CHAPTER_ORDER_PATH, encoding='utf-8') as source:
                order_config = json.load(source)
                declared = order_config['chapters']
            if not isinstance(declared, list) or not declared or any(not isinstance(key, str) or not CITY_RE.fullmatch(key) for key in declared):
                raise ValueError('章节列表必须包含合法的英文/拼音目录名')
            if len(set(declared)) != len(declared) or any(key not in city_dirs for key in declared):
                raise ValueError('章节列表重复或目录不存在')
            city_dirs = declared
        except (OSError, ValueError, KeyError, TypeError) as error:
            print(f'错误: 章节顺序配置无效: {error}')
            return 1

    navigation = order_config.get('navigation', city_dirs)
    topics, owned = [], set()
    try:
        if not isinstance(navigation, list) or not navigation or len(set(navigation)) != len(navigation):
            raise ValueError('顶层章节索引为空或重复')
        for key in navigation:
            if not isinstance(key, str) or not CITY_RE.fullmatch(key):
                raise ValueError('非法的顶层章节名称')
            if key in city_dirs:
                children = [key]
            else:
                with open(os.path.join(TOPICS_ROOT, key + '.json'), encoding='utf-8') as source:
                    topic = json.load(source)
                if not isinstance(topic, dict):
                    raise ValueError(f'{key} 专题配置必须是对象')
                children = topic.get('chapters')
                if (topic.get('key') != key or not topic.get('name') or not isinstance(children, list)
                        or not children or len(set(children)) != len(children)
                        or topic.get('defaultChapter') not in children):
                    raise ValueError(f'{key} 的名称、子章节或默认开放城市无效')
                topics.append(topic)
            for child in children:
                if child not in city_dirs or child in owned:
                    raise ValueError(f'城市子章节不存在或被重复引用: {child}')
                owned.add(child)
        if owned != set(city_dirs):
            raise ValueError('有城市未纳入顶层章节索引或专题子章节')
    except (OSError, ValueError, TypeError) as error:
        print(f'错误: 专题层级配置无效: {error}')
        return 1

    # 已明确列入章节清单的关卡不能因缺失配置而被静默删掉、导致关卡顺序变化。
    # 在写入任何清单前统一检查，避免半成品专题覆盖已发布索引。
    missing_configs = []
    stable_ids = set()
    manifests = {}
    for city_dir in city_dirs:
        manifest_path = os.path.join(chapter_config_root(city_dir), 'city.json')
        if not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path, encoding='utf-8') as source:
                manifest = json.load(source)
        except (OSError, ValueError) as error:
            print(f'错误: 章节清单读取失败: {manifest_path}: {error}')
            return 1
        manifests[city_dir] = manifest
        folders = set()
        for entry in manifest.get('levels', []):
            if isinstance(entry, dict):
                level, identity, name = entry.get('folder'), entry.get('id'), entry.get('name')
                if not isinstance(level, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]*', level):
                    print(f'错误: {city_dir} 关卡目录必须使用英文/拼音和连字符: {level}')
                    return 1
                if not isinstance(identity, str) or not identity or not isinstance(name, str) or not name.strip():
                    print(f'错误: {city_dir}/{level} 缺少固定 id 或显示 name')
                    return 1
            elif isinstance(entry, str) and manifest.get('schemaVersion') != 2:
                level, identity = entry, f'{city_dir}/{entry}'
            else:
                print(f'错误: {city_dir} 关卡条目格式无效')
                return 1
            if level == 'level-00':
                continue
            if identity in stable_ids or level in folders:
                print(f'错误: 重复关卡 id 或章内目录: {identity}, {city_dir}/{level}')
                return 1
            stable_ids.add(identity)
            folders.add(level)
            config_path = os.path.join(chapter_config_root(city_dir), level, 'differences.json')
            if not os.path.isfile(config_path):
                missing_configs.append(config_path)
    if missing_configs:
        for config_path in missing_configs:
            print(f'错误: 已列入清单的关卡缺少配置: {config_path}')
        print('未更新章节清单和主包索引，请补齐配置后重试。')
        return 1
    for city, manifest in manifests.items():
        if manifest.get('nextChapter') and manifest['nextChapter'] not in city_dirs:
            print(f'错误: {city} 的 nextChapter 不在章节列表中')
            return 1
        visited = set()
        target = city
        while target:
            if target in visited:
                print(f'错误: nextChapter 存在循环: {city}')
                return 1
            visited.add(target)
            target = manifests.get(target, {}).get('nextChapter')

    # 1. 全局城市索引
    os.makedirs(LEVELS_ROOT, exist_ok=True)
    index_path = CITY_INDEX_PATH
    chapters = {}

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
        configured = manifests.get(city_dir, {})
        if configured.get('schemaVersion') == 2:
            level_dirs = [entry['folder'] for entry in configured['levels']]
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
                with open(manifest_path, encoding='utf-8') as source:
                    manifest = json.load(source)
            except Exception:
                manifest = {}
        manifest.setdefault('name', CITY_NAMES.get(city_dir, city_dir))
        manifest.setdefault('banner', f'chapter-covers/{city_dir}-icon/spriteFrame')
        if manifest.get('schemaVersion') != 2:
            manifest['levels'] = level_dirs
        write_json_if_changed(manifest_path, manifest)
        chapters[city_dir] = {'key': city_dir, **{
            key: value for key, value in manifest.items() if key not in LEGACY_RULE_FIELDS
        }}

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

    index = {'cities': city_dirs, 'chapters': chapters}
    if 'navigation' in order_config:
        index.update(navigation=navigation, topics=topics)
    write_json_if_changed(index_path, index, trailing_newline=True)
    print(f'已生成 {index_path}: {len(city_dirs)} 个章节，含启动所需完整清单')
    if 'navigation' in order_config:
        print(f'逻辑层级: {len(navigation)} 个顶层专题，{len(topics)} 个专题包含城市子章节')
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
