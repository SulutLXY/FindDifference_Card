# Feed 更新检查与订阅奖励修复

检查基线：`6ef9793`（配置更新，同步更新Feed获客复访功能和配置），应用版本 `0.1.6.1`，资源版本 `0.1.6`。检查时工作区干净。

## 本次更新内容

- 配置 21 条复访方案：体力恢复、签到关联的离线收益及重要事件各 7 条；新增 20 条获客方案。
- 复访体力条件改用实际回满时间；签到方案根据实际可领取状态登记，成功领奖后更新到下一可领取日。
- 奖励发放后触发 Feed 就绪条件刷新，增加正在上传时的重调度标记。
- 同步应用/资源版本及抖音、Web 手机端构建配置；旧排行榜开放域脚本移至测试目录。

## 已修复的问题

1. **订阅奖励未实现。** 现有弹窗写着完成授权领取奖励，配图为提示灯泡×2；原代码仅授权和显示完成状态。现在首次确认全场景订阅成功自动领取免费提示×2，每份本地存档一次。已有订阅但没有领取记录的玩家在成功查询后补领。取消授权、查询失败和预览场景不发奖。库存不足两个空位或存储失败保留领取资格，可点击重试，不重复调起授权。库存和领取标记一并持久化，保存失败回滚。
2. **旧查询覆盖新授权。** 原平台服务允许较早发出的“未订阅”查询在授权成功后覆盖状态。现增加请求版本，过期结果不能修改状态，也不能作为奖励资格的查询成功依据。
3. **启动模板覆盖回归。** 本次提交将 `game.ejs` 恢复为引擎默认模板，删除了 Feed/侧边栏早期监听、资源版本迁移与启动计时，并重新加入额外画布倍乘。`game.json` 同时丢失 iOS 高性能配置。修复前 `test-feed.cjs` 因早期监听不存在失败，`test-douyin-performance.cjs` 因高性能配置缺失失败。已恢复原有启动逻辑，保留本次 Feed 配置、版本和排行榜调整。
4. 弹窗文案明确为“首次订阅领取免费提示×2”，主页入口说明同步更新，移除“Feed 尚未接入”的过期描述。

## 验证与限制

以下 13 个测试脚本通过：

`test-feed-subscription-reward.cjs`、`test-subscription-touch.cjs`、`test-lobby-entries.cjs`、`test-feed.cjs`、`test-douyin-performance.cjs`、`test-app-version.cjs`、`test-daily-sign-in.cjs`、`test-harmony-compatibility.cjs`、`test-douyin-rank.cjs`、`test-douyin-rank-renderer.cjs`、`test-retention.cjs`、`test-sidebar.cjs`、`test-level-clear-energy.cjs`。

TypeScript 检查通过：`tsc -p tools/tsconfig-hud-check.json --lib es2020,dom --pretty false`。

`test-money-tool.cjs` 未通过：脚本硬编码另一台电脑的 TypeScript 路径；临时替换加载路径后，旧测试传入的结算数据缺少 `level.differences`，无法继续。该测试还保留主页设置隐藏入口的旧预期，与当前需求不符。本次未改动它，不能宣称全仓测试全部通过。

本次未重新构建或上传版本，未验证手机抖音原生授权界面、平台后台开通情况和实际推荐流曝光。源码与预制体修改需重新构建并同步配套资源后才能在真机生效。原生订阅仍在 `tt.onTouchEnd` 内同步调用；奖励由游戏自行保存，不由订阅 API 自动发放。参见[抖音官方复访指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/feed/minigame-feedpush-setting-guide)。

## 仍需核实的提交内容

`tools/package-private-keys/2121957082088984577/package_1_e345e3b3bdc6.key` 随本次提交进入版本控制。仅确认文件位置及非 PEM 格式，没有展示其内容或确认其有效用途。应核实是否为实际打包私钥；若属有效私钥，应移至本机配置并检查仓库访问范围和更换需求。本次保留原文件和提交历史。
