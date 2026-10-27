# 0.1.4.2 提交备注（2026-10-27）

## 本次提交内容

- 新增「萌宠三国」独立章节包 `city-PetThreeKingdoms`，按原素材目录 01–30 导入 30 关、325 个差异点、60 张玩法 JPG、30 张缩略图及章节封面，附完整唯一 UUID 元数据与来源 SHA-256 映射。
- 展示顺序为网络热点 → 2026热梗 → 宠物故事 → 萌宠三国 → 2025热梗 → 北京及后续城市。原「2025年度梗」仅调整显示名，章节 key、关卡与存档标识不变。全项目为 13 章/255 关。
- 新专题沿用当前公共体力、选关资格、EventTips 单关/整章视频解锁、免费推关及继续游戏规则，不增加独立规则字段。v2 老存档仍按原八城 120 关迁移。
- 一并保存现有 0.1.4.2 更新：选关入口视频图标显隐、固定按钮文案、章节页进入后请求插屏、返回主页插屏请求与日志、未展示原生插屏实例保留/复用、自动加载及回调型 SDK 兼容。
- 保存当前场景、体力显示预制体及版本同步改动；移除已不存在目录的遗留 `.meta`。版本配置、代码常量、启动模板及 package.json 均为 0.1.4.2，资源版本为 0.1.4。
- 新增或更新章节路径、排序、增量生成、插屏生命周期与导航回归。版本同步脚本允许尚未生成的平台 profile 缺失。

## 验证结果

- TypeScript 检查通过：`tsc -p tools/tsconfig-hud-check.json`。
- 专题与内容回归通过：`test-pet-three-kingdoms.cjs`、`test-2025-hotmeme.cjs`、`test-pet-story.cjs`、`test-city-resource-layout.cjs`、`test-city-renumber.cjs`、`test-chapter-rules.cjs`、`test-level-unlock.cjs`、`test-content-bundle-lifetime.cjs`、`test-page-sprite-lifetime.cjs`、`test-food-icons.cjs`、`test-event-tips.cjs`。
- 体力与广告回归通过：`test-energy-access.cjs`、`test-energy-navigation.cjs`、`test-interstitial.cjs`、`test-interstitial-native-lifecycle.cjs`、`test-navigation-interstitial.cjs`、`test-level-loading.cjs`。
- 版本一致性检查通过：`npm run test:version`。生成器 3 项测试通过：`python tools/test_manifest.py`。
- 主场景及全部预制体共 8 个序列化文件的对象引用有效；全 assets 主资源与子资源 UUID 无重复。
- 2650 个既有章节/封面/美食资源文件的字节与修改时间保持不变。用户要求改名的 2025 章节源清单仅替换 name 字符串。重复生成清单不改写内容未变的文件。
- `git diff --check` 通过。

## 已知问题与发布要求

- 生成器成功汇总全部章节，但仍因 32 项原素材坐标/半径问题返回非零：既有 31 项，加萌宠三国第 4 关 diff-5 的 y=-0.016129。未修改原标注，没有缺图或缺关卡配置。
- 复跑 `test-game-bundle-loading.cjs` 仍被已有主场景 PleyGame 资源引用断言阻断（Startup must not reference gameplay assets）；自动图集原图保留及跨包依赖问题按 `README-render-optimization.md`、`README-content-bundles.md` 的既有记录处理，不视为本次章节接入已修复。
- 未执行实际 Cocos 构建、服务器部署、平台上传或真机验收。脚本中的原生广告为 SDK 行为模拟，真实展示仍取决于抖音原生频控、填充及回调。
- 发布前重新构建主包、chapter-covers、新章节包；2025 专题源清单因改名会有对应增量。用同一次构建的远程产物先部署，再更新代码包，保留旧版本资源。仅更新第四位版本不会触发资源缓存全清，资源寻址依赖实际构建哈希。

专题详细映射与标注记录见 [pet-three-kingdoms-resource-audit-2026-10-27.md](pet-three-kingdoms-resource-audit-2026-10-27.md)；广告行为与真机验收步骤见 [README-energy-and-entry.md](README-energy-and-entry.md)。
