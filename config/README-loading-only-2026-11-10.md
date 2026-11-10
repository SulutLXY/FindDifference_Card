# Loading首包与远程玩法（2026-11-10）

当前唯一生效的启动边界：Loading的图片和动画留在本地，玩法包 MainGameSources 保持远程，当前章节按需加载，主页及附属页面延后。旧文档中的“玩法包本地”不再适用。版本保持0.1.5.2。

## 原因与修复

截图中的 `Please load bundle MainGameSources first` 来自构建后的资源重定向：玩法包优先级9高于resources的8，共用动画/图片被分配进玩法包；启动场景直接引用这些资源，发生在玩法包下载之前。旧源码UUID检查没有覆盖构建重定向，故未发现该问题。

没有用提前加载所有远程包解决。已进行实际拆分：

- 主场景 `assets/scene/game.scene` 只保留Canvas/Camera/GameFlow/Screens/Loading。Loading直接依赖6项资产：背景、进度条、进度条底图、猫图标、两段Loading动画。
- 小型启动配置（章节索引、平台配置、存档迁移规则、奖励目录等8份JSON）保留resources。它们用于确定继续哪一关、保留旧进度和配置游戏，不触发封面、收藏图片下载。它们属于Loading的启动数据，不是额外页面视觉素材。
- 原场景的设置、教程、模拟广告、收藏获得/解锁、订阅及桌面说明等节点抽为 `assets/PleyGame/prefabs/GameplaySupport.prefab`。13个根节点及子节点保留原位置、缩放、显隐、文字和SpriteFrame UUID。运行时下载成功后挂回原Canvas或Screens层级，编辑请打开该预制体。
- 74项非Loading资产连同meta移入 `assets/PleyGame/Common/`，保留图片/动画字节及UUID。其中包括EnergyDisplay、TouchPoint预制体、公共动画、设置/教程/按钮图、说明图及点击音效。迁移清单见 `loading-only/migration.json`；其中icon_Idea的原项目路径为PleyGame/Texture/icons，经过本次早期检查的临时本地路径后归入Common。
- `MainGameSources` 使用远程配置，priority7；resources使用内置priority8。Creator会将resources自身优先级固定为8，因此通过降低玩法包优先级保持Loading资源所有权。

## 加载顺序

1. 引擎加载本地internal、resources、main，显示Loading。
2. 读取本地小配置和存档，选择当前章节与关卡。
3. 在Loading下下载MainGameSources及当前章节；玩法包成功后创建GameplaySupport、GameScreen、ResultModal，体力栏和点击特效也通过远程Common路径加载。
4. 本关两张图片就绪、首帧绘制完成后，才隐藏Loading并进入对局。并发下载合并；失败保持原有重试和返回流程，过期/已销毁请求不创建节点。
5. 累计8秒有效游玩后后台准备LobbySources主页静态界面与音乐。暂停、教程、Feed预览、结算等不累计等待时间。
6. 实际打开主页才加载MainGameAimation；章节封面、收藏图片、附属页面及签到继续按入口加载，不整包预下载。

若先因体力不足等路径进入主页，会先确保远程Common及支持弹窗就绪，再创建主页，避免主页使用公共资源时包尚未加载。

## 验证

- 新增 `tools/audit-built-startup.cjs`：检查真实构建settings、bundle deps与redirect，而不是仅看源码。main/resources只能指向启动前已经加载的本地包，禁止反向依赖MainGameSources、主页、收藏或其他远程包；确认玩法仍为远程、高性能配置保留。
- `tools/test-built-startup.cjs` 用回归夹具复现并拦截本次截图问题，覆盖本地/远程未加载依赖、主页隔离及高性能标志。
- `tools/test-loading-only.cjs` 核对实际移动字节、抽取前后节点几何/文字/UUID，以及下载屏障、失败重试、合并请求和销毁后回调保护。
- 首屏、玩法加载、体力预设、点击特效、翻页、章节资源生命周期、导航插屏、Feed、签到、鸿蒙及TypeScript相关检查通过。

实际Creator3.8.8生产配置构建完成，产物在 `build/loading-only-2026-11-10/douyin`，远程目录在该产物内的 `remote/`。构建检查结果见 `loading-only/build-audit.json`：resources没有外部依赖，main仅依赖resources；MainGameSources远程且不依赖主页包。仍有既有图集直接引用导致重复保留的构建警告，与本次包未加载错误不同。

通过douyin-ide在同一microgame窗口（windowId5）验证，使用该构建的本机HTTP资源服务，临时替换的仅是忽略目录中的验证包server地址。Loading后进入骑士小猫，教程/点击、设置、返回主页、主页签到均显示正常；观察到玩法包、主页包和主页动画相应请求200，验证期间无新的 `Please load bundle` 或加载失败错误。验证仅覆盖开发工具普通运行模式，未代表iPhone高性能模式验收。证据摘要见 `loading-only/runtime-audit.json`，完整日志和图片路径留在本机temp。

## 发布

验证结束后恢复验证包的正式server地址，项目原正式地址不改。正式使用需部署本次产物中整个 `remote/` 到构建settings指定服务器目录的 `remote/`，再使用同次代码包。服务器尚无新的 `MainGameSources/config.ca6b2.json` 时会返回404；这代表远程资源未部署，不能用旧包、仅改代码或清缓存代替同步。此处未执行OSS上传或平台发布。

运行检查：`node tools/audit-built-startup.cjs build/loading-only-2026-11-10/douyin`。历史PNG压缩备份/路径请结合 `loading-only/migration.json` 恢复到新Common位置，避免恢复到旧resources后重新引入首包素材或重复UUID。
