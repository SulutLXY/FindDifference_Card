# Feed 投递及奖励检查记录

用户确认：目前线上/测试版本为 `0.0.22`，下一包资源目标为 `0.1.6`。项目当前内部版本为 `0.1.6.1`。未修改平台发布版本号，未上传代码或 CDN 资源。

## Feed 结论

**客户端接入与新包内容已验证，线上投递尚未确认。最新新包的 18 个 CDN Bundle 配置均已可访问；用户提供的申请上线报错明确为“图片相似问题”。早期 404 检查仅作历史记录，不再作为当前失败原因。**

用户提供的接入文档中 21 个复访 ID、20 个获客 ID 与源码配置逐条、顺序一致。文档内容仅用于核对接入参数，没有执行其中的筹备、账号、上传或工具下载要求，也没有将其中密钥写入项目。

Feed 由抖音向用户展示推荐流直玩卡，玩家进入后游戏读取场景及 query。客户端已接入全场景订阅、`tt.storeFeedData` 就绪登记、`tt.reportScene({sceneId:7001})` 首帧上报，以及 `feedEnter` / `feedExit`。API 接口和本地测试通过不能证明平台已曝光卡片，后台仍需开通相应能力，并选用与客户端一致的免服务端托管方式。

文档同时提到“21 条每两小时、42 小时内”和“首日 2/4/6 小时、随后 18 天每天一条”两种不同排期。当前方案沿用本次项目更新：体力按实际回满时刻，离线收益/重要事件按实际签到可领时刻；不是上述任一固定排期。`contentID` 是内容标识，不按消耗型订阅令牌处理，不能据此保证精确定时曝光或离线 19 天后客户端自动运行。未擅自修改运营排期。

## 实际产物及 CDN 证据

- 上轮检查时，本地旧 `build/douying` 指向 `tt/0.1.5/`，缺少当时新增的 Feed、签到联动与订阅补奖代码；这是历史检查结果，不代表已取得线上 `0.0.22` 包并检查其内容。用户重新打包后的结果见下文复查。
- 已用 Creator 3.8.8 重新构建独立检查包：`build/feed-audit-0.1.6/douyin`，最终构建 15 秒，退出码 `36`。使用类型正确的 `build-config.json`，避免 CLI 字符串 `"false"` 被误作开启主包远程化。
- `tools/audit-feed-build.cjs` 检查全部通过：AppID、内部版本、41 个 ID、当前关键代码、早期 Feed/侧边栏事件桥、资源版本迁移、iOS 配置、启动资源本地化、全部远程 Bundle 配置配套。`tools/audit-built-startup.cjs` 通过。
- 实际新包资源地址为 `https://rewan-file.oss-cn-shenzhen.aliyuncs.com/games/mishi/ndzdk02/tt/0.1.6/`。
- 本次对新包所需资源执行 HTTP HEAD：`remote/MainGameSources/config.3ab97.json` 返回 **404**；`remote/LobbySources/config.b084e.json` 返回 **200**。此检查未逐个请求所有远程图片/音频，不能用单个 200 证明全部资源完整。
- 已生成完整配套资源上传目录 `build/feed-audit-0.1.6/resource-upload/upload/remote/`，共 4074 个文件、195205175 字节（约 186.2 MiB）。上传目标为上述 `0.1.6/remote/`；先补齐资源，再发布配套代码，保留服务器旧哈希文件。本次没有上传。

原始记录：`build/feed-audit-0.1.6/feed-audit.json`、`cdn-audit.json`、`creator.log`、`creator-stdout.log`，资源包清单为 `resource-upload/manifest.json`。这些构建文件受 Git 忽略；检查脚本和本说明可入库。

## 用户重新打包后的复查

已检查用户新生成的 `build/douying`，运行 settings 为 `settings.b4ace.json`。Feed 包内容检查与启动资源检查全部通过：内部版本 `0.1.6.1`、资源地址 `tt/0.1.6/`、41 个 ID、当前 Feed 与奖励代码、早期事件监听及本地启动资源均正确。项目脚本 SHA256 为 `b701b84bcade2da00b5a2e81682ec391eb1c8ce04c75a8187867939a939b84a4`，与上轮独立检查包一致。

按该新包实际引用的哈希逐一检查了 18 个 CDN Bundle 配置：17 个返回 HTTP 200，`MainGameSources/config.3ab97.json` 仍返回 HTTP 404。新包本地 `build/douying/remote/MainGameSources/config.3ab97.json` 确实存在，需要将新包的 `remote/MainGameSources/` 完整内容上传到 `tt/0.1.6/remote/MainGameSources/`，包括配置所引用的 import/native 文件，保留服务器旧文件。本次未上传。

本轮证据保存于 `build/repack-audit-0.1.6/feed-audit.json` 和 `cdn-audit.json`，放在代码包之外。17 个配置可访问不能证明它们引用的全部图片/音频均已上传；本轮也未取得手机端 Feed 实际曝光证据。

## 奖励审计结果

### 五个获客方案无法通过测试的排查（2026-11-16）

`CONTENT13714795522`、`CONTENT13714486786`、`CONTENT15898028034`、`CONTENT16010983170`、`CONTENT15865072898` 均存在于源码 `feed.acquisitionContents` 和当前 `build/douying` 的 resources 配置中，不在复访 `contents` 内。当前 Feed 构建检查与 `test-feed.cjs` 通过，没有发现这五个 ID 被漏配或单独阻断。

排查过程中发现用户又重新构建了新包。最新 settings 为 `settings.7e367.json`，玩法包哈希已改为 `e5cdb`，本地配套资源位于 `build/remote/`。按这份 settings 检查的 18 个 CDN Bundle 配置均返回 HTTP 200，检查期间 settings 未变化；构建审计通过。因此，旧包 `config.3ab97.json` 的 404 不适用于当前包。证据为 `build/repack-audit-0.1.6/acquisition-build-audit.json` 和 `acquisition-cdn-audit.json`。该检查不等于逐一验证了所有图片/音频，也不能证明实际推荐流曝光。

获客官方测试要求选择对应方案和代码版本、配置测试设备，并通过获客测试二维码进入。启动参数应为 `scene` 后缀 `3041`、`feed_game_channel=2`、`feed_game_scene=0`，Content_ID 为当前测试方案。玩法场景加载完成后调用 `tt.reportScene({sceneId:7001})`；项目绑定成功不代表预启动、首帧、场景就绪及报告检查均已通过。获客流程不应混用复访场景的签到/体力就绪登记条件。

本次本机 IDE 状态为离线，未取得手机端测试错误或平台报告。需要依据测试弹窗中的具体阶段定位，不能仅凭 ID 和绑定成功推断平台根因。

### 申请上线失败的实际原因已明确

用户补充：扫码可加载并绑定，同版本下有的方案通过、有的方案未通过；随后提供的实际弹窗原文为“存在图片相似问题的方案”。该弹窗指向推荐流素材相似度校验，不能继续将本次拦截归因为绑定、订阅、Content_ID 漏配或旧 CDN 404。它也不证明其他测试项已经全部通过。

截图当前标记的是以下 6 个方案，与最初询问的 5 个 ID 不完全相同，应以当前弹窗为准：

| Content_ID | 推荐文案 |
| --- | --- |
| CONTENT15865072898 | 海量关卡来袭，找不同寻物等你来闯关！ |
| CONTENT13714795522 | 找差异找物件，眼力闯关欢乐不停歇！ |
| CONTENT13714486274 | 脑洞比谜题更难猜！ |
| CONTENT13630007810 | 反常识寻物，别按套路！ |
| CONTENT15898028290 | 卡通画风超治愈，找不同寻物欢乐闯关！ |
| CONTENT15927378690 | 眼力突围挑战，找不同寻物你能闯几关？ |

处理建议：保留 Content_ID，在方案管理中修改被标记方案的推荐流图片，分别使用主体场景、人物与构图差异明显的真实游戏关卡首帧。仅修改文字或文件名不能改变图片主体内容，不应据此承诺通过；不要为绕过相似度检查加入无关或与实际游戏不符的画面。保存后按后台要求重新验证及提交。官方获客指南要求提报用于获客的游戏首帧图片及文案；本次未找到可据以保证通过的相似度百分比阈值，也未确认平台的具体比对算法和相似配对。

本轮通过 computer-use 查看了当前方案管理、研发测试及版本选项，未提交申请上线、未修改或下线任何方案素材。当前问题不需要通过重新打代码包来解决。

| 入口 | 发现及处理 |
| --- | --- |
| 订阅有礼 | 已补齐首次确认订阅后的免费提示×2，已有订阅可补领；一次性标记与库存原子保存，失败/空间不足保留资格。 |
| 侧边栏入口有奖 | 修复库存已满仍记录已领取并提示×2；现需容纳完整奖励，成功后立即刷新玩法 HUD。 |
| 收藏回访 | 同样修复容量截断及领取标记；但入口识别规则为空，当前实际不会发奖，面板已明确“暂未开放”。仍需真机取得唯一收藏进入组合后配置，不能将“已收藏”冒充回访来源。 |
| 普通/双倍签到 | 修复接近上限时截断奖励却消耗签到资格；容量不足不领奖、不播双倍广告，腾出足够空间后再领。Feed 同步排除实际放不下的签到奖励。 |
| 惊喜提示/加时 | 修复完整看完视频后换关导致奖励直接丢弃；现整份存入库存，不自动用于新关卡。正常本关使用一份、剩余入库；空间不足先阻止视频。 |
| 提示、加时、复活、通关返还体力、体力视频、收藏解锁入口 | 已检查其实际奖励入口，并运行相关回归测试；取消/失败不发奖、已完成视频才发奖、保存失败提示及回滚仍保留。没有据此宣称真机所有分支均已复现。 |

本次通过的相关脚本：`test-reward-capacity.cjs`、`test-feed-subscription-reward.cjs`、`test-daily-sign-in.cjs`、`test-sign-in-desktop.cjs`、`test-surprise-assist.cjs`、`test-level-assists.cjs`、`test-revive-reward.cjs`、`test-level-clear-energy.cjs`、`test-energy-access.cjs`、`test-result-reward-entries.cjs`、`test-sidebar.cjs`、`test-favorite-guide.cjs`、`test-feed.cjs`、`test-lobby-entries.cjs`、`test-harmony-compatibility.cjs`、`test-douyin-performance.cjs`、`test-app-version.cjs`。TypeScript `--lib es2020,dom` 检查通过。此前已记录的旧 `test-money-tool.cjs` 测试数据问题没有修复，未声称全仓测试全部通过。

## 仍缺少的线上验收

1. 确认抖音后台复访/获客能力已开通、托管方式为免服务端、对应素材和方案已审核并关联要测试的新代码版本。
2. 补齐本次新包配套资源，确认上述 404 消失；在发布前核对实际代码包与资源哈希。
3. 使用同一测试账号在手机抖音真实授权并进关，检查 `[Feed] subscription-result` 与各 ID 的 `storeFeedData` 成功结果；若失败，按错误号排查权限或频控。
4. 在后台按对应 Content_ID 及测试版本生成复访/获客测试码，添加测试设备。核对 `[Feed] launch` 的 contentID / channel、首帧 `reportScene` 成功、`feedEnter` / `feedExit`，以及预览不扣体力、进入仅扣一次。
5. 最后确认实际推荐流卡片曝光及玩家点击回流；就绪登记成功和扫码进入均不等于已验证自然推荐流投递。

通过 [douyin-ide 技能](C:/Users/EDY/.agents/skills/douyin-ide/SKILL.md)检查时：账号状态未失效，但 IDE 离线；`start-ide` 60 秒内未连接，未取得窗口 ID、截图、模拟器日志或真机证据。没有把启动调用当作运行验证成功。

官方依据：[复访接入指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/feed/minigame-feedpush-setting-guide)、[获客接入指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/feed/customer-access-guide)、[就绪托管 API](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/feed-subscribe/tt-store-feed-data)。
