# 2026-11-10 章节累计游玩次数与重新上线初始值

## 展示与排序

章节顺序：网络热点 → 青花瓷 → 年度热梗 → 宠物故事 → 萌宠三国 → 恋爱美食。

| 章节 | 初始整数 | HotNumber显示 |
| --- | ---: | --- |
| 网络热点 | 219500 | 219.5K |
| 年度热梗 | 58750 | 58.75K |
| 宠物故事 | 103700 | 103.7K |
| 萌宠三国 | 60880 | 60.88K |
| 恋爱美食 | 358400 | 358.4K |
| 青花瓷 | 0 | 最新章节 |

青花瓷使用现有icon_leaf、icon_Mark_green资源，保持编辑器中徽标尺寸；不展示数字，但接通服务后仍统计进关事件。CitySelectScreen预制体已绑定这两张SpriteFrame，运行时按配置切换。未提供初始值且未接通统计的城市子章节不显示虚构热度。HotNumber、HotNumber_laber缺失时跳过赋值。

初始值和最新章节名单位于assets/resources/configs/platform-config.json的playStats；顺序源文件为config/chapter-order.json，生成后的cities.json同步更新。此次仅重新初始化热度统计，未清空玩家存档，也未改变325个永久关卡ID或章节内关卡顺序。

## 统计口径

每次关卡准备成功、实际开始一局时计1次，无须通关；重新开局重新计数。同一局暂停、继续、加时和复活不重复计数；加载失败、取消加载和体力不足不计数。入口集中在GameFlow.startLevel内部的begin，统计在后台进行。

客户端持久化待上传事件，重试沿用原事件ID；服务端SQLite事务去重，避免断线重发重复累加。章节数字为初始值加上该章节成员关卡的新进关次数。恋爱美食按8个城市包含的120个永久ID汇总，每次进关只为该专题增加1次。

初始值首次创建数据库时写入，服务重启和再次部署不会重复增加；不会为了初始值制造逐关历史记录。后续调整章节时运行node tools/sync-play-stats-catalog.cjs并更新服务目录中的catalog.json。

## 部署状态

当前没有真实统计服务器，apiBaseUrl保持空、playStats.enabled保持false。页面已显示指定初始值；接通服务并发布客户端后，才开始全服累计，不将本机记录冒充全服次数。

可部署目录：server/play-stats，支持Node.js 24直接运行或Docker Compose，包含持久卷、反向代理示例、在线备份和API说明。交付压缩包：output/play-stats-service-2026-11-10.zip。具体步骤见server/play-stats/README.md。

部署后配置HTTPS统计地址、抖音request合法域名，并将playStats.enabled置为true。更新客户端时保留其他平台、广告和Feed配置。本次新增徽标资源引用会更新LobbySources远程包，发布时需同步上传对应构建产物的remote目录。

## 验证

- TypeScript类型检查通过。
- tools/test-play-stats.cjs：真实HTTP/SQLite、初始值、并发、重复事件、事务回滚、重启持久化、在线备份、客户端断线重传及原生request传输通过。
- tools/test-hot-badge.cjs：初始格式、叶子/绿色背景、可选节点、过期响应隔离和青花瓷第二位通过。
- 进关加载、专题层级、城市解锁、历史永久ID、首包加载回归通过。
- 隔离构建build/play-stats-2026-11-10/douyin完成。实际产物审计确认：main仅依赖resources；MainGameSources仍为远程包且无额外包依赖；iOS高性能配置保留。
- 未部署公网服务、未上传远程资源、未进行真机联网统计验证。

资源索引生成器仍提示原有33条差异点标注范围警告，此次未修改这些关卡的图片或差异点坐标。
