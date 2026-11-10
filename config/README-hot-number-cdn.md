# HotNumber CDN统计文件格式

固定目录：https://hsy.rewanyouxi.com/games/mishi/ndzdk02/HotNumber/

每次发布一份独立JSON，按北京时间生成时间命名，例如2026-11-10_173618.json。目录中可以保留多份统计文件，后续客户端需要读取当前目录下的全部有效统计文件，并按统计时间区间处理覆盖关系，再重新计算。该文件不是单文件汇总或文件清单。

## 字段

| 字段 | 说明 |
| --- | --- |
| schemaVersion | 格式版本，当前为1 |
| type | 固定hot-number-statistics，识别统计文件 |
| recordKind | period=真实区间统计；baseline=上线前预设，不占真实统计区间 |
| baselineKey | 预设记录标识，当前固定prelaunch，同标识只取generatedAt最新的一份 |
| status | draft=数据未填完整，客户端须忽略；ready=对应类型的数据已完整 |
| generatedAt | 配置生成/版本时间，含+08:00时区 |
| timezone | 日期归属为Asia/Shanghai，北京时间 |
| statistics.startAt | 统计开始时间，包含该时刻 |
| statistics.endAt | 统计结束时间，不包含该时刻 |
| statistics.durationSeconds | 统计区间跨度，单位秒；区别于玩家游玩时长 |
| statistics.playerCount | 该区间的玩家人数，非进关次数 |
| statistics.averagePlayTimeSeconds | 同一区间的每名玩家平均总游玩时长，单位秒 |
| estimate.secondsPerLevel | 折算每关时长，固定45秒 |
| estimate.levelsPerPlayer | ceil(averagePlayTimeSeconds/45) |
| estimate.totalLevelPlays | 最终估算总关卡游玩数：playerCount×levelsPerPlayer |

没有数据时使用null，不用0代替缺失；有效的零玩家/零时长记录可以为0。真实数据的统计周期、宿主筛选、人群口径必须一致。小时/分钟时长需先换成秒；不能把所有玩家的合计时长填入人均字段。上线前手动指定的预设使用recordKind=baseline、source=manual-preset，不冒充后台统计。

## 生成方式

在项目根运行node tools/create-hot-number-config.cjs，可生成一份draft模板，按当前北京时间命名。它可上传占位，但不应参与客户端计数。

本次未上线，用户指定预设2100人、人均7分30秒，即450秒：人均折算ceil(450/45)=10关，估算总关卡游玩数21000。生成命令：

```powershell
node tools/create-hot-number-config.cjs --kind baseline --players 2100 --avg-seconds 450
```

预设没有真实统计周期，startAt、endAt、durationSeconds保留null，生成时间仍标注在generatedAt与文件名。未来遍历目录时，此预设作为一次性底数：同baselineKey仅取最新版本，不能把多个预设文件重复累加；后续真实period记录单独按区间处理。此前的草稿仍为draft，不参与计数。此21000是估算进关池底数，与各章节已有初始热度字段用途不同。

拿到真实数据后，用以下命令生成ready配置（这里是计算演示，不代表真实运营数据）：

```powershell
node tools/create-hot-number-config.cjs --start "2026-11-09T00:00:00+08:00" --end "2026-11-10T00:00:00+08:00" --players 100 --avg-seconds 180
```

上述演示的统计跨度为86400秒，人均折算4关，估算总关卡游玩数为400。统计跨度由起止时间推导，折算结果由人数和人均秒数自动计算。输出文件位于config/HotNumber；将JSON文件直接上传到固定CDN目录，不需要上传本说明。

日统计、周统计均可用起止时间表示。例如统计11月3日至9日，结束时间填11月10日零点。未来客户端须按实际起止时间去重，不按文件名猜统计周期；重叠汇总区间不能直接相加。

当前交付仅建立文件格式和生成工具，尚未替换现有PlayStatsService或启用CDN读取。初始热度、玩家存档与现有广告配置保持不变。目录URL是否支持列举文件仍待实际部署环境确认；本次未上传任何文件。
