# 侧边栏复访：首版接入

主界面 `Screens/Lobby/Gameflow` 为用户放置的入口锚点。`LobbyScreen` 打开时自动挂载 `SidebarGift`，生成临时福利按钮和引导弹窗；后续可替换美术。无需手动挂载额外组件。没有修改场景布局。

## 当前规则

- `tt.checkScene({ scene: 'sidebar' })` 返回 `isExist: true` 才展示入口；H5、微信、接口缺失或不支持时隐藏。
- 每天从首页侧边栏进入，可手动领取免费提示 ×2。数量在 `SidebarService.HINT_REWARD`。
- 北京时间零点刷新每日资格；次日必须重新从侧边栏进入。库存可累积。
- 领取状态和库存一起写入本地存档。存储失败不发奖、不扣道具；重复点击不会重复发奖。
- 关卡提示优先使用库存，库存为零时恢复现有激励视频流程。
- 当前是本机存档方案，不提供跨设备同步或服务器时间校验。

## 构建及事件

`build-templates/bytedance-mini-game/game.ejs` 以本机 Creator 3.8.8 官方模板为基础，在适配层及引擎加载前同步注册 `tt.onShow`。全局桥接缓存最新参数，场景创建后由 `SidebarService` 读取。

来源必须同时满足 `launch_from === 'homepage'` 和 `location === 'sidebar_card'`。普通返回会更新并清除旧资格；仅有 `scene=021036` 或跳转成功回调不会发奖。

需要重新构建抖音小游戏，启动模板才会进入新的 `game.js`。不要只替换脚本 Bundle 或继续验证旧构建目录。重新构建后可在 `game.js` 开头检查 `__findDifferenceSidebar`。

## 自动化验证

```powershell
node tools/test-sidebar.cjs
node D:/CocosCreator/v3.8.8/resources/app.asar.unpacked/node_modules/typescript/bin/tsc --noEmit --pretty false --lib ES2017,DOM
```

测试使用 SDK、Cocos UI 和存储替身，执行真实服务与组件代码，不操作玩家存档。覆盖早期冷启动事件、热启动来源更新、能力检测、失败与超时、跨天、重复领取、持久化失败、免费提示消耗与广告回退，以及福利弹窗完整状态流转。不能代替真机渲染和平台联调。

## 抖音开发者工具 / 真机验收

1. 重新构建并导入小游戏，支持侧边栏时，大厅左侧应出现“每日福利”。
2. 普通入口启动：打开福利，应显示“去首页侧边栏”；仅跳转成功不增加库存。
3. 从侧边栏点击本游戏返回：弹窗显示“领取奖励”，点击后库存 +2，再次点击不增加。
4. 完全退出后直接从侧边栏冷启动：未领取当天奖励时，可直接打开福利领取。
5. 从其他入口重新进入：未领取状态显示引导，不能误用以前的侧边栏参数领奖。
6. 进入关卡，提示按钮显示剩余次数，连续用完两次后走原有广告流程；退出重进库存仍正确。
7. 验证弹窗关闭、跳转失败、每日边界与不支持环境。当前 H5 不内置模拟领奖开关。

官方资料：
- https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/operation1/user-ops/-retention/sidebar
- https://partner.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/Introduction-for-tech
- https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/sidebar-capacity/tt-navigate-to-scene
