# 热点玩法及青花瓷合入（2026-11-05）

本次正式目录为13个叶子章节、6个顶层专题、325关、60件收藏（40美食＋20瓷器）。未提升版本号，未执行Git提交、推送或平台上传。

## 网络热点

从 `D:\CocosCreator\关卡\热点玩法` 导入10关，按参考图编号 `图片_001` 至 `图片_010` 排序。用户已确认紧接“闪身步”之后插入，新增关卡占第3–12关，原“羽毛球关灯”及后续顺延。网络热点由30关增至40关，原30关的名称、目录、固定ID和原图/标注保持不变。

| 新位置 | 名称 | 资源目录 |
| --- | --- | --- |
| 3 | 模仿小猴姿勢 | `mo-fang-xiao-hou-zi-shi` |
| 4 | 抽纸挑战 | `chou-zhi-tiao-zhan` |
| 5 | 异世界来了个年轻人 | `yi-shi-jie-lai-le-ge-nian-qing-ren` |
| 6 | 沙县爱情故事 | `sha-xian-ai-qing-gu-shi` |
| 7 | 功夫小咪 | `gong-fu-xiao-mi` |
| 8 | 选到一样就买 | `xuan-dao-yi-yang-jiu-mai` |
| 9 | 上课偷吃挑战 | `shang-ke-tou-chi-tiao-zhan` |
| 10 | 挑战切超长蛋挞 | `tiao-zhan-qie-chao-chang-dan-ta` |
| 11 | 秋日收藏 | `qiu-ri-shou-cang` |
| 12 | 词不一样就跑步 | `ci-bu-yi-yang-jiu-pao-bu` |

新增ID采用 `wang-luo-re-dian/<拼音>`；原 `city-00-HotTips/level-NN` ID永久保留，不根据新位置重编号。通过既有 `migrateContentLayout` 保留旧玩家已经开放的小关和视频解锁资格；最后游玩位置继续按固定ID查找。新玩家完成“闪身步”后进入新增首关，新增第十关通关后衔接原“羽毛球关灯”。章末仍进入“年度热梗”。

新增10关共133处差异点，源坐标、半径和差异点ID均保留。图片、配置、缩略图分别在：

- `assets/Bundle/levels/wang-luo-re-dian/<拼音>/scene-a.jpg`、`scene-b.jpg`。
- `assets/Bundle/levels/wang-luo-re-dian/configs/<拼音>/differences.json`。
- `assets/Bundle/levels/wang-luo-re-dian/thumbnails/<拼音>/icon.jpg`。

章节源清单：`assets/Bundle/levels/wang-luo-re-dian/configs/city.json`。来源和哈希：`config/hot-gameplay-import-2026-11-05.json`。同步脚本：`tools/import-hot-gameplay.py`，重复运行不再次插入相同ID。

## 青花瓷

60关全部导入，追加至专题列表末尾，已经写入 `config/chapter-order.json` 的 `chapters/navigation` 并重新生成 `assets/resources/configs/cities.json`。所有 `pending.json` 已清理，20件瓷器按图标编号×3关联对应关卡。现有收藏页会显示瓷器分类及新的总收藏进度。

专题直接开放、首关免费、正常推关进入下一关、视频跳关，以及收藏自然获得/视频领取均沿用原有逻辑。具体资源、ID和维护说明见 [README-qing-hua-ci.md](README-qing-hua-ci.md)。

## 图片品质及元数据

140张新增/替换的大图均由本机 Photoshop 13.0.0 使用 `JPEGSaveOptions.quality=8` 实际导出（12级品质量表），统一1024×672，RGB，文件名 `scene-a.jpg`、`scene-b.jpg`。使用整图双三次缩放，不裁切造成坐标偏移；不使用Pillow quality=80替代Photoshop品质8。关卡缩略图306×200；512×512瓷器图标仍为透明PNG。

导出计划及进度在 `temp/content-jpegs-2026-11-05`；源文件保持原样。青花瓷先前预设的PNG替换为JPEG时迁移原 `.meta` UUID，Texture/SpriteFrame引用保持一致；旧PNG及其旧meta已移除，避免双份资产或重复UUID。网络热点新增资源使用独立UUID，不改变原有资产。

## 验证及标注备注

`tools/test-hot-gameplay.cjs` 覆盖插入顺序、133处源标注、原30关顺序和身份、资源哈希、旧成绩/道具/视频资格、旧位置继续游戏及新增链路。`tools/test-qing-hua-ci.py` 覆盖20图标、60关及120张JPEG、UUID唯一性、3倍关联、全部源标注和正式索引；另验证收藏、分页、章节迁移、原有章节、Feed、签到启动及TypeScript。

`tools/build-manifest.py` 已生成正式索引，但校验仍返回非零：本次导入前已有32项历史标注提示；本次新增一项为青花瓷第30关“寿宴开席”的diff-14，radius=0.222586，大于现有0.2阈值。源标注未擅自缩小，33项提示均记入本次审计。十个新增热点关卡没有新增标注校验问题。

本次Cocos Creator 3.8.8实际抖音构建完成（10秒），产物 `build/content-2026-11-05-validation/douyin`。应同步发布同次产物中的主包、`wang-luo-re-dian`、`qing-hua-ci`、`food-icons`及封面包。此构建验证不代表已经平台上传或真机验收。
