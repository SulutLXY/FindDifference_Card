# 抖音原生排行榜

鸿蒙适配：通过系统信息 platform=openHarmony 判断。大厅隐藏 BtnRank，排行榜入口与成绩上报均提前返回，不调用鸿蒙不支持的排行榜 API；同步系统信息不可用时用异步结果更新按钮。其他系统保留原生排行榜。运行时禁用不会保证静态上传扫描不再列出接口，需重新构建后在鸿蒙模拟器或真机验证。

2026-10-01 改为点击入口直接调用 tt.getImRankList，不再切换游戏内 RankScreen。关闭官方面板后继续显示原游戏页面。

先 tt.login 强制登录；已有通关记录则 setImRankData 同步总通关数，上报失败仍尝试打开已有榜单。原生接口参数为 dataType:0、rankType:all、relationType:default（官方好友榜与总榜）、zoneId:default、suffix:关、rankTitle:通关排行榜。失败保留 errMsg/errNo，重复点击在请求完成前忽略。

关卡胜利后的成绩上报保留。抖音端不再创建 SubContextView、不调用 getOpenDataContext/getImRankData、不混入 NPC。排名、玩家资料和条数由原生面板管理。浏览器预览仍使用本地排行榜。

旧开放域文件保留但入口不再使用，game.json 已移除开放域配置。node tools/sync-douyin-rank-build.cjs 可移除旧构建包的开放域配置，保留其他字段；它不会更新主域脚本。

必须重新用 Cocos 构建字节跳动小游戏。本项目主包为远程资源，需将新构建的远程资源同步到当前 CDN，再打开新开发者工具包。仅替换 game.json 不会更新排行榜入口。

使用已登录账号在抖音手机端预览：打开官方面板、关闭后保持原页面、通关后成绩更新。模拟器不支持该接口时提示使用手机端。基础库至少2.70.0，分区参数建议3.5.0以上。

本地验证：node tools/test-douyin-rank.cjs；SDK模拟测试不能代替抖音真机验证。

官方文档：https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/game-rank/getImRankList
