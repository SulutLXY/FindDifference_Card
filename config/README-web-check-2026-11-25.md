# 网页启动检查与 PC 光标（2026-11-25）

## 已确认的问题

用户提供的报错访问的是 `file:///D:/CocosCreator/Projects/FindDifference/build/web-mobile/index.html`，浏览器来源为 `null`。这是直接打开本地 HTML 的跨域限制。Cocos 的场景、配置及图片需要通过 HTTP/HTTPS 读取，直接双击构建文件不能替代网页服务器测试。

网页入口模板已加入 file 协议检查：直接打开文件时显示通过网页服务器运行的提示，并阻止继续请求场景及资源，避免只留下白屏。正常 HTTP/HTTPS 启动和玩家存档不受影响。验证见 `tools/test-web-release.cjs`。

用户提供的 HTTPS 地址为 `https://hsy.rewanyouxi.com/games/mishi/ndzdk02/web/0.1.5/web-mobile/index.html`。对入口（普通及带检查参数）和 21 项启动依赖做了只读核对，返回的依赖均为 HTTP 200，且内容与当天原始 `build/web-mobile` 文件一致。没有证据将 HTTPS 页面的问题断言为上传遗漏；用户这条 file 协议报错也不能用作该 HTTPS 地址的控制台报错。

原始网页构建对应的成功任务 `1794479855037` 实际使用 `md5Cache=false`，虽然当前新任务的默认配置已为 true。原始包使用固定的 settings.json、index.js 和 Bundle config.json，同址覆盖时存在混用旧缓存的风险。重跑旧任务之前需在当前任务中确认 MD5 Cache 选项，不能只看默认配置文件。

## 本次准备的网页包

- 应用版本：0.1.6.4。
- 隔离构建：`build/web-fix-2026-11-25/web-mobile`，开启 MD5，所有网页资源本地随包输出。
- 发布目录：`output/web-mobile-release`，固定入口、release.json 和 releases/独立目录。
- 已在 HTTP 浏览器中实际进入「骑士小猫」玩法界面；随后入口模板补入本地 file 打开提示，并重新构建。
- 发布完整性、入口模板、file 协议阻止启动、PC 光标环境隔离及 TypeScript 检查通过。

上传的是 `output/web-mobile-release` 内的内容。先上传清单所指向的 releases/目录，最后更新 release.json 和固定 index.html；如覆盖已有地址，应刷新入口与 release.json 的 CDN 缓存，并为它们设置 `Cache-Control: no-store, max-age=0`。不要删除仍有旧用户访问的已发布资源。

## 猫爪光标

`icon_Mouse_01.png` 已支持 Creator 预览和正式 H5 的 PC 鼠标环境。通过 HTML5/PREVIEW、浏览器、非移动设备及精细指针条件共同判断。手机网页、原生包和小游戏不启用。光标使用 CSS，宽 48 CSS 像素，不增加节点或改变游戏命中区域；离开场景时恢复原光标。

本次没有上传远端或提交 Git。原始 build/web-mobile 保留，避免覆盖用户当前上传依据。
