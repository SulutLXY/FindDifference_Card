# 首包资源检查与调整（2026-11-05）

> 2026-11-10：已改为“本地只保留Loading视觉资产与小型启动配置，MainGameSources远程加载”。以下为历史方案，当前实现与验证见 [Loading首包与远程玩法](README-loading-only-2026-11-10.md)。

本次检查 Loading → 当前玩法页，已修复启动场景反向依赖远程主页包的问题，并减少玩法刚开始时的额外下载。版本号维持0.1.5.2；本次没有重新构建、打包或平台上传。

## 最终加载时机

| 时机 | 内容 |
| --- | --- |
| 冷启动至首个玩法画面 | 本地main/resources/MainGameSources，以及当前章节包及本关图片 |
| 下一关预下载 | 仅当前章节，串行、低优先级；章节末关不预下载下一章节 |
| 累计8秒有效游戏时间后 | 一次性后台准备LobbySources的主页静态界面和主页音乐 |
| 实际打开主页 | MainGameAimation主页动画 |
| 实际打开章节/关卡选择页 | 对应页面、封面和所需缩略图 |
| 实际打开收藏或收藏获得弹窗 | 所需收藏图片，不再整包预下载food-icons |
| 主页签到入口 | 按原规则加载签到弹窗，玩法页不弹签到 |

教程、暂停、结算、加载、插屏和Feed预览不累计主页后台准备的等待时间；后台准备不打开主页、不激活附属页面。提前主动返回主页仍立即加载，复用同一请求；失败可重试，不劫持后续导航。

## 实际迁移

- 设置图标从 `assets/LobbySources/textures/UI_Sprite/icons/icon_settings.png` 移至 `assets/resources/textures/UI_Sprite/V3/icons/icon_settings.png`，图片及meta字节、UUID均保留。启动场景和主页共用本地资源。
- `assets/SupportTexture` 整目录连同meta移至 `assets/resources/textures/SupportTexture`，保留全部图片及其meta，取消目录的独立Bundle标记，公共说明图归入本地resources。
- 迁移清单及原始哈希为 `config/startup-loading/asset-moves.json`。SupportTexture目录自身UUID保留，仅去掉Bundle配置。
- 取消首次进入玩法就创建四个附属页面、整包预载章节封面及60张收藏图、预载签到弹窗和主页动画。各页面继续通过原有按需入口加载。

先前PNG压缩清单/备份中的设置图标和SupportTexture使用迁移前路径；如恢复这些原图，需按上述迁移清单还原到新路径，避免重新创建重复UUID的旧资源。压缩后的图片内容本次没有改动。

## 验证

`tools/audit-startup-assets.cjs` 检查18个入口、74个依赖资产，启动/玩法依赖仅归属main、resources和MainGameSources，无远程主页/动画/收藏/封面包依赖，无丢失UUID。结果写入 `config/startup-loading/dependency-audit.json`。

已通过首包依赖、玩法延迟创建、8秒后台准备及暂停/Feed阻断、当前章节预下载及跨章阻断、进关扣体力、主页动画、导航插屏、签到、提示与倒计时相关测试，以及TypeScript检查。未进行新构建或真机冷启动测速；不能据此承诺具体启动秒数或平台压缩包大小。

本次Git提交同时包含此前工作区已完成的命名章节/旧进度迁移、年度热梗合并、恋爱美食层级、热点新增10关、青花瓷60关及20收藏、PNG压缩、主页远程资源、签到/收藏页及平台适配。各项详细备注见对应README；Feed自动排期仍按配置保持关闭，等待其余真实ID及后台开通确认。
