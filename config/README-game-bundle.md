# 局内资源拆分

## 2026 热梗接入（2026-10-15）

新增 `city-01-2026Hotmeme`（2026热梗）30 关，位于网络热点之后。原北京至西安整体顺延至 `city-02-beijing` 至 `city-09-xian`，共 10 大关卡、180 小关卡。configs、levels、thumbnails、Bundle 名称和美食配置表同步顺延，资源 UUID 保留。复制的新专题继续使用现有差异点，替换正式素材时需同步校对标注。

## 网络热点联调（2026-10-13）

`city-00-HotTips` 位于城市索引最前，共 30 关，按需求清单从「骑士小猫」到「松鼠的自助餐」排列。大小写须保持一致；图片加载路由和清单生成工具均支持此名称。大图独立远程包沿用 Merge Depend 配置；配置、城市图标和选关封面仍分别进入 city-configs / city-thumbnails。

当前图片、封面和差异点为复制的临时联调资源，尚非正式网络热点内容；配置已绑定新名称及专属资源路径，全部为 normal 类型。后续替换各关 scene-a / scene-b、icon 和 differences 即可。城市编号现已顺延，v3 存档自动迁移通关、解锁和评价，v2 数字存档迁移排除两个新增专题，避免旧进度错映射。

构建验证应检查 remote/city-00-HotTips 是否生成、新玩家是否进入网络热点第一关、30 关后的下一关是否进入 2026 热梗，再完成 30 关后进入北京，以及首次进关和跨城预下载是否只请求对应城市包。真机前需部署同次构建的完整 remote 目录。

- `assets/resources`：首包资源，城市总索引为 `configs/cities.json`，首页音乐为 `voice/BGmusic/Main_music00`，基础点击声保留在 `voice/ComboSound`。
- `assets/PleyGame`：Bundle 名为 `MainGameSources`，抖音远程加载、Merge Depend。
- `assets/Bundle`：仅组织目录，Bundle 开关关闭。configs 和 thumbnails 分别是 `city-configs`、`city-thumbnails` 远程 Bundle；levels 只作分类目录，其下每个城市目录单独启用 Bundle，例如 `city-02-beijing`。远程包在抖音使用 Merge Depend。

目录示例（全部路径均相对于 assets/Bundle）：

```text
configs/
  city-02-beijing.json                 城市名称、图标路径、关卡清单
  city-02-beijing-icon.jpg             城市卡片图标
  city-02-beijing/level-01/differences.json  小关卡配置
thumbnails/
  city-02-beijing/level-01/icon.jpg     选关封面
  city-02-beijing/city-02-beijing-BeiJingKaoYa.png  美食图鉴素材
levels/
  city-02-beijing/level-01/scene-a.jpg  关卡上图
  city-02-beijing/level-01/scene-b.jpg  关卡下图
```

启动读取首包的城市总索引和 city-configs 中的城市清单；进关只读目标关卡的 differences.json，再加载对应城市 Bundle 中的两张大图。选关和美食页才加载 city-thumbnails。只读取目标城市的包；跨城市进入关卡或预下载下一关时选择新的城市包。各 Bundle 合并同时发起的加载请求，失败后可以重试。

JSON 中的图像路径保留分类前缀，例如 `thumbnails/city-02-beijing/level-01/icon/spriteFrame`；GameFlow 选择对应 Bundle 后去掉 `thumbnails/`，以 Bundle 内部相对路径请求。大图 `levels/city-02-beijing/level-01/scene-a/spriteFrame` 则选择 `city-02-beijing` Bundle，内部路径为 `level-01/scene-a/spriteFrame`。请勿在 Bundle.load 中重复加分类或城市前缀。小关卡 `icon` 字段指定 thumbnails 路径；未指定时回退关卡上图。

城市和关卡的新存档 key 例如 city-02-beijing/level-01。移动文件时必须带上对应 .meta，保留 UUID；差异点 ID、坐标和半径不随目录调整改变。

主场景不再直接包含 Game 和 ResultModal。布局分别保存在 `assets/PleyGame/prefabs/GameScreen.prefab`、`ResultModal.prefab`；请打开对应预制体编辑局内与结算界面。GameFlow 首次进关在加载遮罩下加载并创建两者，后续复用。GameFlow 的 game/resultModal 场景属性留空。

收藏页与本地排行榜另存为 `assets/SecondaryUI/prefabs/CollectScreen.prefab`、`RankScreen.prefab`，首次打开时加载 SecondaryUI 并创建，后续复用。主场景的 collect/rank 绑定留空；抖音继续打开原生排行榜。抖音发布时将 SecondaryUI 与其他远程包一同部署。详细生命周期与验证步骤见 `config/README-secondary-ui.md`。

主场景中的城市卡、选关卡、美食卡和美食弹窗不直接绑定远程 SpriteFrame，由各界面按配置动态加载，避免首包通过模板引用提前拉取小图包。

首页 `Lobby/bg_showIcon` 保留编辑器绑定的静态首帧，初始化时保持可见；Animation 的动画列表及默认动画留空，关闭自动播放。进入城市列表或关卡选择页时后台预加载 `MainGameAimation` 的动画与首帧，仅准备资源，不激活主页。打开首页时复用预加载结果；尚未完成或失败时继续显示静态首帧，动画就绪后播放。离开首页停止，返回复用，失败可重试，界面销毁时释放动态资源引用。静态首帧和装饰图使用 resources/textures/UI_Sprite/V3 下的 lobby-hero-still.png 与 lobby-hero-detail-still.png 独立本地副本。不要将远程动画的 clips/defaultClip 或序列帧重新拖回场景；仅修改节点显隐不能消除构建依赖。构建前运行 node tools/test-lobby-animation.cjs 检查静态引用。

启动配置和存档迁移完成后自动开始当前关卡，不先进入首页。新玩家进入第一关，已有进度进入第一个已解锁且未通关的关卡，全部通关后沿用重玩第一关的规则。加载遮罩保持到关卡就绪，返回首页入口仍可使用。

进关时先加载玩法预制体和目标关卡配置，再等待上下图纹理加载并绑定到 Sprite，完成后才打开玩法页。动态创建玩法节点后重新将 Loading 置顶，等首帧绘制完成再关闭遮罩、开始计时；图片节点缺失或纹理无效按加载失败处理，不能提前进入空图玩法页。

启动、手动选关或配置加载失败时自动返回首页。结算点击「下一关」加载失败时，仅尝试一次再下一关（支持跨城市）；不存在后继关卡或再次失败就回首页。进关只读取目标关卡配置，跳过失败关卡不会标记通关或发放奖励；点击首页开始可重新尝试存档对应关卡。

连击图路径为 `Texture/UI_Sprite/Game`；局内音效路径为 `voice/GamePlay`、`voice/Combo _F_type`、`voice/ResultSound`。游戏音乐从局内包读取 `voice/BGmusic/Game_music01` 及 02–04。

重新构建抖音包后，确认 main/internal/resources 为本地包，remoteBundles 包含 city-configs、city-thumbnails、各城市包（city-02-beijing 等）、MainGameSources 和 MainGameAimation；将同次构建的远程产物目录（当前为 `build/remote/`）部署到资源服务器的 remote 目录。levels 本身不生成 Bundle，旧的 city / city-levels 构建产物不会自动更新为新目录。

验证：`node tools/test-city-resource-layout.cjs`、`node tools/test-game-bundle-loading.cjs`、`node tools/test-lobby-animation.cjs`；真机检查首页、首次进关、城市图标、选关封面、美食图鉴、胜利/失败以及断网重试。首页动画需检查首次打开、加载中离开、返回复用和下载失败后的重试。
