# 章节箭头点击与父卡片按压动画冲突

## 排查结果

`CitySelectScreen._fillCard` 中的 Cityaim 点击绑定没有丢失，当前打包代码中也存在。箭头未绑定独立 Animation，全局 UIAnimationBinding 在捕获按下事件时向父节点查找点击动画，最终播放整张 CityCard 的 An_BtnClik_01。

实际预制体箭头相对卡片中心的X为305.067、宽度32；实际点击动画最低缩放约0.8。动画将箭头中心向内移动约61个设计单位，超过箭头半宽。按压过程中，原本命中箭头的固定位置可以变成箭头外部，松手时被引擎取消而收不到TOUCH_END。快速点下立即松开则可能正常导航，表现为时好时坏。

## 修复

全局按压动画查找现在以独立TOUCH_END交互节点为边界：该节点有自己的点击动画则播放；没有则不继续缩放祖先。章节箭头因此保持命中区域稳定。卡片其他区域继续播放原来的整卡动画，翻页按钮及收藏页签已有的独立动画继续有效。

未改变箭头尺寸、美术、预制体结构或章节解锁规则。箭头仍通过原有enterChapterSelection进入专题，城市子章节的既有视频解锁校验保留。

## 验证

- `test-chapter-arrow-hit.cjs`读取实际预制体与动画曲线，重现原卡片缩放导致固定点击点移出箭头；验证修复后的箭头中心/边缘/嵌套子图不触发祖先缩放，卡片其他区域与独立箭头动画保留。
- `test-topic-hierarchy.cjs`验证专题箭头、城市箭头和解锁按钮仍使用对应进入逻辑，防止冒泡重复处理。
- `test-level-pagination.cjs`、`test-collection.cjs`及TypeScript检查通过。

## 模拟器证据与边界

- douyin-ide技能；项目类型microgame，路径`D:\CocosCreator\Projects\FindDifference\build\douying`。
- 原窗口2关闭后重新锚定打开窗口3，未执行构建或编译；窗口3随后也关闭，未继续复用失效ID。
- 窗口3操作前截图`C:\Users\EDY\AppData\Local\Temp\1794475656447.png`，393×852、截图/CSS比例1。通过现有GameFlow.showCitySelect打开章节页，状态探针确认cityActive=true、6张卡片。
- 点击年度热梗箭头：图片坐标(356,481)，CSS坐标(356,481)。真实快捷点击收到Cityaim的touch-start/touch-end，随后cityActive=false、levelActive=true、currentCity=nian-du-re-geng，证明旧构建已包含事件和导航绑定。
- 点击后截图`C:\Users\EDY\AppData\Local\Temp\1794475677874.png`仍处于加载画面，因此只确认导航已触发，未据此声称最终章节页面视觉验收通过。
- 窗口在尝试补充按压动画运行时采样前已关闭，未完成实际按住后松手的模拟器验证；缩放与命中冲突由上述真实资源几何回归测试覆盖。
- 未修改打包目录或远程素材；源码修复需要重新构建后生效，尚未完成新构建或真机验收。
