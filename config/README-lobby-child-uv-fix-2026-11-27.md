# 首页动画子节点UV空引用修复（2026-11-27）

用户在抖音工具点击返回页面时遇到 `Cannot read properties of null (reading '0')`，调用栈为Sprite的`updateUVs → _flushAssembler → onEnable → UIScreen.open → GameFlow._switchTo`。

已定位到本轮首页动画10秒回收逻辑遗漏：实际`LobbyScreen/bg_showIcon`下还有动画控制的子Sprite `N_Cat_02_ (1)`。旧实现只恢复主Sprite的静态帧；清空动画剪辑并decRef后，其依赖子帧被销毁，而隐藏子Sprite仍指向它。重新启用页面时，引擎读到已被清空的UV数组。

现改为：初始化时保留动画区域全部Sprite的静态帧与启用状态，并分别持有引用；回收时先停止/移除动画、恢复所有主/子Sprite的静态帧，再归还动画和首帧引用；销毁时清空所有Sprite引用，再归还静态帧。首页10秒短时缓存、下载队列和其他页面回收策略保持原值。

`tools/test-lobby-animation.cjs`新增对子Sprite的动画赋帧和依赖销毁模拟，并执行本机Cocos 3.8.8真实`Simple.updateUVs`方法。旧源码以及当前旧抖音包`build/douying/assets/main/index.ca906.js`的实际回收方法均复现相同空UV报错；修复后的源码通过。同一用例也验证重新打开、回收后重新加载、静态帧恢复、销毁及迟到加载清理。

验证：

```text
node tools/test-lobby-animation.cjs
node tools/test-page-sprite-lifetime.cjs
node tools/test-resource-memory-policy.cjs
node tools/test-game-first-loading.cjs
node tools/test-ordered-asset-preloader.cjs
```

相关回归、TypeScript及diff检查通过。此次未改写已有抖音构建产物；需要重新构建并替换测试包，旧`index.ca906.js`仍含该缺陷。上述复现为实际旧发布方法与引擎UV代码的隔离回归，不等同于修复版已完成抖音模拟器/真机测试。截图中的目录已存在警告不是这一Sprite崩溃的触发路径。
