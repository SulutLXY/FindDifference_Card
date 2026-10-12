# 局内资源拆分

- `assets/resources`：首包资源，城市总索引为 `configs/cities.json`，首页音乐为 `voice/BGmusic/Main_music00`，基础点击声保留在 `voice/ComboSound`。
- `assets/PleyGame`：Bundle 名为 `MainGameSources`，抖音远程加载、Merge Depend。
- `assets/Bundle`：仅组织目录，Bundle 开关关闭。configs 和 thumbnails 分别是 `city-configs`、`city-thumbnails` 远程 Bundle；levels 只作分类目录，其下每个城市目录单独启用 Bundle，例如 `city-01-beijing`。远程包在抖音使用 Merge Depend。

目录示例（全部路径均相对于 assets/Bundle）：

```text
configs/
  city-01-beijing.json                 城市名称、图标路径、关卡清单
  city-01-beijing-icon.jpg             城市卡片图标
  city-01-beijing/level-01/differences.json  小关卡配置
thumbnails/
  city-01-beijing/level-01/icon.jpg     选关封面
  city-01-beijing/city-01-beijing-BeiJingKaoYa.png  美食图鉴素材
levels/
  city-01-beijing/level-01/scene-a.jpg  关卡上图
  city-01-beijing/level-01/scene-b.jpg  关卡下图
```

启动读取首包的城市总索引和 city-configs 中的城市清单；进关只读目标关卡的 differences.json，再加载对应城市 Bundle 中的两张大图。选关和美食页才加载 city-thumbnails。只读取目标城市的包；跨城市进入关卡或预下载下一关时选择新的城市包。各 Bundle 合并同时发起的加载请求，失败后可以重试。

JSON 中的图像路径保留分类前缀，例如 `thumbnails/city-01-beijing/level-01/icon/spriteFrame`；GameFlow 选择对应 Bundle 后去掉 `thumbnails/`，以 Bundle 内部相对路径请求。大图 `levels/city-01-beijing/level-01/scene-a/spriteFrame` 则选择 `city-01-beijing` Bundle，内部路径为 `level-01/scene-a/spriteFrame`。请勿在 Bundle.load 中重复加分类或城市前缀。小关卡 `icon` 字段指定 thumbnails 路径；未指定时回退关卡上图。

城市和关卡的存档 key 仍为 city-01-beijing/level-01。移动文件时必须带上对应 .meta，保留 UUID；差异点 ID、坐标和半径不随目录调整改变。

主场景不再直接包含 Game 和 ResultModal。布局分别保存在 `assets/PleyGame/prefabs/GameScreen.prefab`、`ResultModal.prefab`；请打开对应预制体编辑局内与结算界面。GameFlow 首次进关在加载遮罩下加载并创建两者，后续复用。GameFlow 的 game/resultModal 场景属性留空。

主场景中的城市卡、选关卡、美食卡和美食弹窗不直接绑定远程 SpriteFrame，由各界面按配置动态加载，避免首包通过模板引用提前拉取小图包。

启动配置和存档迁移完成后自动开始当前关卡，不先进入首页。新玩家进入第一关，已有进度进入第一个已解锁且未通关的关卡，全部通关后沿用重玩第一关的规则。加载遮罩保持到关卡就绪，返回首页入口仍可使用。

启动、手动选关或配置加载失败时自动返回首页。结算点击「下一关」加载失败时，仅尝试一次再下一关（支持跨城市）；不存在后继关卡或再次失败就回首页。进关只读取目标关卡配置，跳过失败关卡不会标记通关或发放奖励；点击首页开始可重新尝试存档对应关卡。

连击图路径为 `Texture/UI_Sprite/Game`；局内音效路径为 `voice/GamePlay`、`voice/Combo _F_type`、`voice/ResultSound`。游戏音乐从局内包读取 `voice/BGmusic/Game_music01` 及 02–04。

重新构建抖音包后，确认 main/internal/resources 为本地包，remoteBundles 包含 city-configs、city-thumbnails、各城市包（city-01-beijing 等）和 MainGameSources；将同次构建的 `build/douyins/remote/` 部署到资源服务器的 remote 目录。levels 本身不生成 Bundle，旧的 city / city-levels 构建产物不会自动更新为新目录。

验证：`node tools/test-city-resource-layout.cjs`、`node tools/test-game-bundle-loading.cjs`；真机检查首页、首次进关、城市图标、选关封面、美食图鉴、胜利/失败以及断网重试。
