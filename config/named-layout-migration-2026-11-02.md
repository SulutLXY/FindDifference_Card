# 章节及关卡目录正式改名（2026-11-02）

此前只完成配置解耦和年度热梗的内容合并，仍保留大部分旧数字目录。本次完成源资源的真实目录改名：12 个章节根目录及其 255 个关卡的大图、配置、缩略图目录，均按配置显示名称生成英文或拼音目录。

| 章节 | 当前目录 |
| --- | --- |
| 网络热点 | `wang-luo-re-dian` |
| 年度热梗 | `nian-du-re-geng` |
| 宠物故事 | `chong-wu-gu-shi` |
| 萌宠三国 | `meng-chong-san-guo` |
| 北京 | `bei-jing` |
| 上海 | `shang-hai` |
| 南京 | `nan-jing` |
| 厦门 | `xia-men` |
| 长沙 | `chang-sha` |
| 广州 | `guang-zhou` |
| 成都 | `cheng-du` |
| 西安 | `xi-an` |

每章目录位于 `assets/Bundle/levels/`。小关目录示例：`nian-du-re-geng/zhong-guo-ren-neng-fei/`，配置为 `nian-du-re-geng/configs/zhong-guo-ren-neng-fei/differences.json`，小图为 `nian-du-re-geng/thumbnails/zhong-guo-ren-neng-fei/icon.jpg`。

目录的物理字母排列不决定游玩顺序，仍以每章 `configs/city.json` 的 `levels` 数组为准。年度热梗仍为 2026 原有 30 关在前、2025 原有 25 关在后。所有章节的现有顺序及 255 个关卡永久 ID 保留。

同章同名目录冲突时追加固定 ID 的短哈希，不使用关卡序号。例如长沙两个“糖油粑粑”分别使用 `tang-you-ba-ba` 和 `tang-you-ba-ba-3b688c`。

`named-layout-migration-2026-11-02.json` 保存完整章节及关卡映射、章节 Bundle 原 UUID、2552 个图片和元数据文件的迁移前 SHA-256，以及全部差异点数据的基准摘要。改名前已通过原 Git 版本逐关比对差异点数据；持久化摘要供提交后继续回归。章节根 `.meta` 的 Bundle 名随目录更新，UUID 保留；关卡、配置和小图的 `.meta` 随资源移动，字节不改。

存档和来源审计中保留的旧 `city-* / level-NN` 是兼容标识，不是资源路径。每章 `legacyKeys` 记录旧章节名，兼容旧章节解锁和无新版布局快照的存档。冻结历史布局不重写；旧玩家的通关、已开放关卡及继续游戏位置通过稳定 ID 找到新目录。

美食表的历史章节/关卡列仍可以使用旧名称，生成器通过 `legacyKeys` 和关卡固定 ID 找到当前物理目录。40 个美食图标属于独立 `food-icons` 包，不因玩法目录改名重复搬迁；40 条映射和库存、评价的存档键保持原值。章节封面也继续使用独立 `chapter-covers` 包内的既有图片路径，不在本次重新绘制或改名。

迁移时另发现萌宠三国第25关下图在工作区已有人工作图更新：当前 SHA-256 为 `4bbe2bff502f89db34c44505aa22c9cc7b024132768d58023502dbd6c79d6969`，与旧导入审计不同。本次保留该工作区版本，不用历史素材覆盖；专项图片回归使用此次迁移快照核对这一张图，其他来源审计不改写。

运行 `node tools/test-named-layout.cjs` 校验所有物理目录、资源哈希、Bundle UUID、差异点数据及12章旧存档继续位置；年度热梗的顺序与跨年衔接另由 `test-annual-hotmeme.cjs` 校验。原有32项差异点边缘标注问题保留。

旧 `build/` 目录是此前构建产物，本次未改写。正式发布必须重新构建，上传新的远程 Bundle 目录和同次主包；服务器旧目录及哈希仍需保留，供旧客户端加载。本次未构建、部署或真机验收。
