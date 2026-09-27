# 抖音小游戏联调问题排查记录（2026-09-27）

## 问题现象

抖音开发者工具（v4.5.6）运行 Cocos 3.8.8 构建产物时：

- 控制台循环刷屏 `file assets/resources/native/xx/<uuid>.webp does not exist!`
- 模拟器卡在 Cocos 启动 logo 不动
- 真机预览扫码同样卡住
- 每次报错的 uuid 不同，但**文件确认存在于构建产物中**

## 排查结论（证据链完整）

**根因判定：抖音开发者工具 4.5.6 自身文件服务层 bug，与项目资源无关。**

已排除的因素（逐项验证过）：

| 假设 | 验证方式 | 结果 |
|---|---|---|
| 资源丢失 | ls 直查 7 个报错 uuid 的磁盘文件 | **全部存在**（四次不同批次） |
| 场景/引用错误 | 全项目引用扫描（场景 uuid 引用 + 代码/配置路径） | 场景零失效引用；仅代码 2 处失效路径已修复（icon_clock→icon_Time、icon_daily→icon_LevelSelect） |
| 构建产物不完整 | config 清单对照 + 全量 webp 体检（134 个全部真 webp、零 0 字节） | 产物完整 |
| 包体超限导致加载截断 | 挪走全部关卡资源（-3.6M）构建 1.3M 精简对照包 `build\bytedance-test` | **报错照旧** |
| 工具缓存/索引过期 | 全新目录 + 完全退出工具重开 + Lite 模式 | 均无效 |
| urlCheck 域名拦截 | project.config.json 关 urlCheck | 无效 |

## 包体瘦身进展（独立的真问题，仍需完成）

主包上限 4M，当前 release 约 5.7M。已完成：

- 3D 物理 Bullet 裁剪：-1.4M（overwriteProjectSettings physics: builtin）
- 删除误打进包的 `level-03.7z` 备份文件：-472K
- WebP 全量规范化（8 张 PNG 转 WebP + 17 张伪装 WebP 原地转码）

待完成：

- [ ] **升级抖音开发者工具到官网最新版**（明天第一件事，4.5.6 是旧版）
- [ ] 功能裁切：视频/WebView/2D 粒子/Tiled/Spine/DragonBones/骨骼动画/Marionette 全裁（-600K~1M）
- [ ] resources Bundle 配"小游戏分包"（上次用 CLI bundleConfigs 被校验拒绝：内置 bundle 不允许任务级覆盖；需在编辑器"项目设置 → Bundle 配置"里改）——目标产物出现 `subpackages/` 目录
- [ ] 分包生效后验证主包 < 4M，再回抖音工具验证报错是否随版本升级消失

## 今天的代码改动（已提交 5e264ff / b06fba5）

- 排行榜平台适配层 services/rank（抖音真实榜 + 本地兜底，RankScreen 只认 RankEntry）
- 收藏页藏品数据结构（obtained/unlockTime/ext）+ 未获得置灰/暂未获得
- 失效资源路径修复（2 处）+ 美术清单失效条目清理（3 条）
- loadSpriteFrame 自动补 /spriteFrame 后缀重试

## 明天行动顺序

1. 抖音开放平台下载**最新版**抖音开发者工具，打开 `build\bytedance-mini-game`（或重新构建的包）验证报错是否消失
2. 若消失 → 问题解决，继续真机联调（激励视频需先申请流量主广告位，填 `configs/platform-config.json` 的 douyinRewardedAdUnitId）
3. 若仍存在 → 换一台电脑/虚拟机验证工具，或联系抖音开放平台客服（附带本文件证据链）
4. 并行完成功能裁切 + Bundle 分包，主包压到 4M 内（真机上传的前置条件）
