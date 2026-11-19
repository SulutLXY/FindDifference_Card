# 指定入口立即请求插屏

2026-11-19 复查并更新为六类入口：设置按钮（主页与玩法内）、排行榜按钮、玩家主动点击签到、收藏册按钮、成功结算页、失败结算页。

- 设置/排行榜在入口触发时尝试展示，成功/失败在结算页实际打开时尝试展示；不新增展示延时，也不等待5–8秒后补弹。
- 这六类入口跳过客户端60秒冷却和每日首局保护。原生广告频控、SDK能力与广告填充仍由抖音决定；平台拒绝时只记录原因，不自动延迟展示。
- 启动配置就绪后提前创建插屏并利用原生自动加载；Feed预览不预加载，转入正式游玩后补做预加载。预加载本身不暂停玩法、不显示广告。
- 修复旧 `readyOnly` 策略：不再因为 JavaScript 尚未收到 onLoad 就直接丢弃入口请求。六类入口使用 `immediate=true`，直接调用 SDK.show，由 SDK 判断能否展示；不 await load，也不在迟到的 onLoad 中补弹。加载未就绪、无填充或平台频控拒绝后释放请求状态，后台只预加载，留给下一次入口使用。
- 已展示广告关闭后销毁并提前准备下一条。未展示实例保留复用，避免原生SDK拒绝销毁或重复创建；新建实例不重复调用load，失败后的旧实例可显式重试，兼容回调型load。
- 保留激励视频互斥、重复请求保护、页面失效取消和关闭回调恢复。抖音原生排行榜在插屏关闭后再打开，避免两个原生面板重叠；鸿蒙不支持的排行榜入口仍提前返回。
- 无广告填充（包括 `There is no Ad to show!`）保留未展示实例并重新预加载，不丢弃仍被原生 SDK 持有的对象，避免后续重复创建失败。SDK 明确提示已展示过的实例可以销毁重建。
- 日志 placement 为 settings、rank、sign-in、collect、round-success、round-failure；`immediate=true` 表示立即调用 SDK，`preloaded` 记录调用前客户端缓存状态。实际失败的 phase、errCode、errNo、errMsg 均保留。

签到弹窗先显示，再发起插屏请求；每天自动弹出的签到不触发点击入口广告。收藏册仍先进入页面，再请求插屏，不再被首局保护拦截。其他既有返回主页/选关入口沿用各自规则。成功结算前已有的差异圈动画保留，广告在成功界面出现时触发。

验证：test-immediate-interstitial、test-interstitial、test-interstitial-native-lifecycle、test-navigation-interstitial、test-harmony-compatibility、test-secondary-ui、test-h5-no-ads、test-feed、test-result-details、test-level-loading、test-daily-sign-in、test-menu-tutorial及TypeScript。新增覆盖实际六类 GameFlow 入口、onLoad 回调滞后时仍调用 SDK、冷启动失败后 8 秒完成加载不补弹、签到主动/自动区分、无填充保留实例重试、客户端保护跳过、关闭后预加载、页面失效与激励互斥。

原生自动加载、展示后重建、未展示不可销毁及平台频控依据：[抖音插屏广告注意事项](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/ads/interstitial-ad/interstitial-ad-notice)。本次未进行新构建或真机广告展示验证。

官方当前限制：启动前 30 秒禁止插屏，两次插屏间隔 60 秒，展示过激励视频后展示插屏也需间隔 60 秒。立即请求不等于保证每次都能展示；频控或无填充由平台返回，不能通过客户端取消保护来绕过。
