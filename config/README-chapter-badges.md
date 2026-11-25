# 章节提示标签（2026-11-17）

`CitySelectScreen` 原 `HotNumber` 区域改为章节类型提示，仅显示一个图标和中文短标签。标签由人工配置，不表示玩家人数、游玩次数或热度排名，也不根据统计接口更新。

| 配置值 | 显示文字 | 图标 | 底图 |
| --- | --- | --- | --- |
| `new` | 新章节 | `icon_leaf` | `icon_Mark_green` |
| `hot` | 热门 | `icon_fire` | `icon_Mark_red` |
| `hard` | 困难 | `icon_skull` | `icon_Mark_red` |
| `collect` | 收藏 | `icon_chest` | `icon_Mark_blue` |

## 每章配置

唯一配置入口为 `config/chapter-order.json` 的 `badges`，key 使用章节/专题的固定目录名。例如 `"qing-hua-ci": "collect"` 表示青花瓷显示收藏标签。删除某个 key 或设置为 `null` 都会隐藏该标签。每个入口最多显示一个标签；“新章节”需要时手动更新，不依赖计数、日期或旧 `playStats.newChapters`。

2026-11-25 当前配置六个入口：青花瓷和恋爱美食为收藏，网络热点为热门，萌宠三国为困难，寻宋记和趣味短剧为新章节。萌宠故事、年度热梗及恋爱美食内部八个城市子章节均不显示标签。

修改后运行 `python tools/build-manifest.py`，将 `badges` 汇总到启动索引 `assets/resources/configs/cities.json`。生成器验证章节/专题存在且类型有效，非法配置不会覆盖索引。标签配置不写入各章节远程包，也不改任何关卡 ID、存档或解锁规则。

## 图标绑定

使用现有 `assets/LobbySources/textures/UI_Sprite/icons` 资源，七张 SpriteFrame 已绑定到 `assets/LobbySources/prefabs/CitySelectScreen.prefab`，热门和困难共用红色底图。

保留原 `HotNumber`、`HotNumber_laber` 和 `icon_fire` 节点名；其中 `icon_fire` 现在是公用图标显示节点。程序不修改编辑器中的位置、缩放或尺寸。重复填充卡片时同时更新文字、图标和底图，避免留下上一类型的样式。未配置或缺少必要素材时清空文字并隐藏标签，不留下旧数字。

## 热度算法保留，暂不接入

`assets/scripts/core/PlayStats.ts`、`assets/scripts/services/PlayStatsService.ts`、`server/play-stats` 的算法和独立服务代码保持原样；原初始值、预上线基准及七天数据 JSON 也保留。

当前游戏流程不再实例化或配置 `PlayStatsService`，进关不调用 `recordEntry`；章节页面不再读取初始热度或请求 `getCounts`，没有异步热度回调覆盖标签。即使以后修改旧统计配置，也不会自行启用上报；恢复接入需要单独修改流程。

四组图标/底图、跨类型切换、缺失配置与素材、预制体绑定、无统计调用、进关不记录事件、藏品、导航、解锁及原统计算法回归通过，TypeScript 检查通过。清单生成器仍报告原有 8 处旧标注坐标越界，本次不修改标注。

尚未构建、上传或真机验收。发布时重新构建配套代码包、主包索引和含新 SpriteFrame 绑定的 LobbySources 远程包，核对同次构建哈希。版本号未调整。
