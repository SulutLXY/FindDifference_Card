# UI 绘制优化

## 自动图集

新增五个 `.pac` 配置。保留原图片、SpriteFrame 的 UUID 和加载路径，构建器负责生成共享纹理并重写构建产物内的引用。

| 配置 | 目录 | 独立抖音构建验证结果 |
| --- | --- | --- |
| UIIcons | resources/textures/UI_Sprite/V3/icons | 26 张 → 254×657 |
| UIPanels | resources/textures/UI_Sprite/V3/panels | 15 张 → 216×510 |
| UIButtons | resources/textures/UI_Sprite/V3/buttons | 9 张 → 244×319 |
| GameIcons | PleyGame/Texture/icons | 9 张 → 125×234 |
| SecondaryIcons | SecondaryUI/textures | 8 张 → 252×328 |

尺寸来自 `build/render-optimization/douyin` 的实际 PNG，不是预估。图片变化后尺寸可能变化。大背景、关卡图片和连击图片未加入这些图集。

开启 `packAutoAtlas` 后构建才能生效；编辑器预览不能用于判断静态图集合批收益。Cocos 自动图集说明：https://docs.cocos.com/creator/3.8/manual/zh/asset/auto-atlas.html

`filterUnused` 保持关闭，保留按字符串动态加载的素材；不强制删除独立 ImageAsset/Texture2D，兼容现有加载方式。因此合图不代表所有原始图片都从构建包消失，也不代表下载体积必然减少。

图集按现有目录配置；构建器仍可能把跨包共用纹理放到依赖包。例如这次 GameIcons 的共享纹理位于本地 main，SecondaryIcons 位于远程 SecondaryUI。不要手动搬动生成文件。

## 红圈与选关列表

- 上、下图各使用一个 Graphics 绘制全部已找到的红圈；每个差异仍保留独立节点和半径数据，供通关波浪动画控制。
- 静止时不重绘；动画更新标记脏状态，每帧最多重绘一次。退出关卡停止标记 Tween 并清理两个绘制层。
- 选关卡片离开可视窗口后关闭原本启用的渲染与遮罩组件，回来时恢复。卡片节点保持 active，完整列表布局不变。

## 验证与发布

```powershell
node tools/test-render-batching.cjs
node tools/verify-ui-atlases.cjs build/render-optimization/douyin
```

第二条命令核对五个图集是否真实存在、原目录全部图片是否进入清单，以及共享纹理是否包含在构建包中。可以传入其他构建目录复查。

已通过 TypeScript 检查、标记动画/清理/滚动裁剪测试、HUD/连击/页面图片生命周期回归及一次独立抖音构建。尚未采样运行时总 Draw Call；纹理一致仍可能被材质、文字、遮罩和绘制顺序打断合批。

验证构建没有上传服务器。正式发布仍需重新构建，按 README-app-version.md 更新资源版本并同步同次构建的完整配套远程资源，避免远程 config 404。
