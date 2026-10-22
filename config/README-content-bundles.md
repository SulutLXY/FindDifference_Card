# 内容包结构与释放（2026-10-21）

## 资源归属

| 位置 | 内容 | 加载时机 |
| --- | --- | --- |
| `assets/resources/configs/cities.json` | 章节顺序及名称、解锁方式、封面路径、关卡清单 | 启动及旧存档迁移，只读本地索引 |
| `assets/Bundle/chapter-covers` | 11 张大关卡封面，Bundle 为 `chapter-covers` | 关卡选择页 |
| `assets/Bundle/food-icons/<city>` | 40 张美食图标，Bundle 为 `food-icons` | 收藏页或美食详情弹窗 |
| `assets/Bundle/levels/<city>` | 本章配置、小关缩略图、玩法图片 | 进入该章或受控的下一关预下载 |

`configs/city.json` 仍是各章的源清单，`tools/build-manifest.py` 自动汇总到主包的 `cities.json.chapters`。运行时不再为了章节列表、解锁或存档迁移而读取所有章节包。修改章节清单后必须重新生成并更新主包。

小关缩略图的逻辑路径仍为 `thumbnails/<city>/<level>/icon/spriteFrame`，路由到该章包内 `thumbnails/<level>/icon/spriteFrame`。封面使用 `chapter-covers/<city>-icon/spriteFrame`；美食图标使用 `food-icons/<city>/<name>/spriteFrame`。美食目录 Excel 和生成器已同步到新路径。

51 张迁移图片连同 `.meta` 移动，图片内容和 UUID 保持不变。200 关差异点数据没有修改，包括用户暂时保留的边缘越界标注。

## 内存生命周期

原有页面图片已使用 `addRef/decRef`，GameScreen 也会释放上下两张玩法图；原章节 Bundle 的 Map 没有卸载流程。

现在 `ContentBundlePool` 记录页面、玩法图片以及异步加载/预下载请求的使用数量。最后一个使用者归还后，通过 `assetManager.removeBundle` 移除包清单。图片在解除 Sprite 绑定后 `decRef`，配置 JsonAsset 复制为普通数据后 `decRef`，引擎据引用计数回收资源和依赖；不调用会强制销毁共享资源的 `releaseAll`。

- 关闭章节选择页释放封面；关闭收藏页释放其美食图片。如果美食详情仍打开，保留详情所用图片和美食包，直到详情也关闭。
- 离开对局、切关、失败或销毁时归还玩法图片引用及包使用权。仍在使用的选关缩略图不会被误删。
- 页面重建、快速关闭再打开、同图多页面使用、加载失败重试均按独立使用权处理。
- 页面已关闭时，进行中的请求会持有包直至回调结束；迟到的图片立即归还，不绑定到新页面。无法取消的网络请求不会被强制中断。
- 下一关预下载在请求结束前持有对应章节包；切走后不继续发起后续图片请求。

这些规则针对本次三类内容 Bundle。`MainGameSources`、`SecondaryUI` 等公共界面包仍由复用的预制体、音效和界面对象持有，并非所有隐藏界面都销毁。主包配置和已解析的少量关卡数据也会保留。此次没有清空下载磁盘缓存或引擎的预下载缓存，也不保证进程内存立即归零；纹理回收与缓存效果仍需真机内存曲线验证。

## 验证与发布

已通过 TypeScript 检查；内容包生命周期、页面图片引用、共享贴图、11 章/200 关资源路径、宠物故事、40 条美食映射、章节规则、旧存档迁移和关卡加载的脚本测试。美食表 `--check` 无待修复项，Python 目录生成器回归 11 项通过。

相关测试：`test-content-bundle-lifetime.cjs`、`test-city-resource-layout.cjs`、`test-page-sprite-lifetime.cjs`、`test-sprite-cache-lifetime.cjs`、`test-pet-story.cjs`、`test-chapter-rules.cjs`、`test-city-renumber.cjs`、`test-city-unlock.cjs`、`test-level-loading.cjs`、`test-food-icons.cjs`、`test_food_catalog.py`。

关卡生成器仍报告原有 27 项坐标/半径标注问题，本次保持原数据。完整游戏包静态检查还存在主场景引用 PleyGame 资源的既有断言失败，未作为本次资源迁移验收通过项。未执行实际构建、上传和真机测试。

发布必须重新构建主包、`chapter-covers`、`food-icons` 及迁移后的所有章节包，先部署同次构建远程产物，再更新主包。服务器保留旧版本资源及哈希文件供旧客户端使用。

真机重点检查：进入关卡选择页不请求章节包；收藏页/美食详情只请求 food-icons；切换章节、返回大厅、快速开关收藏页及断网重试后，贴图正常且内容包/纹理数量不持续增长。
