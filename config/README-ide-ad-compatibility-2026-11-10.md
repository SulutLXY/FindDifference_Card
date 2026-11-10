# 开发工具广告模拟兼容（2026-11-10）

用户在抖音开发者工具4.5.7点击激励入口时看到“当前环境不支持激励视频广告，请使用真机预览”。实际窗口探针确认：`platform=devtools`、SDKVersion4.33.0，`typeof tt.createRewardedVideoAd === 'function'`，但 `tt.canIUse('createRewardedVideoAd') === false`。广告位已配置；旧代码在创建实例之前就返回失败，未尝试工具的原生模拟实现。

`PlatformService._supportsAdApi` 保留普通能力判断，并添加仅适用于抖音IDE广告的兼容分支：当广告工厂实际存在且同步系统信息明确为devtools时，允许调用IDE原生广告模拟。只应用于激励视频与插屏，收藏、订阅、桌面等接口仍使用各自能力判断。Android、iOS、openHarmony、Windows及未知环境不因这一分支绕过canIUse。

仍由原生广告的onClose/isEnded判断完成，不以接口存在、show返回、提前关闭或模拟器环境自动发奖励。模拟实例缺失或接口不完整时返回失败，清除忙碌状态。旧的首局保护、冷却和配置的奖励规则不变。

验证：`tools/test-harmony-compatibility.cjs` 覆盖devtools工厂存在但canIUse=false、完整观看、取消、空实例、缺失接口、非广告API隔离和真机canIUse=false继续阻断。复活、体力、导航插屏、Feed及TypeScript测试通过。已用当前build/douying配置完成实际Creator构建；本次客户端脚本修复未改变远程资源包版本。

官方[开发工具更新记录](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/dev-tools/developer-instrument/download/developer-instrument-update-and-download)列有激励广告和插屏的模拟实现支持。IDE模拟不能代替真机的广告填充率、商业化权限或收益验证。
