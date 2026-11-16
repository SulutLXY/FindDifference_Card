# 抖音 Feed 复访与获客接入（2026-11-04）

客户端入口已经接入，平台开通、配置齐全和真机链路测试完成后才能上线。配置位于 `assets/resources/configs/platform-config.json` 的 `feed`。

## 当前方案

完整的 ID 和推荐流文案位于 `assets/resources/configs/platform-config.json`。复访 `contents` 中前 7 条为体力恢复（scene=2），接着 7 条为离线收益（scene=1），最后 7 条为重要事件（scene=3）。获客 `acquisitionContents` 包含 20 条，均进入玩家当前可玩的关卡。后台负责展示方案文案和图片。

客户端已开启复访、托管上报和获客。体力方案按实际回满时刻登记。离线收益和重要事件均使用七日签到的实际领取条件，14 条文案共用同一就绪时刻。

## 客户端行为

- 按北京时间记录首次真实进关日期。已有对局记录的老玩家使用“后续日”规则，不能在升级当天被当作新注册用户。
- 首日累计首次进入的不同稳定关卡 ID 达到 1、2、3、5、8、10、15 时提供订阅引导；每天最多实际调用原生订阅 6 次。重玩不增加关卡计数，跨章节计数连续。
- 后续每天首次真实进关提供一次引导，实际原生请求最多 1 次。已完成全场景订阅则不再邀请；状态查询失败不把玩家当作未订阅。
- 自动引导等待新手教程、设置和其他暂停流程结束，复用场景中的 `ADDSubscription`，不新建弹窗适配。引导期间暂停对局，关闭后恢复。
- 登录和状态查询提前进行；原生 `tt.requestFeedSubscribe({type:'play', allScene:true})` 仍在 `tt.onTouchEnd` 内同步调用。引导展示次数与真正的 SDK 尝试次数分别保存。
- scene=1、3 在当日签到可领时就绪。正常或双倍领取成功后，更新到北京时间下一个可领取日的零点。体力库存达到 99 时不能领取体力奖励，按签到规则判断下一次可领机会。旧版已经登记的 14 条排期在新版首次调度时覆盖。
- scene=2 按实际体力登记。进关扣体力后重新计算，领取体力奖励后同步提前的回满时刻。旧包已登记的体力场景在新版首次调度时更新，本轮已消费的内容继续保持清除状态。
- 每条成功结果单独保存，500ms 间隔顺序上传；失败停止本次批次，后续活动可重试未成功项，60 秒内合并重试。配置变更会开启新计划，请在正式发布前固定 ID 顺序。
- 从体力复访卡进入时，仅在 contentID、scene 和 extra.cycleStart 均匹配当前周期时将该条设为未就绪。签到关联的方案以实际领取结果更新，打开卡片仍可领取当日奖励。
- `contentID` 是内容标识，不是用完一枚就必须重新订阅的授权令牌。上述计划仅控制就绪条件，抖音决定是否和何时曝光，客户端无法保证精确每两小时推送或玩家离线 19 天后自动开启下一轮。

## Feed 预览及获客

`build-templates/bytedance-mini-game/game.ejs` 在引擎加载前保存 `tt.onFeedStatusChange`，避免用户快速点击造成进入事件丢失。

启动场景尾号 `3041` 表示推荐流直玩；query.feed_game_channel 为 1 时是复访，为 2 时是获客。预览先准备当前可进入关卡画面，但不扣体力、不记录真实进关、不开始倒计时、不弹教程或订阅、不触发广告和分享。收到 feedEnter 后只提交一次真实开局；feedExit 暂停并保留对局，重新进入不再次扣体力。旧基础库没有事件能力时，以首次真实触摸作为进入依据。

关卡画面准备并绘制后上报 `tt.reportScene({sceneId:7001})`，每次进程成功上报一次。获客默认直接进入当前可玩关卡。复访可选 `contents[].levelKey` 定向到配置中的稳定关卡 ID，但仍检查章节/关卡解锁资格，外部 query 不授予关卡或收藏。

鸿蒙和不支持全场景订阅的环境不调用订阅/就绪 API，现有广告、侧边栏、收藏和桌面能力继续按平台支持状况判断。

## 后台待办

1. 在运营 → 能力中心 → 推荐流游戏直玩 → 复访能力中按 Content_ID 选择要测试的体力恢复方案。
2. 使用免开发者服务端托管，选择含该 ID 的测试版本，用同一测试账号核验该方案的就绪状态。
3. 测试离线收益和重要事件时，在测试版本中用已订阅账号真实进关，保持当天签到可领，再扫各自方案的测试码。验证领取后次日条件的测试放在当天可领场景验证之后。
4. 在获客能力页为对应素材选择其获客方案生成测试码，核验关卡预览及进入流程。
5. 添加平台测试设备，验证对应测试版本的预览、进入、退出、订阅接受和拒绝、托管就绪状态及场景完成上报，再提审上线。

本次本地验证：`node tools/test-feed.cjs`；TypeScript 使用 `--lib ES2020,DOM`（现有项目已使用 includes/finally，默认 ES2015 lib 会对既有代码报错）。平台后台开通、真机实际曝光、原生授权 UI 与获客投放均不能由本地 mock 测试代替。

2026-11-04 已用 Creator 3.8.8 完成实际抖音构建，产物为 `build/feed-validation/douyin`，构建日志显示 Finished（8 秒）。`build/feed-validation/feed-audit.json` 记录脚本哈希、Feed 生命周期/托管/首帧上报及两个真实 ID 进入产物的检查结果。Feed、进关扣体力、订阅/桌面/收藏、鸿蒙、导航插屏、H5 和激励引导相关测试通过。

另有既存资源检查未通过：`tools/test-game-bundle-loading.cjs` 检出启动场景/本地模板仍引用远程 `assets/LobbySources/textures/UI_Sprite/icons/icon_settings.png`。本次未改动该图片或用户编辑的场景；它可能让启动阶段提前依赖主页包，应在后续整理公共图标时处理。实际构建已完成，此资源归属检查不等同于脚本构建失败。

官方资料：[复访接入](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/feed/minigame-feedpush-setting-guide)、[获客接入](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/feed/customer-access-guide)、[就绪托管 API](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/feed-subscribe/tt-store-feed-data)。
