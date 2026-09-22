# 寻迹王国 / FindDifferenceUnity

Unity 2022.3.62f3c1 的独立 2D 工程。`Assets/FindDifference/Scenes/FindDifference.unity` 是可编辑的场景：大厅、选关、找茬、排行榜以及结算/广告弹窗均为 Canvas 下的真实对象。`GameFlow` 上只有一份控制器。编辑器菜单 **Find Difference → Rebuild editable scene** 可以根据编辑器脚本重新生成该场景；手工排版后不要随意重建，否则会覆盖场景中的手工修改。

`CocosSource/` 是迁移时的原 Cocos `assets`、`settings`、`docs` 和项目描述文件的只读参考副本；原始项目路径不变。`Assets/FindDifference/Resources/Levels` 存有 10 组图和差异点，首版界面只开放前 5 关。源项目第 2–10 关仍复用同一组示意差异点/部分画面，正式上线前需要逐关校验素材及点位。

当前可在 Unity 编辑器中 Play 验证五关选关、找茬、误点扣命、双图标记、放大、倒计时、失败/成功、顺序解锁和 H5 模拟激励广告。WebGL 浏览器分享通过 `Assets/Plugins/WebGL/WebShare.jslib` 使用 Web Share API 或复制链接。排行榜仅显示本机进度；真实排行榜、微信/抖音分享和真实激励广告必须接入各平台 Unity SDK、广告位 ID、App ID，并在真机上验收。模拟广告不可当作上线广告。

本机仅检测到 Android/Windows 构建模块。要导出普通 H5 WebGL，需要通过 Unity Hub 给 **2022.3.62f3c1** 增装 WebGL Build Support；微信/抖音小游戏还需分别使用官方 Unity 适配方案转换产物。这两个小游戏并不是直接上传网页 WebGL 构建。
