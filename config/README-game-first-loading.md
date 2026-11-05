# 先进游戏、后台准备主页（2026-11-03）

> 2026-11-05现行规则见[首包检查与调整](README-startup-loading-2026-11-05.md)：首屏只加载本地玩法及当前章节；主页静态界面延后8秒有效游戏时间准备，收藏/封面/动画/附属页面改为按需。设置图标与SupportTexture已归入本地resources，不再有独立SupportTexture包。下文11月3日的整组预载和构建记录为历史方案。

启动顺序为 Loading → 当前 GameScreen。新玩家仍进第一关，旧玩家按稳定关卡 ID 继续存档；关卡顺序、解锁资格和差异点内容不在本次修改范围内。

## 资源和时机

| 包 | 当前归属 | 加载时机 |
| --- | --- | --- |
| main / resources | 本地 | Loading、公共 UI、小配置和存档迁移 |
| MainGameSources（assets/PleyGame） | 本地，priority 9 | GameScreen、ResultModal、玩法 UI 及音效，不再先下载远程玩法包 |
| SupportTexture | 本地 | 启动场景及游戏设置共用说明图，避免场景依赖强制拉远程包 |
| LobbySources | 远程 | 游戏页就绪后后台加载主页、章节选择、关卡选择、收藏、排行榜、主页音乐及签到 |
| MainGameAimation | 远程 | 与主页后台预加载一起准备主页动画，保留静态首帧 |
| 章节包、chapter-covers、food-icons | 远程 | 保持当前关卡或相应页面按需加载 |

主页的可编辑文件为 assets/LobbySources/prefabs/LobbyScreen.prefab。主场景不再包含 Lobby 节点，GameFlow.lobby/game 绑定留空。首次加载主页预制体时创建 inactive 实例，后台准备阶段不会打开主页、播放主页音乐或弹签到。用户返回主页时直接复用已创建的实例和下载缓存；尚未完成时显示 Loading，合并同一个请求，不重复创建。

启动不再等待 Main_music00，也不为了签到先切到主页。签到仅在玩家返回主页且当天符合提示规则时弹出；直接玩游戏的玩家不弹签到。奖励、漏签和双倍领取规则不变。

主页及相关预制体移动时携带 .meta，既有图片/签到 UUID 保持不变。公用图片继续留在本地，避免远程主页反向成为启动依赖。主页布局从当前磁盘场景提取，原位置、尺寸和缩放保留；本次没有新增弹窗适配。

## 异步与失败

后台下载失败只记录日志，不中断当前关卡。返回主页时可再次请求；返回期间如果切换了页面或开始新关，旧下载回调不能强制打开主页。快速重复返回与下载失败不会遗留暂停状态。原有返回主页插屏在主页真正打开后请求，避免资源尚未下载时请求广告。

如果启动/关卡加载失败且远程主页也暂时不可用，保持可点击重试的 Loading。普通对局中的主页下载失败恢复原暂停状态，玩家可继续或再次返回。

LobbyEntries 和 FavoriteGift 支持主页延迟出现后的显式绑定，不要求主页已经存在于启动场景。收藏进入奖励的检测仍可在游戏启动时运行。

## 检查与发布

已建立 test-game-first-loading.cjs 检查本地/远程归属、启动依赖闭包、迁移布局、后台不打开主页、并发合并、重试、缓存返回、导航过期、重复返回失败后的暂停恢复及仅主页签到。其他回归包括 game-bundle-loading、level-loading、daily-sign-in、lobby-animation、navigation-interstitial、lobby-entries、result-reward-entries、responsive-layout 和 TypeScript。

源文件大小不是构建后的代码包大小，不能据此承诺启动耗时。发布前应核对真实首包体积和冷启动时间。新构建必须配套上传 LobbySources 及引用的远程包；MainGameSources/SupportTexture 现由本地代码包提供。继续保留旧客户端需要的历史远程 MainGameSources 文件，不删除旧资源。

本次已通过 Cocos Creator 3.8.8 的 bytedance-mini-game debug 实际构建，输出为 build/game-first-validation/douyin。构建设置中 LobbySources 为远程，MainGameSources/SupportTexture 为本地；main/resources/MainGameSources/SupportTexture 的构建依赖不包含 LobbySources。设计尺寸仍为750×1334、policy 2。产物本地代码与资源目录原始总大小10,503,874字节，远程目录146,908,122字节；这些不是平台压缩包大小，也不是冷启动请求量。构建仍报告图集图片被其他资产直接引用、可能保留两份数据的警告，未在本次改写图集。验证产物未上传或发布，未进行真机测速。详细摘要见同目录 game-first-loading/build-audit.json。

迁移前的磁盘场景保存在 config/game-first-loading/game.scene.before.json，移动清单在同目录 migration.json。tools/migrate-game-first-loading.cjs 只用于本次迁移，不参与构建，不可重复运行覆盖已编辑的主页。

## 主页附属页面补齐（2026-11-03）

CitySelect 与 LevelSelect 已从启动场景抽出，分别保存为 assets/LobbySources/prefabs/CitySelectScreen.prefab、LevelSelectScreen.prefab，原节点尺寸、位置、缩放和绑定保持。GameFlow.citySelect/levelSelect 场景绑定留空。原 assets/SecondaryUI 整目录连同 .meta 移到 assets/LobbySources/SecondaryUI，取消子目录的独立 Bundle 标记，收藏和本地排行榜现在与主页共用远程 LobbySources。四项选择页专用图片也从 resources 移入该包，保留 UUID。

在 GameScreen 就绪后后台准备四个 inactive 页面实例，并预下载 chapter-covers 和 food-icons；不打开页面、不创建列表、不下载所有章节关卡大图。任一后台任务失败不阻塞游戏，后续可重试；首次点击尚未准备好的页面时显示 Loading，复用相同请求并检查导航版本。首次进入章节选择页的插屏等页面真正打开后请求。

实际构建 build/lobby-pages-validation/douyin 已通过：远程 LobbySources 的清单包含五个 Screen 预制体，remoteBundles 不再包含独立 SecondaryUI；main/resources/MainGameSources 不依赖 LobbySources。详细路径与原始目录大小见 game-first-loading/navigation-build-audit.json。该构建取代前文只迁主页本体的验证结果，未上传、未发布，也未进行真机冷启动测速。布局快照及移动记录分别为 game-first-loading/navigation-scene.before.json、navigation-migration.json。
