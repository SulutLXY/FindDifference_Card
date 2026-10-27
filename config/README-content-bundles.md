# 内容包结构与释放（2026-10-21）

## 资源归属

| 位置 | 内容 | 加载时机 |
| --- | --- | --- |
| `assets/resources/configs/cities.json` | 章节顺序及名称、封面路径、关卡清单 | 启动及旧存档迁移，只读本地索引 |
| `assets/Bundle/chapter-covers` | 13 张大关卡封面，Bundle 为 `chapter-covers` | 关卡选择页 |
| `assets/Bundle/food-icons/<city>` | 40 张美食图标，Bundle 为 `food-icons` | 收藏页或美食详情弹窗 |
| `assets/Bundle/levels/<city>` | 本章配置、小关缩略图、玩法图片 | 进入该章或受控的下一关预下载 |

`configs/city.json` 仍是各章的源清单，`tools/build-manifest.py` 自动汇总到主包的 `cities.json.chapters`。运行时不再为了章节列表、解锁或存档迁移而读取所有章节包。修改章节清单后必须重新生成并更新主包。

公共解锁规则只由 GameFlow 的代码控制，不生成到各章或主包的章节元信息中。已有源清单的 `unlockMode` / `prerequisiteCity` 作为失效的历史字段原样保留，不参与运行时判定；不批量删字段，以免再次改变所有已发布旧包。新建章节不生成这些字段。生成器在 JSON 内容不变时不写回文件，也不改变原有格式。

小关缩略图的逻辑路径仍为 `thumbnails/<city>/<level>/icon/spriteFrame`，路由到该章包内 `thumbnails/<level>/icon/spriteFrame`。封面使用 `chapter-covers/<city>-icon/spriteFrame`；美食图标使用 `food-icons/<city>/<name>/spriteFrame`。美食目录 Excel 和生成器已同步到新路径。

51 张迁移图片连同 `.meta` 移动，图片内容和 UUID 保持不变。原有 200 关差异点数据没有修改，包括用户暂时保留的边缘越界标注。新增「2025年度梗」25 关沿用源素材 319 个差异点，该专题接入时共 12 章/225 关；接入说明见 [2025-hotmeme-resource-audit-2026-10-23.md](2025-hotmeme-resource-audit-2026-10-23.md)。

新增「萌宠三国」30 关后，当前共 13 章/255 关，顺序为宠物故事 → 萌宠三国 → 2025热梗 → 北京。2025 专题显示名由「2025年度梗」改为「2025热梗」，key 保持不变。完整接入说明见 [pet-three-kingdoms-resource-audit-2026-10-27.md](pet-three-kingdoms-resource-audit-2026-10-27.md)。

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

已通过 TypeScript 检查；内容包生命周期、页面图片引用、共享贴图、13 章/255 关资源路径、宠物故事、40 条美食映射、章节规则、旧存档迁移和关卡加载的脚本测试。美食表 `--check` 无待修复项，Python 目录生成器回归 11 项通过。

相关测试：`test-content-bundle-lifetime.cjs`、`test-city-resource-layout.cjs`、`test-page-sprite-lifetime.cjs`、`test-sprite-cache-lifetime.cjs`、`test-pet-story.cjs`、`test-2025-hotmeme.cjs`、`test-pet-three-kingdoms.cjs`、`test_manifest.py`、`test-chapter-rules.cjs`、`test-city-renumber.cjs`、`test-city-unlock.cjs`、`test-level-loading.cjs`、`test-food-icons.cjs`、`test_food_catalog.py`。

关卡生成器报告 32 项坐标/半径标注问题（原有 27 项、2025热梗源素材 4 项及萌宠三国源素材 1 项），保持原数据。完整游戏包静态检查还存在主场景引用 PleyGame 资源的既有断言失败，未作为本次资源迁移验收通过项。未执行实际构建、上传和真机测试。

目录迁移首次发布需要部署所有迁移后的包。后续纯新增章节，更新主包索引、上传新章节以及 `chapter-covers` 的增量即可；不修改旧章内容时，不应产生旧章文件增量。修改玩法配置、导入设置或引擎构建设置时仍可能产生相应旧包变化，以实际产物对比为准。

### 章节小图标的增量

大关卡的小图标是 `chapter-covers` 中的独立图片，不放回各章节包，也不合成覆盖所有封面的图集。新增封面会改变封面包的 `config.<hash>.json` 并增加对应图片及导入数据；既有图片及 `.meta` 不变时可以复用原哈希文件。包索引变化不意味着包内每张图都需要重传。章节内的小关缩略图仍属于对应章节包；美食图标仍使用独立 `food-icons` 包。

### 生成上传增量

备份上次**已完整上传至同一 OSS 目录**的完整 remote 产物，构建后运行：

```sh
npm run remote:package -- --previous build/remote0 --current build/remote --build build/douyin --out build/remote-update
```

路径为本工程当前构建的示例。以实际产物为准；工具读取代码包 `src/settings.<hash>.json`，检查 `--current` 中存在所需 Bundle 版本，选错 remote 会报错。每次输出使用新目录，避免上次增量文件混入。

- `manifest.json`：目标 OSS 目录、各包上传/复用数量，以及文件 SHA-256、大小和增量原因。
- `upload/remote/`：只包含需要上传的新文件或内容变化的文件；把其**内容**上传到清单标明的 `…/remote/`，先上传资源再发布配套代码包。
- `README.txt`：本次路径、统计及操作说明。工具只生成本地文件，不连接 OSS，也不上传。

比较基线必须是已完整发布的资源，而非任意上一次构建，也不能是上次的增量目录。发布成功后备份本次完整 `--current`，供下次比较。工具不会验证基线是否真实存在于 OSS。第一次发布、缺少可靠基线或更换 OSS 目录时，用 `--full` 替代 `--previous build/remote0`，上传所有当前引用的包。

增量回归测试：`npm run test:remote-update` 检查新增章节与封面不会打入旧章或旧图片、按内容识别变化、保留旧哈希、拒绝不配套代码包；`python -m unittest discover -s tools -p test_manifest.py` 检查新增章节不改旧清单字节及时间戳、历史规则字段兼容和缺失关卡保护。

服务器保留旧版本资源及哈希文件供旧客户端使用。`previousOnlyFiles` 仅列出旧构建独有文件，**不是删除清单**，不要开启镜像删除。此次 0.1.3.1 已经修改过多个旧章的解锁字段，其新配置及包索引仍需补齐；本次生成器调整不会让已生成的代码包改回请求旧哈希。

真机重点检查：进入关卡选择页不请求章节包；收藏页/美食详情只请求 food-icons；切换章节、返回大厅、快速开关收藏页及断网重试后，贴图正常且内容包/纹理数量不持续增长。
