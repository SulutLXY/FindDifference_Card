# 2026-11-10 项目提交检查记录

版本保持 0.1.5.2，本次保存当前工程状态，未进行平台上传或远程资源部署。

## 主要内容

- Loading 首包保留必要资产；公共视觉、动画、音效及支持弹窗迁入远程 MainGameSources，保留资源 UUID；主页和附属页面延后加载。
- 抖音 iOS 高性能配置、启动阶段诊断、点击特效对象池、引擎模块裁剪及兼容调整。
- 章节热度初始数据、累计游玩次数客户端与独立 Node/SQLite 服务，以及热度配置生成工具。统计服务仍按未部署配置关闭。
- 惊喜道具泡泡、生命/提示/加时领取、视频奖励与跨局回调保护；同步关卡时限及相关 UI。
- 荆南波波黑标题子集：849 字符，约204.6 KiB；PleyGame 内保留字体和许可证，docs/art-source 保留原字体以供重建。新增名称后运行 `python tools/subset-title-font.py --install`。
- 进关自动扫描章节包根目录 BGmusic；萌宠三国、宠物故事、年度热梗使用各自专属音乐，支持通用音乐回退、开关、重试及异步请求/资源生命周期保护。
- 收藏“全部”跨类别统一排序：已获得未查看、已获得已查看、未获得；各组按 ID 自然升序，每页9件，不按类别强制拆页。当前60件共7页。
- 同步本次编辑过的章节封面、预制体、图标、章节展示顺序和文档。

## 本次检查

- 执行全部77个 `tools/test-*.cjs`；首轮65项通过，修正运行时环境变量后，排行榜、玩家资料、渲染批处理3项也通过，合计68项通过。不是全量测试通过。
- 音乐、收藏、关卡加载、Feed、资源包路径/生命周期、惊喜道具、统计HTTP/SQLite、章节层级、抖音性能等当前功能回归通过。
- TypeScript通过：`tsc -p tools/tsconfig-hud-check.json --lib es2019,dom`。现有检查配置默认ES2018，统计代码使用的flatMap/fromEntries需要ES2019库声明，因此本次通过命令参数指定，不改变游戏构建目标。
- 标题字体重建/同步通过；849个保留字符的轮廓、字宽、侧边距及行高参数校验通过，无缺字。
- 扫描未发现高置信度私钥、GitHub令牌或AWS访问密钥格式。Git排除构建产物、Python依赖、字体对比/导出文件及服务运行数据库。

## 仍未通过的9项

| 测试 | 本次观察到的失败原因 |
| --- | --- |
| test-2025-hotmeme.cjs | 假定年度热梗紧接网络热点；当前章节顺序中已插入青花瓷。 |
| test-built-save-unlocks.cjs | 默认 build/douyin/assets/main 不存在，需先提供对应构建产物。 |
| test-event-tips.cjs | 仍在主场景寻找 EventTips；节点已抽取到 GameplaySupport 预制体。 |
| test-failure-protection.cjs | 硬编码旧本机 TypeScript 安装目录，该目录不存在。 |
| test-loading-only.cjs | 迁移时的逐节点快照与当前手动编辑的 FoodTips 关闭按钮层级不一致。 |
| test-money-tool.cjs | 硬编码旧本机 TypeScript 安装目录，该目录不存在。 |
| test-pet-three-kingdoms.cjs | 源映射差异点数快照与当前配置存在16/15不一致。 |
| test-tutorial.cjs | 测试抽取的模拟对象缺少当前 dismiss 调用的 _clearHint。 |
| test-web-release.cjs | 缺少被忽略的本机 profiles/v2/packages/web-mobile.json。 |

此次提交不为让检查变绿而覆盖现有美术编辑、回退章节顺序或放宽历史快照断言。上述失败保留供后续处理；完整本机日志位于被忽略的 output/git-validation。

本次未重新构建或进行模拟器/真机验收。发布时仍需将同次构建的代码包与远程资源一起更新，不能仅推送Git替代部署。
