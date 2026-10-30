# 0.1.5.2 玩法规则修订提交备注（2026-10-30）

## 提交范围

- 初始体力与自然恢复上限由 10 调整至 15。低于 15 点开始每 8 分钟恢复 1 点，支持离线恢复；达到 15 点停止倒计时，额外体力保留，存储上限仍为 99。已有存档的体力不会重置。
- 取消每日观看激励视频补体力的次数限制。体力低于 15 点时可观看，完整观看增加 5 点；每日计数仅作记录。取消、播放失败或保存失败不发奖励。
- 取消每关提示和加时激励视频的次数限制。优先消耗库存，无库存时每次完整观看分别获得一次提示或增加 30 秒；按钮图标和教学文案同步更新。保留广告并发保护、存档失败回滚和换关后的奖励库存保护，H5 继续免广告使用辅助功能。
- 挑战失败隐藏“分享成绩”，成功时恢复显示，避免复用结算弹窗留下错误状态。
- 复活视频完整观看后恢复至 3 点生命，剩余时间至少为 30 秒，解除暂停并刷新 HUD。修正残留的“生命 +1”提示。每局仍只提供一次复活，复活不消耗体力。
- 一并提交工作区已有的 `assets/Bundle/levels/city-00-HotTips/level-02/scene-b.jpg` 图片更新，保留原 `.meta` 和 UUID。
- 同步规则说明，补充复活和分享按钮回归，更新旧的次数限制测试及侧边栏测试模拟接口。本次版本号保持 0.1.5.2。

## 验证

以下 13 个脚本及 TypeScript 检查通过，`git diff --check` 通过：

- `tools/test-energy-access.cjs`
- `tools/test-energy-navigation.cjs`
- `tools/test-energy-prefab.cjs`
- `tools/test-level-assists.cjs`
- `tools/test-assist-times.cjs`
- `tools/test-assist-tutorial-ads.cjs`
- `tools/test-h5-no-ads.cjs`
- `tools/test-sidebar.cjs`
- `tools/test-result-reward-entries.cjs`
- `tools/test-result-pulse.cjs`
- `tools/test-revive-reward.cjs`
- `tools/test-hud-redraw.cjs`
- `tools/test-app-version.cjs`

TypeScript 命令：`node D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript/bin/tsc -p tools/tsconfig-hud-check.json`。

覆盖 14→15 的恢复边界、10–14 点的倒计时和视频入口、同日多次补体力、单关多次提示/加时、广告取消/错误/重复点击、换关回调、生命耗尽或超时后的三点生命复活，以及成功/失败反复切换时分享按钮的显隐。

## 已有构建的 404 诊断记录

2026-10-29 通过 douyin-ide 读取 `build/douying` 对应窗口的请求与控制台，8 次失败请求均为：

`https://rewan-file.oss-cn-shenzhen.aliyuncs.com/games/mishi/ndzdk02/tt/0.1.4/remote/city-PetThreeKingdoms/config.1ff50.json`

OSS 返回 `404 / NoSuchKey`。本地同次构建的 `build/remote/city-PetThreeKingdoms/config.1ff50.json` 存在，代码包 `src/settings.cb98c.json` 也引用版本 `1ff50`，当时缺失的是服务器上的配套包配置。需将同次构建的整个专题包按原目录和文件名同步，不能用其他构建的配置或图片混配。

此项为诊断留档，不代表本次进行了 OSS 上传或确认补传结果；后续构建应以新的 settings 和文件哈希为准。本次提交检查未执行新的 Cocos 构建、平台上传或真机验收。
