# 新版结算页与复活

使用用户编辑的 `assets/PleyGame/prefabs/ResultModal.prefab`，运行时保留布局、图片、颜色和静态按钮文案。

- 清空 `Title`、`Summary` 的旧文本占位，避免旧标题/用时摘要叠加在新设计上。
- 成功只显示 `Title/WIN`；失败只显示 `Title/Lose`，其中 `Number` 为总差异数减已找到数。
- 失败原因由 GameFlow 传入：`time` 显示“时间到”，`lives` 显示“生命耗尽”。仍可复活时说明“复活可保留游玩进度”；用完本局机会时明确提示。
- 数据条 `level_card_selected/icon_fangda` 始终显示实际找到数/总数，成功标题为“找到”，失败为“已找到”。
- `level_card_selected/icon_Time` 成功显示“用时”和实际累计用时 `MM:SS`，失败显示“复活增加”和 `30秒`；次数已用完则显示“复活已用完”和 `—`，同步隐藏复活按钮。
- 原有星级评分与星星入场动画保留；成败均显示 `Summary`，只清空其旧文字。失败显示三颗灰星并播放原动画，成功按评级显示金星。分享按钮仅成功显示，保留平台能力判定。
- 主按钮按实际情况显示“下一关/再玩一次”；主页、分享、复活和关闭入口沿用现有操作，复活按钮保留呼吸动效。

复活每局一次，完整看完激励视频才生效；网页版仍为免广告。生命恢复至3点，时间统一为 **原剩余时间 + 30秒**（下限从0起算），两种失败原因均适用。例如生命耗尽时剩80秒，复活后110秒；时间耗尽时复活后30秒。保留已找到差异和累计游戏用时，不额外扣体力，清除连击并恢复游戏。取消/失败的视频不消耗机会，重复复活不会再次增加时间。

增加时长由 `GameFlow.reviveBonusSeconds` 统一提供给结算展示和实际奖励。

验证：`node tools/test-result-details.cjs`、`node tools/test-revive-reward.cjs`、`node tools/test-result-pulse.cjs`、`node tools/test-result-reward-entries.cjs` 及 TypeScript 检查。测试覆盖实际预制体节点、成败重复打开、找到数量、原因和时间赋值、次数耗尽、广告完成/取消/失败、进度保留与每局一次。未进行真机界面验证。
