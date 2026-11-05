# 收藏游戏与收藏进入奖励

主页 `CollectGame` 现在直接调用 `PlatformService.favoriteGame()`，在本次按钮点击的同步调用链内发起 `tt.showFavoriteGuide({ type: 'customize' })`，不等待登录、动画或定时器。正常返回按 `isFavorited` 提示已收藏或暂未收藏；较旧基础库没有该字段时只提示引导已打开，不误判收藏状态。

接口缺失、调用失败或超时时使用原有 `ADDCollectGame` 作为补充教学，保留设计字号和布局，两个 `BtnClose` 均关闭页面。正常返回未收藏不会再追加教学弹窗。重复点击只发起一次请求；离开主页、组件销毁后迟到的回调不打开旧弹窗。

收藏引导回调不直接发放“从收藏进入”奖励。成功识别收藏进入后仍自动发免费提示×2，每个北京时间自然日一次。favoriteClaimDay 与 sidebarClaimDay 独立；奖励和领取日期一次写入，保存失败会回滚。

当前官方场景表未提供唯一的“我的收藏”场景标识；1036 包含个人页和首页侧边栏，因此不能直接按该后缀发奖。仅“已收藏”或显示收藏引导成功也不能证明从收藏进入。

platform-config.json 的 douyinFavoriteEntryRules 默认为空，发奖尚未启用。真机分别从收藏、侧边栏和普通入口启动，读取控制台 [FavoriteEntry] 的 scene、launch_from、location，验证唯一组合后配置规则。规则必须包含精确 scene，可同时要求 launch_from 和 location；不会读取分享 query 作为收藏证明。

冷启动和热启动共用已有 game.ejs 的启动事件桥，避免错过场景加载前的进入事件。当天判断依据收到该来源的日期，前后台普通唤醒会更新来源。原图、按钮字体和页面布局未修改。

官方接口：https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/favorite/tt-show-favorite-guide

验证：`node tools/test-favorite-guide.cjs`、`node tools/test-lobby-entries.cjs`、`node tools/test-sidebar.cjs` 和 TypeScript 检查。接口测试使用模拟回调；仍需手机抖音真机验证原生收藏弹窗。
