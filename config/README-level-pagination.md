# 关卡选择页分页（2026-11-04）

编辑入口：`assets/LobbySources/prefabs/LevelSelectScreen.prefab`，脚本：`assets/scripts/ui/LevelSelectScreen.ts`。

- 每页默认 8 关，沿用 List 的两列四行网格，不添加筛选功能。
- 只创建并请求当前页的封面；翻页或退出时释放上一页的图片引用，迟到的下载结果不能覆盖新页。
- 点击卡片使用章节内真实关卡索引，原有免费推关、视频跳关、星级和锁定展示规则保留。
- 每次进入章节，定位章节配置顺序中最靠前的未解锁关卡所在页；后面已视频解锁的关卡不影响优先级。
- 全部关卡都已解锁时，定位星级最低的关卡所在页，未游玩按 0 星，同星级取配置顺序更靠前的一关。全 3 星时回到第一页。
- 默认定位仅在进入章节时执行；手动翻页、解锁后的状态刷新不强制跳页。关卡数量变化时页码自动限制在有效范围内。
- `PageTitle_BG/Number` 显示本章已完成关卡数/总关卡数，优先使用组件的 `chapterProgress` 绑定。无绑定且没有对应 Label 时静默跳过。
- `Page/PageLaber` 显示当前页/总页数（保留原预制体节点拼写，也支持 `PageLabel`）。首页隐藏 `button_page_prev`，末页隐藏 `button_page_next`，只有一页时两个按钮都隐藏。空章节显示 `0/0`。
- 页码和翻页按钮有 Inspector 绑定，也支持按上述节点名查找。左右按钮复用已绑定的 `An_BtnClik_01`，由全局 `UIAnimationBinding` 在按下时播放。
- 布局尺寸、Widget、图片和动画资产保持预制体配置，List 不再添加 ScrollView、Content 或运行时适配。

验证：`node tools/test-level-pagination.cjs` 覆盖默认定位优先级、最低星级与同星级、缺少成绩、重新进入与切换章节、页数、末页、真实索引、状态与动画、可选文本、翻页后迟到的封面以及原网格容量。另运行关卡解锁、提示弹窗、页面图片生命周期和 TypeScript 检查。
