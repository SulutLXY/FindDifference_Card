# 青花瓷资源导入（2026-11-05）

源图标目录：`D:\CocosCreator\关卡\瓷器图标`，20 张。
源关卡目录：`D:\CocosCreator\关卡\青花瓷`，60 关。

60关标注已齐全，已同步并加入正式章节顺序和启动索引，青花瓷追加到专题列表末尾。第一关免费，正常通关进入下一关，跳关使用既有视频解锁逻辑。20件瓷器随对应关卡获得，收藏页也可按原有视频规则解锁。本次与网络热点新增十关共同使正式目录达到13个叶子章节、6个顶层专题、325关、60件收藏。源目录保留原样。

## 项目内位置

| 内容 | 路径 |
| --- | --- |
| 20 张瓷器图标 | `assets/Bundle/food-icons/qing-hua-ci/*.png` |
| 瓷器收藏配置 | `assets/resources/configs/porcelain-catalog.json` |
| 青花瓷章节顺序及中文名称 | `assets/Bundle/levels/qing-hua-ci/configs/city.json` |
| 60 关图片 | `assets/Bundle/levels/qing-hua-ci/<关卡拼音>/scene-a.jpg`、`scene-b.jpg` |
| 关卡缩略图 | `assets/Bundle/levels/qing-hua-ci/thumbnails/<关卡拼音>/icon.jpg` |
| 已有差异点 | `assets/Bundle/levels/qing-hua-ci/configs/<关卡拼音>/differences.json` |
| 图标/关卡编号、原文件、哈希及对应关系 | `config/qing-hua-ci-source-map.json` |
| 整理脚本 | `tools/prepare-qing-hua-ci.py` |

图标原始画布均为正方形，其中 19 张为 1254×1254、一张为 512×512。输出统一 512×512 RGBA PNG，整个画布等比缩放，保留透明通道和器物完整构图，不切掉瓶口、底座和把手。文件名去掉编号、中文标点，使用小写拼音及连字符；“杓”按器物中的“勺”读音使用 `shao`。不进行生成式改画或额外抠图。

后续已完成PNG压缩，部分图标以PNG8索引色存储，512×512尺寸、透明轮廓和UUID保持。导入工具会按压缩审计保留未改源图的优化结果；详见 [PNG压缩记录](README-png-compression-2026-11-05.md)。

120张大图均由本机 Photoshop 13.0.0 使用 `JPEGSaveOptions.quality = 8`（0–12量表）实际导出，不使用 Pillow quality=80 近似替代。整图双三次缩放到1024×672，不裁切画面，保留归一化标注坐标。A 为源目录带关卡编号的图，B 为 `图片_...` 参考图。先前预设的PNG已替换为JPG，并将原 `.meta` UUID 迁移到新文件，避免引用断裂或两种格式并存。缩略图306×200，章节封面为首关图的612×400预设。所有新增资源均配套 Texture/SpriteFrame 元数据，章节继续使用远程包。

## 获得规则

按源文件前导数字排序，图标编号乘 3 是对应获得关卡编号。编号只用于导入顺序和映射记录，不进入资源文件夹名称。章节配置的 `levels` 数组维护顺序，关卡 ID 使用 `qing-hua-ci/<关卡拼音>`，收藏 ID 使用 `qing-hua-ci-<器物拼音>`，建立后保持不变。

例如：第 8 个“四爱图梅瓶” → 第 24 关“青花带进书房”：

- 图标：`food-icons/qing-hua-ci/si-ai-tu-mei-ping/spriteFrame`。
- 收藏 ID：`qing-hua-ci-si-ai-tu-mei-ping`。
- 关卡 ID：`qing-hua-ci/qing-hua-dai-jin-shu-fang`。
- 配置：`configs/qing-hua-dai-jin-shu-fang/differences.json`，待补时为 `pending.json`。

20个收藏均已建立 `category: porcelain`、`assetNumber`、稳定 `levelKey`、图片 UUID/SpriteFrame UUID 及图片路径。介绍和评价保留为空，未编造器物史料。每第3关写入 `type: porcelain` 和 `collectibleId`，60关均有正式 `differences.json`，已移除全部 `pending.json`。

瓷器目录独立于原有 40 条美食及美食 Excel 生成器。GameFlow 启动时同时读取瓷器目录，只合入已经出现在正式章节索引中的稳定关卡，草稿关卡不出现在收藏页，不向玩家展示不可领取的视频奖励。正式发布该章后，现有瓷器筛选、获得进度、视频解锁、自然通关获得和未查看标记即可沿用既有收藏逻辑。缓存的美食 JSON 不被合并过程修改，重复加载不会积累重复条目。

## 后续维护

在原关卡目录维护差异JSON。若图片没有变化，可以复用本次已核验的Photoshop暂存结果；图片有变化时需先重新导出，然后同步：

```powershell
python tools/prepare-content-jpeg-jobs.py
# 使用32位Windows PowerShell调用本机Photoshop COM：
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/export-content-jpeg.ps1 -Manifest temp/content-jpegs-2026-11-05/jobs.json
python tools/prepare-qing-hua-ci.py --publish
python tools/build-manifest.py
```

脚本保留源差异点坐标、半径及ID，保留已有 `.meta` UUID、瓷器介绍与评价。源目录是标注同步来源，请在源目录维护标注，避免项目内单独改坐标后被下一次同步覆盖。图片源哈希改变时，未重新导出的缓存会被拒绝使用。图片仍未改变时不必重复运行Photoshop。

仅核对源文件与现有导入结果，不写文件：

```powershell
python tools/prepare-qing-hua-ci.py --check
```

章节已列入 `config/chapter-order.json` 的 `chapters` 和 `navigation`。后续顺序调整维护该配置，再运行生成器汇总索引。构建发布需同步青花瓷章节、图标远程包及主包，不直接手改自动生成的 `cities.json`。

## 验证

`python tools/test-qing-hua-ci.py` 验证20张512图及透明像素、3倍编号对应、60个拼音目录、120张正式JPEG及1024×672元数据、原图/导出哈希、全部差异点保留、正式索引、远程Bundle及UUID唯一性。

`node tools/test-porcelain-loading.cjs` 验证未发布不展示、正式发布 20 条合入、部分关卡发布仅合入对应条目、旧字符串清单兼容以及重试不重复。另验证既有收藏、美食图标、签到启动、Feed 与 TypeScript。

标注校验记录：原有章节32项提示保持原样；青花瓷第30关“寿宴开席”差异点diff-14的radius=0.222586，超过生成器现有0.2上限。源数据仍在0–1归一化范围内，运行时可加载，本次不擅自缩小作者标注；生成器共报告33项提示，应在标注复核时确认此点。正式索引已生成，不能将生成器返回非零误认为漏导资源。

Photoshop的品质量表说明见[Adobe JPEGSaveOptions](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/objects/saveoptions/jpegsaveoptions)。
