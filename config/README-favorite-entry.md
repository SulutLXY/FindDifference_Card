# 收藏进入奖励

CollectGame 打开 ADDCollectGame，保留设计字号和布局，两个 BtnClose 均关闭页面。成功识别收藏进入后自动发免费提示×2，每个北京时间自然日一次。favoriteClaimDay 与 sidebarClaimDay 独立；奖励和领取日期一次写入，保存失败会回滚。

当前官方场景表未提供唯一的“我的收藏”场景标识；1036 包含个人页和首页侧边栏，因此不能直接按该后缀发奖。仅“已收藏”或显示收藏引导成功也不能证明从收藏进入。

platform-config.json 的 douyinFavoriteEntryRules 默认为空，发奖尚未启用。真机分别从收藏、侧边栏和普通入口启动，读取控制台 [FavoriteEntry] 的 scene、launch_from、location，验证唯一组合后配置规则。规则必须包含精确 scene，可同时要求 launch_from 和 location；不会读取分享 query 作为收藏证明。

冷启动和热启动共用已有 game.ejs 的启动事件桥，避免错过场景加载前的进入事件。当天判断依据收到该来源的日期，前后台普通唤醒会更新来源。原图、按钮字体和页面布局未修改。
