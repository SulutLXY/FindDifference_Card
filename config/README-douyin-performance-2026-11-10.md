# 抖音性能优化与 iOS 高性能模式（2026-11-10）

本次完成配置及代码调整，版本保持 0.1.5.2。后续已完成实际Creator构建及开发工具模拟器验证，启动资源边界以[Loading首包与远程玩法](README-loading-only-2026-11-10.md)为准。未上传、未进行iOS真机性能测试，不能将模拟器验证解释为高性能模式实际帧率提升。

## 高性能模式

- `build-templates/bytedance-mini-game/game.json` 增加 `enableIOSHighPerformanceMode: true`。下次抖音构建使用该模板；历史构建目录没有改写。
- 这是 iOS 普通小游戏的高性能模式，不是高性能+模式。官方要求抖音 >=31.6.0、基础库 >=3.43.0、iOS >=14.5；不满足要求时平台使用普通模式。Android/Harmony 不以该开关作为性能能力判定。
- 启动模板、自定义资源版本脚本及生成的版本脚本显式启用严格模式。版本同步工具也保留声明，避免下次更新版本时丢失。TypeScript 业务模块继续使用现有严格检查。
- 项目使用 Cocos Creator 3.8.8，已高于官方所述 3.8.3 的 iOS 旧系统绘制问题修复版本，不额外修改引擎代码。当前业务未发现麦克风、相机、检测器或 WebGL 视频播放 API 调用。

## 渲染与运行开销

- 移除抖音 `game.ejs` 在 DPR>=2 时将 Canvas 宽高再乘2的代码。Cocos 3.8.8 的小游戏 `screenAdapter.windowSize` 已读取设备像素比，渲染分辨率由引擎管理。保留原始方向修正、设计分辨率、页面缩放、弹窗和输入坐标逻辑，不设置新的画质档位或强制降帧。
- `TouchPointEffect` 使用最多8个节点的对象池，播放完隐藏回收，关闭时取消计时并回收，销毁组件时统一销毁。复用时重播并采样动画首帧，保留预设尺寸与点击坐标。快速点击超过8个并发效果时仅跳过新增视觉效果，不拦截按钮事件或点击音效；慢速下载时只保留最近8个待显示坐标。
- 点击效果层只有缩放发生变化时才调用 `setScale`，避免每帧反复标记变换更新。
- 检查当前全部资产的场景/预制体/动画及业务脚本后，裁剪无引用的 `video`、`webview`、`websocket`、`particle-2d` 引擎模块，同时更新 cache 和 includeModules。保留 animation、audio、graphics、UI、tween 及 profiler。平台激励视频通过 `tt.createRewardedVideoAd` 使用，不依赖 Cocos VideoPlayer 模块。
- 既有当前章节加载、8秒后主页静态预热、页面图片与关卡图片引用释放策略不变。PNG压缩文件体积与运行内存分开评估，不因文件变小而宣称纹理内存同比减少。

## 本地诊断

抖音启动时提供 `globalThis.__findDifferencePerformance`：

- `isIOSHighPerformanceMode`：按官方 `GameGlobal.isIOSHighPerformanceMode === true` 读取实际模式，不以配置开启当作真机已生效。
- `stages`：记录 `script-start`、`engine-ready`、`scene-started`、`level-prepared`、`playable` 各阶段首次到达的毫秒数，每阶段只记录一次。
- 日志以 `[Performance]` 开头，包含累计耗时、实际运行模式和当时的 Canvas 宽高。不存在 GameGlobal 的普通环境也可启动。
- 计时起点是 game.js 开始执行，不包含平台准备、首包下载和解压时间，也不是平台完整冷启动TTI。`scene-started` 表示引擎场景启动完成，不能当作玩法资产已下载；`level-prepared` 表示关卡已准备，`playable` 只在真实进入并解除加载遮罩后记录。Feed预览仅准备关卡，不提前记录真实进关点。
- 只存储本进程内的少量阶段记录，不额外发网络请求、写存档或修改现有 Feed 的 `reportScene(7001)` 上报语义。

## 验证与后续真机验收

已通过：

- `node tools/test-douyin-performance.cjs`：真实 EJS 模板渲染/语法/严格模式，普通及高性能运行标志，DPR 1/2/3 不重复放大，阶段只记一次，缓存提交及早到Feed事件保留，无引用模块扫描。
- `node tools/test-touch-point-effect.cjs`：点击坐标、缩放、异步加载、事件去重、对象池上限、动画首帧重置、关闭重开和销毁。
- 既有 Feed、侧边栏、版本缓存迁移、进关加载、首屏延迟主页加载、同章节预下载、鸿蒙兼容测试。
- TypeScript：`node D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript/bin/tsc --noEmit --pretty false --lib ES2020,DOM`。

下次构建时检查最终 `game.json` 保留高性能标志，确认引擎模块裁剪生效。随后在真实 iPhone 上关闭“局域网快速预览”，检查日志中的实际模式；使用普通模式对照包及 Android 设备对照启动、点击、放大、广告、Feed预览/退出、切后台恢复等行为。官方说明高性能模式暂不支持 IDE 真机调试，不能以该调试环境的性能数据作为高性能模式实测。

实测至少覆盖冷启动与热启动、连续闯关、收藏翻页与回主页、激励广告前后，记录首屏可交互耗时、FPS/卡顿和内存峰值。iOS高性能模式应测对应游戏 WebContent 进程；官方建议平均内存不超过800MB、峰值不超过1.1GB，这些是风险参考，不是本项目可以接近的优化目标。未实测前不承诺提升比例。

官方资料：

- [高性能模式](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/performance-optimization-both/performance-optimization/high-performance-mode)
- [性能优化指引](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/performance-optimization-both/performance-optimization/performance-optimization-guide)
- [运行性能优化指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/performance-optimization-both/performance-optimization/runtime-performance/performance-optimization)
