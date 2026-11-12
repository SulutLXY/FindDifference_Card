# 打包后章节热度标签消失修复

## 已确认原因

`PlayStatsService.getCounts` 使用 `[...new Set(keys)]` 去重。Creator 的 loose 展开转译将其生成为 `[].concat(new Set(keys))`，结果数组内只有一个 Set 对象，不能按章节字符串查找初始值，最终返回空对象。

选关页最初赋值后又异步刷新，空结果将热度文本清空并关闭 HotNumber 节点。青花瓷使用独立的“最新章节”分支，因此仍显示。配置、图片和初始热度值均未丢失。

## 修复

- 去重改为 `Array.from(new Set(keys))`，避免 loose 转译误判。
- 选关页异步响应缺少某章节时回退配置中的初始热度，防止已有基准数被空响应清除。
- 统计测试增加 Creator 自带 Babel `plugin-transform-spread` 的 loose 转译步骤；使用真实配置验证五个章节的初始值、重复编号去重和未知编号忽略。
- 标签测试增加空响应时保留初始热度的断言。

## 实际模拟器证据

- 项目：`D:\CocosCreator\Projects\FindDifference\build\douying`，类型 microgame，窗口 ID 2。
- 使用 douyin-ide 技能只读调试，未执行编译、刷新、清缓存、导航或页面交互。
- 画面基线：`C:\Users\EDY\AppData\Local\Temp\1794474888345.png`，393×852，截图/CSS 比例均为1。
- 当前运行时 playStats._initial 正确包含219500、58750、103700、60880、358400；initialCount('wang-luo-re-dian') 返回219500；格式化返回219.5K。
- 同一窗口调用旧构建 getCounts 返回 `{}`；五个热度节点均 inactive 且文本为空，青花瓷仍为“最新章节”。同一构建的实际 JS 存在 `[].concat(new Set(t)).sort()`。
- 工具默认执行环境在外层页面；游戏运行时通过同窗口小游戏 frame 的 developerSandbox.global.System 读取，使用已经加载的 cc 模块定位场景组件。

## 验证与生效

`test-play-stats.cjs`（含 Creator loose 转译、实际初始配置及服务端/离线回归）、`test-hot-badge.cjs`、TypeScript 检查通过。

本次修复未修改热度图片、预制体、远程资源归属或统计配置，也没有修改本地构建产物。现有模拟器仍运行旧构建；需重新构建并发布新代码后生效。未完成新构建的模拟器画面或真机验证。
