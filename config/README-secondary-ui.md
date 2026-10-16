# 收藏与排行榜页面按需加载

主场景不再包含 Rank、Collect 页面树，GameFlow 的 rank/collect 场景绑定留空。
编辑页面请打开：

- `assets/SecondaryUI/prefabs/RankScreen.prefab`
- `assets/SecondaryUI/prefabs/CollectScreen.prefab`

首次打开时 GameFlow 加载 SecondaryUI Bundle，再创建对应页面。重复点击合并加载请求，
后续打开复用节点。加载失败保留原页面并提示重试；加载过程中切换页面，旧请求不会抢回显示。
抖音排行榜继续使用原生排行榜，不加载本地排行榜预制体。

页面关闭时释放动态封面，收藏翻页时释放上一页图片。页面节点、预制体及静态装饰在首次
加载后复用，GameFlow 销毁时释放持有的预制体引用。没有引入内存预算淘汰。

八张页面专用图片移到 `assets/SecondaryUI/textures`，保留原 .meta / UUID。
公共按钮、动画和头像池继续复用已有资源，避免破坏按路径加载。
图集、字体缓存和城市/选关页面拆分尚未包含在本次改动中。

SecondaryUI 复用现有远程资源包构建配置。抖音发布时，同次构建的 SecondaryUI 远程产物
需与城市包和 MainGameSources 一起部署；不要把预制体拖到主场景 Inspector 重新形成直接依赖。
Web/native 的包配置保持本地，页面仍按需实例化。

验证：

```
node tools/test-secondary-ui.cjs
node tools/test-page-sprite-lifetime.cjs
node tools/test-level-loading.cjs
```

编辑器/真机检查首次打开收藏和排行榜、返回再进入、收藏翻页、加载失败重试。
启动节点数量和依赖检查可由脚本验证，首屏耗时与内存收益需在重新构建后实测。
