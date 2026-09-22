找茬游戏 Cocos Creator 3.8.8 工程
=====================================

项目路径：D:\CocosCreator\Projects\FindDifference

## 阶段 B 重构说明（当前）

UI 已从「纯代码生成」重构为「场景拼装 + 组件绑定」架构：

- 场景 `assets/scene/game.scene` 中预置了全部界面节点与组件，由人工在编辑器中拼接美术
- `GameManager.ts` 已移除，逻辑拆分为 `GameFlow`（全局流程）+ `ui/` 下四个界面组件
- 组件与节点的对应关系通过「命名规则」自动查找，也可在 Inspector 手动拖拽覆盖
- 阶段 A 的原版文件备份在 `temp/ui-refactor-backup/`

## 如何打开

1. 如果 Cocos Creator 正在运行，请先**完全关闭**
2. 双击运行 D:\CocosCreator\v3.8.8\CocosCreator.exe
3. 打开项目 D:\CocosCreator\Projects\FindDifference，等待导入完成
4. 双击 assets/scene/game.scene 打开场景
5. 点击编辑器上方「预览」按钮在浏览器中试玩

> 新增脚本或配置后若编辑器没有立即刷新，请关闭并重新打开项目。

## 架构总览

```text
Canvas
├── Camera
├── GameFlow            # GameFlow.ts —— 全局流程状态机（唯一实例）
├── Screens             # 界面容器（所有屏幕根节点放这里）
│   ├── Lobby           # LobbyScreen.ts —— 大厅
│   ├── LevelSelect     # LevelSelectScreen.ts —— 选关
│   └── Game            # GameScreen.ts —— 对局
└── ResultModal         # ResultModal.ts —— 结算弹窗（顶层，独立于 Screens）
```

职责划分：

- **GameFlow**：加载配置、持有存档/平台服务、对局状态（时间/生命/已找到）、
  界面切换、倒计时、激励视频（含 H5 模拟）、Toast。界面组件通过 `GameFlow.instance` 访问。
- **界面组件（继承 UIScreen）**：只做两件事——`onLoad` 里给按钮接线，
  `onOpen` 里刷新本界面的动态内容。不持有跨界面状态。
- **判定与数据**：`gameplay/DifferenceController.ts`（0–1 归一化命中判定）、
  `core/GameTypes.ts`（类型）、`services/`（存档与平台门面），均未改动。

## 节点命名规则与绑定对照表

通用约定：

- 节点一律 **PascalCase**，名字即契约；组件属性未拖拽绑定时，按下列名字在自身子树自动查找
- 在 Inspector 拖拽绑定优先于命名查找（两者都支持，推荐拼接完成后统一检查一遍属性面板）
- Label 类节点需要挂 `cc.Label` 组件；按钮类节点只需 `cc.UITransform`（响应点击区域）
- 屏幕根节点尺寸已设为 750×1334（设计分辨率），子节点坐标以屏幕中心为原点

### Screens/Lobby —— LobbyScreen

| 节点名 | 组件属性 | 类型 | 说明 |
| --- | --- | --- | --- |
| BtnStart | btnStart | Node | 开始挑战（进入最新解锁关） |
| BtnLevels | btnLevels | Node | 选择关卡 |
| BtnRank | btnRank | Node | 排行榜占位，点击弹 Toast |
| Title | title | Label | 游戏标题（可选） |
| Subtitle | subtitle | Label | 副标题（可选） |
| FooterEnv | footerEnv | Label | 底部环境信息，运行时自动刷新 |

### Screens/LevelSelect —— LevelSelectScreen

| 节点名 | 组件属性 | 类型 | 说明 |
| --- | --- | --- | --- |
| BtnBack | btnBack | Node | 返回大厅 |
| List | listRoot | Node | 关卡卡片容器（可选，缺省时卡片挂根节点） |
| CardTemplate | cardTemplate | Node | 卡片模板（可选，做成 Prefab 后拖入） |

CardTemplate 的子节点（模板卡片用，内置降级卡片不需要）：

| 节点名 | 类型 | 运行时填充内容 |
| --- | --- | --- |
| CardNumber | Label | 关卡序号 |
| CardName | Label | 关卡名 / 「尚未解锁」 |
| CardDetail | Label | 星级、时限、差异数 / 解锁条件 |

未设置 CardTemplate 时，选关界面用内置简易卡片（Graphics 绘制），流程可直接跑。

### Screens/Game —— GameScreen

| 节点名 | 组件属性 | 类型 | 说明 |
| --- | --- | --- | --- |
| BtnBack | btnBack | Node | 返回选关 |
| BtnHint | btnHint | Node | 提示（看广告） |
| BtnAddTime | btnAddTime | Node | 加时 +30 秒（看广告） |
| BtnShare | btnShare | Node | 分享 |
| TopImage | topImage | Node | 上图。**UITransform 尺寸即判定区域**；Sprite 缺失时自动补 |
| BottomImage | bottomImage | Node | 下图，同上 |
| LevelTitle | levelTitle | Label | 顶部「第N关」 |
| LevelName | levelName | Label | 关卡名标牌 |
| Lives | livesLabel | Label | 生命（♥♥♥ 运行时刷新） |
| Timer | timerLabel | Label | 倒计时 m:ss（≤10 秒变红） |
| Progress | progressLabel | Label | 差异进度 ●●○○ 2/8 |

命中判定使用 TopImage/BottomImage 的 UITransform 实际显示尺寸与关卡配置里的
0–1 归一化坐标，美术怎么缩放、挪位置都不影响判定正确性。

### ResultModal —— ResultModal

| 节点名 | 组件属性 | 类型 | 说明 |
| --- | --- | --- | --- |
| Title | titleLabel | Label | 「挑战成功！」/「挑战失败」，颜色随结果切换 |
| Summary | summaryLabel | Label | 星级与用时摘要 |
| BtnRevive | btnRevive | Node | 看广告复活（仅首次失败显示） |
| BtnPrimary | btnPrimary | Node | 主按钮，文案自动切换「下一关 / 再玩一次」 |
| BtnHome | btnHome | Node | 返回选关 |
| BtnShare | btnShare | Node | 分享成绩 |

## 拼接步骤建议

1. 打开 game.scene，展开 Screens，能看到 Lobby / LevelSelect / Game 三个空壳屏幕
   （Lobby 默认激活便于编辑，其余在层级管理器中点开眼睛即可编辑）
2. 按上面的对照表创建子节点、挂 Label/Sprite，摆上阶段 B 切好的贴图
   （assets/resources/textures/ 下已有 top_status_bar、bottom_ui_area、
   btn_hint、btn_add_time、btn_return、heart_lives、timer、title_level、
   icon_share、question_marks 等）
3. 每个屏幕根节点已挂对应组件；属性面板里可把节点拖进属性做显式绑定
   （不拖也能跑，靠命名自动查找；拼完后建议统一拖一遍，防止重名）
4. TopImage / BottomImage 节点务必给 UITransform 设成图片显示框的实际大小
5. 拼接期间可随时点预览：未拼的界面会有 warn 日志提示缺哪个节点，但游戏流程可跑

## 项目结构

- assets/scene/game.scene —— 主场景（UI 节点在此拼装）
- assets/scripts/GameFlow.ts —— 全局流程状态机
- assets/scripts/ui/ —— UIScreen 基类 + 四个界面组件
- assets/scripts/core/ —— 数据类型（GameTypes.ts）
- assets/scripts/gameplay/ —— 分辨率无关的差异判定（DifferenceController.ts）
- assets/scripts/services/ —— 存档（SaveService）与平台门面（PlatformService）
- assets/resources/configs/levels.json —— 五关配置（坐标为 0–1 归一化）
- assets/resources/configs/platform-config.json —— 广告、分享、CDN 接口配置
- assets/resources/textures/ —— 游戏图片与 UI 素材
- docs/DEVELOPMENT_PLAN.md —— 总体开发方案
- docs/LEVEL_01_ROYAL_COURTYARD.md —— 第 1 关设计文档
- docs/visuals/stage-b-ui-concept-v1.png —— 阶段 B UI 视觉概念稿
- tools/slice-level-01.ps1 —— 关卡素材切图脚本

## 已实现功能

- 首页、选关、五关解锁流程（阶段 A 逻辑，原样保留）
- 星级、最佳用时和解锁进度本地存档
- 上下两张场景图等比显示、同步标记、归一化命中判定
- 倒计时、生命、提示、加时、错误反馈
- H5 倒计时模拟广告与广告复活
- 微信/抖音激励视频和分享适配接口
- 通关/失败结算、下一关、重玩与分享入口

## 发布到微信/抖音小游戏

1. 编辑器顶部菜单「项目 -> 构建发布」
2. 目标平台：微信小游戏 / 抖音小游戏
3. 配置 AppID、游戏名称、启动场景为 game.scene
4. 构建后用对应平台开发者工具打开构建目录并上传

## 注意事项

- 第一次打开时 Cocos Creator 会自动为图片生成 .meta 文件和 SpriteFrame，可能需要等待几秒
- 本工程所有 UI 图片均为从参考截图中提取的素材，仅供学习参考，请勿直接商用
