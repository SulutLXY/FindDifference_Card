# 双图贴纸：A静止、B独立叠加滚动

保留原SpriteUVScroll材质、Effect和组件的文件名与UUID，替换原来的单图滚动实现。

## 编辑器操作

1. 图A拖到Sprite的Sprite Frame，支持图集内图片。
2. Sprite的Custom Material绑定PleyGame/Materials/SpriteUVScroll.mtl，同一节点添加SpriteUVScroll组件。
3. 图B的独立图片texture子资源拖到组件Overlay Texture。也可在材质的Overlay Texture中设置，组件图片入口优先。
4. Speed只控制B：正X向右、正Y向上，负值反向，可同时设置形成斜向；单位为每秒B纹理周期。
5. Overlay Color控制B的RGB与颜色Alpha；Overlay Opacity独立控制0～1不透明度，与B图片自身Alpha相乘。它们不改变A的颜色。
6. Overlay Mode选择Tile平铺或Fill拉伸填充：Tile使用Tiling横纵重复次数；Fill将B单独拉伸填满精灵区域并忽略Tiling。两种模式均循环滚动。
7. Offset控制B初始偏移；Playing关闭暂停，重新打开继续；resetScroll()恢复初始偏移。
8. Clip To Base Alpha默认开启，B只覆盖A的轮廓并保留A的Alpha；关闭则按正常Alpha叠加，允许B出现在A的透明区域。

默认勾选Use Material Settings，直接使用材质面板的B贴图、颜色、透明度、速度、平铺和模式参数，调整材质会实时同步。关闭后使用组件参数。组件支持编辑器预览，通过渲染器的非序列化MaterialInstance隔离参数，预制体仍保存原材质资源引用，不会保存临时材质。

## 坐标和资源

A使用原SpriteFrame UV取样，始终静止。B使用独立Texture2D采样器，坐标来自节点本地几何位置和UITransform尺寸/锚点，不用A的图集UV推导。因此A切换图集/旋转打包、Simple/Sliced/Tiled/Filled模式不改变B的坐标规则；父级移动、缩放、旋转也会同步。

只在Sprite实际生成的几何区域内绘制。如果需要保留A透明留白的完整矩形，可关闭Sprite的Trim。B的图片边缘需要可平铺才能做到无接缝；填充明确为拉伸填满，不是等比裁剪。B未设置或透明度为0时保留A，Sprite自身颜色/透明度作用于最终合成图。

多精灵分别使用独立材质实例，互不修改共享资源。第二张纹理和独立材质会增加渲染成本，未做大量贴纸性能基准。资源仍在远程MainGameSources，没有绑定现有关卡图片或新增Loading引用。

## 验证

tools/test-sprite-uv-scroll.cjs覆盖双图入口、A静止、B颜色/透明度与模式参数、独立运动/暂停、父级变换/尺寸/锚点、图集及渲染模式独立性和资源释放。使用Cocos隔离构建检查实际Effect和材质导入。尚未使用用户指定的A/B素材完成实际画面与真机验证。

本次双图版本的类型检查和自动化测试通过；build/uv-scroll-2026-11-11/douyin隔离构建完成，双图Effect与材质已进入MainGameSources，首包依赖审计通过。

## 2026-11-11 密集重复修复

用户实际GameScreenBG为1000×2000、Sliced类型，绑定了该材质但未挂坐标同步组件，材质中BLocalBounds仍为2×2。此前把世界位置按2像素范围重复，导致500×1000倍密集纹理。已为这个背景补上组件，默认继承用户材质参数，保留B贴图BG_Fly01、颜色Alpha=57、速度1.45/1及A的Sprite属性；自动写入[-500,-1000,1000,2000]和节点实际逆矩阵。

内部坐标参数已从材质面板隐藏，不应手填。Shader新增坐标就绪保护，没有组件提供坐标时仅显示A，避免再次按默认世界像素密集采样。组件在编辑器执行，后添加材质也会自动初始化。

GameScreen.onLoad也检查当前背景材质：若使用SpriteUVScroll却缺少组件，自动补挂，以兼容此前保存的旧预制体。修复过程中发现背景预制体在编辑器中有新的保存，挂载操作按最新源文件补入，不覆盖其余设计参数；重新打开预制体时可看到组件。

使用实际Effect中的顶点/片段程序（补齐Cocos内置声明）和实际BG_Fly01，在Edge无界面WebGL2中完成编译、链接和像素绘制检查：复现2×2坐标的密集纹理，修复后仅绘制一次B；偏移后B改变，透明度为0时A的像素保持不变。结果截图位于temp/uv-scroll-2026-11-11/gpu-result.png。这是受控WebGL验证，未替代Creator编辑器实景和抖音真机验证。

## 脚本挂载标识修复

脚本UUID保持84d82e95-226d-4c50-adb8-a491a663cc99不变。之前误用22位资源UUID压缩值842C6VIm1MUK24pJGmY8yZ作为组件Class ID；Creator编辑器与预览实际注册的是23位84d826VIm1MUK24pJGmY8yZ。已将预制体改为实际注册值，避免Missing Script。自动化校验会比对实际editor/preview编译模块的_RF.push注册结果，防止只按错误编码规则自测。此修复不改材质和用户图片参数。
