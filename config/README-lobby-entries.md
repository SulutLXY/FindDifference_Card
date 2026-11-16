# 主页入口绑定

- Gameflow/Gameflow：入口有奖，打开 ADDGameflow，侧边栏回流后每日领取免费提示×2。
- Subscription：Feed 订阅，打开 ADDSubscription；BtnReview 为去订阅，Tips 显示订阅状态，BtnClose 关闭。
- AddDesktop：添加桌面和收藏游戏。
- Shar：主页分享。
- LiveStreamingCompanion：PC 直播伴侣说明。

2026-11-12：主页与玩法内打开设置均显示底部 `moneyTool`，不再按 `inGame` 隐藏主页设置入口。沿用 `GameplaySupport.prefab` 现有图标，左到右为“入口有奖、添加桌面、订阅”，分别复用侧边栏福利、桌面/收藏及Feed订阅功能；重复打开不叠加点击回调。平台能力限制仍按原逻辑处理。

两个面板独立绑定，奖励标题保持隐藏。侧边栏详情页的 `BtnReview/Label` 根据最新 `onShow` 来源显示文字：从 `launch_from=homepage` 且 `location=sidebar_card` 进入时显示“立即领取”，点击领取当天奖励；其他入口显示“跳转侧边栏”，点击关闭面板并调用 `tt.navigateToScene({ scene: 'sidebar' })`，等待玩家从侧边栏重新进入后再切换为“立即领取”。跳转成功回调本身不发奖。当天已领取后显示领取完成状态并隐藏操作按钮，防止重复领取。场景默认文案也改为“跳转侧边栏”，不再固定展示“领取奖励”。

Feed 订阅先查询全场景订阅状态，未订阅可点击授权。首次确认订阅成功后自动领取免费提示×2，每份存档只领取一次；已有订阅、尚未领取的老玩家在查询成功后补领。拒绝授权或查询失败不发奖。奖励和领取标记一并保存；存储失败或提示库存不足两个空位时保留“领取奖励”按钮，重试领取不再次调起授权。完成订阅并领奖后显示完成状态。正式平台能力需在后台开通，原生接口需真机验证。Feed 复访就绪上报和获客客户端已接入，详见 [Feed 说明](README-feed.md)。
