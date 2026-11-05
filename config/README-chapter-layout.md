# 章节与固定关卡 ID（2026-11-02）

新增逻辑分组：[恋爱美食专题说明](README-topic-hierarchy.md)。顶层5个专题，恋爱美食下有8个城市子章节；资源目录仍为12个叶子章节包，未再搬动。

目录已正式改名：全部12章和255关现使用配置名称对应的拼音/英文目录，例如 `assets/Bundle/levels/nian-du-re-geng/zhong-guo-ren-neng-fei/`。[目录迁移说明](named-layout-migration-2026-11-02.md)为当前规范，下面旧 `city-* / level-NN` 示例与“保持目录”描述是此前基础改造记录。

后续内容调整：2025 热梗已追加至 2026 热梗之后，合并显示为“年度热梗”，当前 12 章、255 关。原有 2026 的 30 关在前，原有 2025 的 25 关在后；[合并备注](annual-hotmeme-merge-2026-11-02.md)记录实际资源迁移与旧玩家兼容。下文“13 章保持原样”描述的是基础逻辑升级时的状态。

## 配置入口

- `config/chapter-order.json`：全局章节目录列表，数组位置决定展示顺序。添加、合并或删除章节后显式维护，不再按章节目录数字或字母排序。
- `assets/Bundle/levels/<章节目录>/configs/city.json`：各章独立源清单。`schemaVersion: 2` 的 `levels` 数组是关卡顺序的唯一来源。未列入清单的资源目录不会自动进入游戏。
- `assets/resources/configs/cities.json`：由 `python tools/build-manifest.py` 汇总的启动索引，不手工修改。所有条目的 ID、名称和目录进入首包，启动、存档迁移和继续游戏无需下载所有章节包。

示例：

```json
{
  "schemaVersion": 2,
  "name": "萌宠三国",
  "banner": "chapter-covers/city-PetThreeKingdoms-icon/spriteFrame",
  "levels": [
    {
      "id": "city-PetThreeKingdoms/level-01",
      "name": "黄巾起义",
      "folder": "huang-jin-qi-yi"
    }
  ]
}
```

`id` 在全项目中唯一，发布后永久不变。不拆分它查找章节或资源；历史 ID 中出现的旧章节或 `level-NN` 没有位置含义。新关卡可以使用无数字的固定英文/拼音 ID。

`name` 是界面显示名称，以章节清单为准，不要求与目录一致；`differences.json` 的旧名称仅作兼容回退。`folder` 是章内资源目录，使用英文字母、数字和连字符，建议采用小写拼音。章内目录不能重复，同名关卡或同音拼音使用内容含义后缀区分。

## 资源目录与后续调整

该示例加载当前章节包内的 `configs/huang-jin-qi-yi/differences.json`，默认大图路径为 `huang-jin-qi-yi/scene-a`、`huang-jin-qi-yi/scene-b`。图像的显式 `topImage`、`bottomImage` 和 `icon` 仍优先使用配置值，移动资源时也必须更新这些显式路径。

移动关卡到另一章时，将整个配置条目移到目标章节清单，保持 ID 不变，同时移动大图、差异配置、小图及其 `.meta`，并修正显式资源路径。资源加载使用目标章节与 folder，成绩、视频解锁、收藏和评价仍使用同一个 ID。美食表的章节/关卡目录列需同步调整；生成器根据章节条目输出固定 `levelKey`。

仅重排时只调整 `levels` 数组，不改 ID 或资源目录。合并章节时还要更新全局章节列表、封面和 Bundle 设置。新章节包仍需在 Creator 中配置；配置表不会自动创建 Bundle。

可选的 `nextChapter` 决定章末自动衔接的章节；不填时在本章结束。当前仅网络热点配置为接续 2026 热梗，维持原行为。生成器拒绝不存在的目标或衔接循环。

## 旧存档兼容

本次为现有 13 章、255 关补齐显式 ID、名称、目录，所有旧 ID、资源目录和排列顺序保持原值，尚未改名、移动、合并或重排资产。`tools/upgrade-chapter-config.cjs` 为一次性转换工具，重复运行不重写已升级清单。

`assets/resources/configs/chapter-layout-legacy.json` 冻结本次升级之前的关卡身份和顺序，禁止跟随新章节配置重新生成或修改。它同时用于 v2 数字存档的原顺序迁移，以及未升级玩家首次更新时恢复旧开放资格。随主包发布对应 JSON 和 `.meta`。

新存档保存 `contentLayout` 快照。启动时根据上次快照保留当时的首关、已通关关卡、前一关已通关的小关以及已有视频解锁资格，再原子保存当前布局。新玩家不会获得已删除旧章节的历史首关资格，存档失败时回滚并中止启动，重试不会丢失记录。

继续游戏先通过最后游玩的关卡 ID 查找当前归属章节，修正旧的章节记录；已经找不到的关卡回退当前有效章节。章节进度按当前列表统计，全局积分仍保留历史通关记录。旧客户端资源需保留，不能在新包上线时直接删除服务器旧文件。

## 验证与发布

运行 `node tools/test-chapter-layout.cjs` 验证改名、改目录、跨章合并、重排、视频解锁、继续游戏、旧资格、成绩/评价/库存、重复升级及保存失败回滚。运行 `python -m unittest discover -s tools -p test_manifest.py` 验证固定顺序、未列入目录忽略、重复 ID/目录和非法配置保护。

修改源清单后重新生成首包索引；构建并部署同一次产物的主包与受影响远程包。此次升级更改各章节源 JSON，会使相关远程包清单哈希发生变化，不能只替换代码包。升级未增加应用版本号，构建发布及真机验证另行执行。

全项目原有 32 项差异点坐标/半径校验问题仍保留。本次生成器执行会汇总新索引并返回这些问题，不代表本次修改了标注。

本次验证：21 项 Node 回归、4 项清单生成器测试、11 项美食表测试和 TypeScript 检查通过；40 条美食映射检查无待修复项。另行执行的 `test-game-bundle-loading.cjs` 仍停在原有的 `Startup must not reference gameplay assets` 主场景直接引用断言，本次未修改场景或玩法美术，不将该脚本列为通过。
