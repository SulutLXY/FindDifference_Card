# 应用与资源版本

唯一修改入口：`config/app-version.json`，当前为 `0.1.5.2`。

- 前三位是资源版本（`0.1.5`），第四位是代码修订。
- 抖音启动模板在引擎基础设施初始化之后、远程资源加载之前比较本地版本。
- 第四位变化不清缓存。前三位不同（包括回滚），或首次接入没有有效记录，清除全部 Cocos 资源缓存，再正常加载配套资源。
- 清理只调用 Cocos cacheManager，不删除平台用户数据目录、不清 localStorage、不修改玩家存档。
- 场景启动成功后才保存完整版本，失败下次重试。磁盘缓存清除由 Cocos 平台实现执行；不把版本记录作为文件完整性验证。
- FooterEnv 显示同一完整版本，预览环境也显示。上述缓存清理仅用于抖音；Web 手机端采用内容哈希和入口构建检查，见 [Web 发布说明](README-web-release.md)。

## 发布步骤

1. 修改 `config/app-version.json`。
2. 执行 `npm run version:sync`，同步项目版本、FooterEnv 常量和抖音启动版本，并开启 MD5 Cache。该命令不修改资源服务器地址。
3. 执行 `npm run test:version`。
4. 在 Cocos 重新构建抖音包。不要复用旧构建产物；确认实际构建任务使用新配置。
5. 将同次抖音构建的 remote 产物同步到构建 settings 中 `assets.server` 对应的 `remote/` 目录，再上传代码包。例如 server 为 `https://…/tt/0.0.4/`，则本地 `remote/city-PetStory/config.<hash>.json` 对应 `https://…/tt/0.0.4/remote/city-PetStory/config.<hash>.json`。当前构建示例为代码包 `build/douyin/` 配套 `build/remote/`；构建任务变化时不能凭目录名判断，应核对代码包 `assets.bundleVers` 与 remote 配置文件哈希。使用 `npm run remote:package -- --previous build/remote0 --current build/remote --build build/douyin --out build/remote-update` 校验并生成上传增量，具体要求见 [内容包说明](README-content-bundles.md#生成上传增量)。必须保留旧包仍引用的文件。
6. 确认生成的游戏包包含 app-version.js、resource-version.js，启动脚本有资源校验；开启 MD5 时文件可能带哈希后缀。
7. 真机验证首次进入、老用户升级、第四位更新、断网重试和存档保留。

代码包由抖音平台更新，该逻辑不下载或删除平台代码包。
仅第四位更新时资源目录不变；如果场景、预制体、图片、音频、关卡 JSON 等资源也改变，应增加前三位。
资源版本号与 OSS 目录名可以不同，启动时不按目录名拦截。资源地址以实际构建 settings 为准。
如果资源更新采用独立目录，必须让新目录包含所有被引用的资源；增量工具应使用 `--full`，不能假定旧目录文件可在新目录复用。目录名不需要与版本号相等。复用同一目录内的未变哈希文件时，使用增量模式并保留旧哈希。

## 重新构建后出现远程 config 404

当前抖音配置开启 md5Cache，main 为本地包。代码包的 `src/settings.<hash>.json` 中 `assets.bundleVers` 决定各远程 Bundle 需要下载的配置文件名；配置还会引用配套资源。每次发布都应同步同次构建的 remote 目录；内容未变化的文件可跳过，不需要每次全量重传。不能只上传 config，也不能将旧配置重命名为新哈希。版本号不变不代表构建资源哈希不变。

遇到 404，先核对请求文件是否存在于实际构建的 remote 目录，并确认已上传到相同 OSS 路径。清缓存无法补齐服务器缺失的文件。
