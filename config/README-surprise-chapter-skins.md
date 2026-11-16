# 惊喜气泡的章节外观

每章使用同一套抽取、飞行、点击和领奖逻辑，仅通过预设调整背景图片、大小和内部位置。没有章节专属预设时继续使用通用版本。

## 在 Creator 中制作

1. 复制通用预设 `assets/PleyGame/prefabs/Item_Tips_surprise.prefab` 到目标章节的 `prefabs/` 目录，保留名称 `Item_Tips_surprise.prefab`。请在 Creator 资源管理器内复制，以生成独立的资源 UUID；不要把原 `.meta` 一起直接复制。
2. 例如青花瓷使用 `assets/Bundle/levels/qing-hua-ci/prefabs/Item_Tips_surprise.prefab`，萌宠三国使用 `assets/Bundle/levels/meng-chong-san-guo/prefabs/Item_Tips_surprise.prefab`。其他章节同理；恋爱美食下各城市按各自的章节包（如 `bei-jing`、`shang-hai`）查找。
3. 双击该章预设，更换背景 Sprite 的图片，调整图标、数量、视频标识和点击框的局部位置。背景素材和该章专用图片放在同一个章节包内，避免依赖其他章节包。
4. 根节点必须有 `UITransform`，以下节点名称和直接子节点关系保留：`icon_Time`（Sprite）、`Number`（Label）、`icon_videoplay`、`ClikBox`（UITransform）。`ClikBox` 应覆盖实际可点击的气泡区域；位置、大小可在预设中调整。
5. 根节点的位置由程序控制飞行轨迹，在编辑器移动根节点不能改变运行时的气泡内部布局。若需单独偏移背景图，将背景 Sprite 放在一个 `Background` 子节点上，再调整它的位置；程序不依赖根节点上的 Sprite。其他上述四个功能节点仍保留为根节点的直接子节点。
6. 修改后重新构建代码包和配套章节资源；上传同次构建的 remote 资源后再更新代码包。未配置章节仍使用通用气泡。

## 已建立的章节预设

以下三份预设已从通用模板独立复制，资源 UUID 各自独立，当前背景、布局及点击区域均沿用通用表现，可以在 Creator 中直接编辑：

| 章节 | 预设路径 |
| --- | --- |
| 萌宠三国 | `assets/Bundle/levels/meng-chong-san-guo/prefabs/Item_Tips_surprise.prefab` |
| 青花瓷 | `assets/Bundle/levels/qing-hua-ci/prefabs/Item_Tips_surprise.prefab` |
| 年度热梗 | `assets/Bundle/levels/nian-du-re-geng/prefabs/Item_Tips_surprise.prefab` |

在各自预设内保存或应用美术调整即可，运行时会自动选用该章节版本，不需要再把它拖到 GameScreen 上或修改脚本。其他章节继续使用通用预设。

## 运行规则

- 按实际进入关卡的章节包查询 `prefabs/Item_Tips_surprise`。缺少专属预设或加载失败时使用通用预设。
- 同章下一关复用已加载的预设；切章会释放上一章预设引用，并载入新章样式。切章或销毁后迟到的加载结果会释放，不会覆盖当前章节。
- 背景 SpriteFrame、预设尺寸及子节点位置由美术预设决定，程序不覆盖这些布局。提示/生命图标仍沿用公共奖励图标；加时使用预设内 `icon_Time` 原图，数量和视频标识由同一领奖逻辑控制。
- 出现时机、概率、每局次数、飞行时长、按住暂停、ClikBox 命中和奖励规则不随章节皮肤改变。

验证：`node tools/test-surprise-chapter-skins.cjs`、`node tools/test-surprise-assist.cjs`，以及 TypeScript 检查。
