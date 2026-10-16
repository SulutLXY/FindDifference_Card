# Web 手机端同地址更新

## 推荐发布方式：固定入口与独立构建目录

2026-10-16 线上实测：普通 index.html 请求命中旧入口（CDN 缓存 2592000 秒），带随机参数的请求返回新构建。旧运行环境请求未带哈希的 config.json，服务器只保留新文件时会 404。这不是清玩家数据能解决的问题。

构建完成后执行 `npm run web:package`，发布 **output/web-mobile-release 目录内的文件**，不再直接覆盖原始 build/web-mobile 内容。结构为固定 index.html、release.json、releases/<内容摘要>/完整游戏。固定入口在每次打开时重新获取清单，以同源 iframe 加载对应独立目录。入口 URL、分享参数、hash 和玩家存档保持可用；不同构建不会共用相对资源目录。

上传顺序：先上传新的 releases/<摘要>/ 全部文件，最后更新 release.json；第一次接入还需上传固定 index.html，并刷新原访问 URL、index.html 和 release.json 的 CDN 缓存。旧 releases 目录保留给仍在线的用户。不要直接把新的原始构建覆盖到旧 releases 目录。

OSS/CDN 必须给 index.html 和 release.json 设置 `Cache-Control: no-store, max-age=0`，版本目录可以长期缓存。随机查询参数用于绕过当前 CDN 已观测到的旧缓存，但不能代替服务器缓存配置。Apache 的配套 .htaccess 已放入输出，OSS/CDN 需在管理端配置。

打包前自动验证入口文件存在、settings 启用 MD5、所有 Bundle config 的哈希匹配，并要求 H5 Bundle 在本地构建目录完整输出。缺文件会停止生成发布清单。测试：`node tools/test-web-release-package.cjs`。

Web 缓存由浏览器/CDN 管理，不能套用抖音的 cacheManager.clearCache。不要清除 localStorage、IndexedDB 或玩家存档来更新资源。

## 构建行为

- Web 手机端开启 MD5 Cache：内容变化时文件名改变，代码、配置和图片按同一次构建引用。
- 每次渲染 index.ejs 产生独立构建标识，即使应用版本号不变也能识别重新发布。
- 启动游戏前以 no-store 和随机查询参数检查当前目录的 index.html。旧入口发现新构建时，以新标识刷新当前地址，保留分享参数及 hash，停止旧入口启动。CSS 和启动依赖保持原始模板路径，由 Cocos 构建末尾统一改写为 MD5 文件名；不要预先追加查询参数，否则会妨碍路径替换。
- 从浏览器历史页面缓存恢复时再次检查。网络异常则允许当前构建继续启动；不要在发布时立即删除旧构建仍引用的哈希文件。

## 服务器设置与首次迁移

游戏目录默认首页及 index.html 返回 `Cache-Control: no-cache, must-revalidate`。带哈希文件可长期缓存；其他未带哈希的固定文件名应重新校验。

OSS：设置 index.html 对象元数据；CDN：HTML/目录默认首页缓存规则须尊重该响应头，首次部署以及发布更新后刷新默认首页及 index.html 的 CDN 缓存。若 CDN 忽略查询参数，须调整其缓存规则或刷新入口。

Apache 可使用构建模板中的 .htaccess（需要 mod_headers 和 AllowOverride）。OSS/CDN 不读取这个文件；Nginx 需在游戏目录配置中设置等价响应头。

前端不能清除服务器缓存，也不能让发布此机制之前已经长期缓存的旧 HTML 执行新代码；首次迁移必须配套刷新入口缓存。

## 发布

1. `npm run version:sync`，在 Cocos Web 手机端面板确认 MD5 Cache 已勾选，重新构建。不要直接重跑保存了 md5Cache=false 的历史任务。
2. 上传同次构建的代码和配套远程 Bundle，先资源、最后 index.html，保留旧哈希文件。
3. 远程资源上传到实际构建 settings 的 assets.server；本机制不改资源服务器地址。
4. 设置入口响应头并刷新 CDN 入口缓存。用旧用户同一 URL 验证新逻辑和图片、通关与奖励库存保留。

验证：`node tools/test-web-release.cjs`。构建两次，即使不改应用版本号，HTML 的 find-difference-build 也应不同。

发布前运行 `node tools/check-web-entry.cjs`，确认实际构建入口引用的 CSS、脚本与 import map 文件都存在。OSS 标准 Bucket 域名会强制下载 HTML，需要绑定自定义域名承载网页。
