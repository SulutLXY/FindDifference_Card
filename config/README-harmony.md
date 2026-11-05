# 抖音小游戏鸿蒙适配（2026-11-04）

本项目为 Cocos Creator 3.8.8 普通抖音小游戏，按小游戏指南适配，不套用小程序或 Unity Native 的支持限制。

官方依据：https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/harmony/harmony-compatibility

## 代码处理

- `PlayerInfoService` 同时识别 `platform=openHarmony` 和 `system` 中的 `OpenHarmony`，大小写兼容。支持 IDE 的 `platform=devtools` 搭配 OpenHarmony 系统字段。
- 同步读取失败时使用 `tt.getSystemInfo`，并发查询合并。系统尚未识别或识别失败时，受限入口先隐藏；Android/iOS 识别完成后恢复原来设计为显示的按钮，不激活美术原本隐藏的节点。
- `PlatformService` 提供 `supportsSharing`、`supportsFeedSubscription`、`supportsRanking`。鸿蒙下分享、订阅、订阅状态查询、为订阅准备的登录、排行榜打开和成绩上传均提前返回，不调用对应 SDK 方法。
- `LobbyEntries` 在主页、设置和结算页隐藏订阅入口；主页隐藏分享与直播伴侣入口。原生订阅触摸回调也有能力检查，避免遗留点击路径绕过限制。
- `ResultModal` 在鸿蒙隐藏成功后的“分享成绩”，失败时继续隐藏。系统识别结果异步返回后检查弹窗版本，不能把失败页或已关闭页面重新显示成可分享。
- `GameFlow` 分享调用未发起时不会提示“已打开分享面板”。原生排行榜入口先检查系统能力，再考虑插屏和榜单调用，避免在不支持的入口先展示广告。
- 广告、添加桌面和收藏入口检查 API 是否存在，并在宿主提供 `canIUse` 时尊重其结果；不按鸿蒙系统一刀切关闭广告或侧边栏能力。`10302` 平台不支持错误会返回中文提示；失败不阻塞游戏，激励取消或失败不发奖励。
- 侧边栏继续通过 `checkScene` 判断能力，以最新 `onShow` 来源判定资格。收藏继续通过官方 `showFavoriteGuide`，添加桌面继续通过 `addShortcut`，均保留失败处理。
- 不修改界面位置、尺寸、Widget、动画、美术、存档或关卡规则；不新增支付、录音、直播、云存储等功能。旧开放域相关文件保留，当前排行榜流程不使用开放域，新构建的 `game.json` 不配置开放域入口。

## 验证

- `node tools/test-harmony-compatibility.cjs`：真实服务和 UI 代码配合 SDK 模拟，覆盖同步/IDE/异步识别、合并查询、未知系统、各页入口、服务层阻止调用、晚到结果、Android 恢复、广告/侧边栏/收藏/桌面能力保留。
- 另运行玩家信息、原生排行榜、订阅触摸、结算页、主页入口、激励/插屏、收藏、侧边栏及 TypeScript 回归。
- Cocos 字节跳动小游戏验证构建位于 `build/harmony-validation/douyin`。`build/harmony-validation/creator-build-stdout.log` 为构建日志，`compatibility-audit.json` 记录产物核对结果。构建完成不等于鸿蒙真机运行验收。

## 运行验收待办

本次 `douyinide` 可以读取账号状态，但 IDE 离线；执行一次 `start-ide` 后 60 秒内仍未连通，因此未执行鸿蒙模拟器或真机流程，没有上传或发布。需要使用可连接的新版开发工具和鸿蒙设备继续确认：启动与远程关卡加载、触摸/缩放/音频、七日签到、体力、完整激励/取消激励、插屏关闭、侧边栏回流、收藏和添加桌面，以及分享/订阅/排行榜入口均不出现。

开发工具下载：https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/dev-tools/developer-instrument/download/developer-instrument-update-and-download
