# 指定入口立即请求插屏

四类入口：设置按钮（主页与玩法内）、排行榜按钮、成功结算页、失败结算页。

- 设置/排行榜在入口触发时尝试展示，成功/失败在结算页实际打开时尝试展示；不新增展示延时，也不等待5–8秒后补弹。
- 这四类入口跳过客户端60秒冷却和每日首局保护。原生广告频控、SDK能力与广告填充仍由抖音决定；平台拒绝时只记录原因，不自动延迟重试。
- 启动配置就绪后提前创建插屏并利用原生自动加载；Feed预览不预加载，转入正式游玩后补做预加载。预加载本身不暂停玩法、不显示广告。
- 入口仅使用已就绪广告。尚未就绪时本次跳过并保持后台加载，迟到的加载回调不会自行展示；下次用户触发入口再尝试。后台加载超过15秒仍无结果时，下次入口可重新请求加载。
- 已展示广告关闭后销毁并提前准备下一条。未展示实例保留复用，避免原生SDK拒绝销毁或重复创建；新建实例不重复调用load，失败后的旧实例可显式重试，兼容回调型load。
- 保留激励视频互斥、重复请求保护、页面失效取消和关闭回调恢复。抖音原生排行榜在插屏关闭后再打开，避免两个原生面板重叠；鸿蒙不支持的排行榜入口仍提前返回。
- 日志placement为settings、rank、round-success、round-failure；readyOnly=true表示仅立即展示已就绪广告，跳过原因可在日志中查看。

本次只调整上述入口，其他既有返回主页/选关/收藏等入口沿用各自规则。成功结算前已有的差异圈动画保留，广告在成功界面出现时触发。

验证：test-immediate-interstitial、test-interstitial、test-interstitial-native-lifecycle、test-navigation-interstitial、test-harmony-compatibility、test-secondary-ui、test-h5-no-ads、test-feed、test-result-details、test-level-loading及TypeScript。新增测试覆盖8秒后完成加载不补弹、四类实际GameFlow入口、客户端保护跳过、关闭后预加载、页面失效与激励互斥。兼容测试同步补齐新版结算数据字段。

原生自动加载、展示后重建、未展示不可销毁及平台频控依据：[抖音插屏广告注意事项](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/ads/interstitial-ad/interstitial-ad-notice)。本次未进行新构建或真机广告展示验证。
