# 0.1.3.0 阶段交接（2026-10-21）

> 本文为拉取时的阶段记录。后续封面/美食图标拆包、主包章节索引及释放逻辑的当前状态见 [README-content-bundles.md](README-content-bundles.md)。

本次按用户要求保存当前工作并推送，供同事继续修改。这是阶段检查点，尚未完成发布验收。

## 当前改动

- 版本更新为 0.1.3.0。
- 导入宠物故事 20 关的玩法图片、差异点配置和小图，排列在 2026 热梗之后；总计 11 章、200 关。
- 选择页改为关卡选择，范围显示本章名称及本章 1 至总数。
- 网络热点及 2026 热梗沿用顺序开放；其他章节首次广告解锁，章节内独立推进。
- 新增旧存档一次性迁移规则，合并既有解锁资格、保留进度并记录继续游玩的章节。
- 主包仅保存全局索引 cities.json、兼容规则 chapter-rules.json 等全局配置。每章清单、差异点、封面、小图、玩法大图归各自的远程章节 Bundle；更新加载逻辑及生成工具路径。

## 已验证

- TypeScript：`node D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript/bin/tsc -p tools/tsconfig-hud-check.json` 通过。
- `node tools/test-app-version.cjs` 通过。
- 结构读取确认 11 份章节清单及 200 份差异点 JSON 可解析，主包索引中宠物故事位于热梗之后。
- 上述检查不代表资源依赖、广告、存档迁移和实际打包已经验收。

## 同事接续事项

1. 同步资源目录迁移后的测试夹具与 mock。chapter-rules、pet-story、city-renumber、city-resource-layout、level-loading、page-sprite-lifetime、game-bundle-loading、food-icons 等脚本仍存在旧路径或旧加载接口假设；迁移后的完整回归尚未通过。不要直接用此前迁移前的测试结果作为发布依据。
2. 同步 `config/food-catalog.xlsx` 中资产路径。JSON 资产路径及构建工具已调整，Excel 尚未同步；先用 `python tools/build-food-catalog.py --check` 检查，再决定修复并重新导出。
3. 验证清单生成工具、食物目录工具的完整生成结果、所有 spriteFrame 引用与 Cocos UUID 归属；完成编辑器导入、实际构建和远端加载测试。本次没有完成打包或上传资源服务器。
4. 实机验证新玩家广告解锁、老玩家多种历史存档迁移、失败重试、继续游戏及章节末关行为。
5. 原素材中宠物故事第 8 关差异点 7 的 y、第 17 关差异点 12 的 x、第 19 关差异点 9 的 y 超出归一化范围；目前保留源数据，需策划确认。旧资源布局的导入记录见 PetStory-resource-audit-2026-10-21.md，其路径描述以本文及 README-chapter-rules.md 的最新布局为准。

## 发布注意

首次迁移必须构建并上传全部迁移后的章节包，然后更新主包；后续新增章节才可仅上传新章节包并更新主包总配置。保留线上旧共享包及旧主包引用的哈希文件，以免影响未更新玩家。只上传新章节包而不更新主包，不应改变旧主包可见的章节。

个人简历、图片生成输出及临时文件不属于本次提交。
