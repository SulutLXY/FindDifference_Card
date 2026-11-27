# 抖音构建兼容性复核（2026-11-27）

后续缺陷补充：旧回归未覆盖首页动画的子Sprite，用户随后报告空UV崩溃。已用下述旧发布包复现，源码已修复，详见 `README-lobby-child-uv-fix-2026-11-27.md`。因此本文保留为当时的局部兼容性检查记录，不能视为该旧包整体无缺陷；旧包需要重新构建替换。

核对对象为用户当天12:48完成的现有抖音构建 `build/douying`，未覆盖该构建。本轮尝试的独立CLI构建没有产生日志或产物，因此不计作成功重构建；验证改为直接读取已有实际发布脚本。构建配置和编辑器连接配置与复核前一致。

实际脚本：`build/douying/assets/main/index.ca906.js`。

SHA-256：`ade146a56225ea0ebfb09a8799f0b9d2438bcb65d4c21a8408e4eae4bce924d1`。

该脚本已包含两轮下载、两路并发、限定资源插队、当前关卡两图提前准备、首页动画10秒回收、低频页面30秒回收、通用音乐缓存上限和章节音效版本隔离。

## 已验证

- 把该发布包中的真实方法及同包Babel转译辅助代码载入隔离测试环境，验证下载队列、内存策略、首页动画的同步释放/定时回收路径。测试不替代完整Cocos/抖音运行时。
- 两路上限、已发请求收尾、限定资源插队后恢复原顺序、两轮去重、页面继续下载、回收与迟到回调测试通过。
- 音效缓存清理、旧音效请求成功/失败不污染新缓存、通用长音乐额外缓存1首、页面隐藏超时及下一帧预设释放测试通过。
- 实际抖音发布代码中的青花瓷13个、三国11个专属音效变体加载/播放路径通过。
- 当前构建引用的20个远程Bundle配置均返回HTTP 200，且下载内容SHA-256均与本地对应构建清单相同。只验证清单，不据此宣称全部远程文件均已逐个下载验证。

复现命令（PowerShell）：

```powershell
$env:FD_BUILT_MEMORY_JS='build/douying/assets/main/index.ca906.js'
node tools/test-resource-memory-policy.cjs
$env:FD_BUILT_PREFETCH_JS='build/douying/assets/main/index.ca906.js'
node tools/test-ordered-asset-preloader.cjs
$env:FD_BUILT_HERO_JS='build/douying/assets/main/index.ca906.js'
node tools/test-lobby-animation.cjs
node tools/test-built-chapter-audio.cjs build/douying
```

CDN清单读取结果保存在本地 `temp/douyin-compatibility-2026-11-27/cdn-manifests.json`。

## 验证边界

使用 `douyin-ide` 检查及启动开发者工具，工具启动后60秒内未能连接，因此没有取得本轮模拟器窗口、画面或运行时探针，未进行模拟器或手机实测。不能把上述函数回归描述为手机已跑通，也没有实测冷下载速度和进程/GPU峰值。

结论：当前抖音构建包含改动，发布转译后的关键逻辑测试及20个CDN清单匹配检查通过；未发现本轮改动依赖仅网页可用的API。完整手机行为和性能仍需在该包上验证。
