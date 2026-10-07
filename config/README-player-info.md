# 玩家信息接口

统一入口：`GameFlow.platform.playerInfo`。抖音排行榜界面下方「我的成绩」已绑定资料授权入口，点击后登录宿主并获取昵称头像；没有启动时授权，没有发送资料到服务器或保存到本机存档。

```ts
const api = flow.platform.playerInfo;
const device = await api.getSystemInfo();
const ticket = await api.login();
// 以下调用放在玩家点击授权资料按钮的处理函数内。
const profile = await api.requestProfile();
if (profile.success) {
    // profile.data.nickName、profile.data.avatarUrl
} else {
    // 展示 profile.message；拒绝授权后允许继续作为游客游戏。
}
```

所有返回均带 `channel`（douyin / wechat / h5）及 `success`。成功读取 `data`，失败读取 `reason`、`message`。调用失败、缺少API、异常数据、15秒超时都返回失败结果，不阻塞游戏。

| 接口 | 抖音小游戏 | 微信小游戏 | H5预览 |
| --- | --- | --- | --- |
| getSystemInfo | tt.getSystemInfo | wx.getSystemInfo（存在时） | 浏览器语言与屏幕尺寸 |
| login | tt.login，默认force=false | wx.login，返回临时code | unsupported |
| requestProfile | 点击后先force=true登录，再tt.getUserInfo授权昵称头像；结果缓存于profile | unsupported，需另接微信资料填写能力 | unsupported |

渠道优先使用 Cocos 构建目标，未指定时探测 tt/wx。设备结果中的 `appName` 表示宿主（抖音、头条等），不是用户昵称。此处“渠道”指运行平台；投放渠道、场景来源参数尚未接入。

requestProfile 由用户点击触发，使用 force=true 登录。若仍仅返回 anonymousCode，返回 not_logged_in。授权拒绝后不循环弹窗；检测到资料权限关闭时提示玩家在小游戏右上角「更多 → 设置」开启。SDK失败保留errMsg与errNo，便于真机排查。

登录 code / anonymousCode 是临时凭证，不是永久玩家ID。拿到凭证后需交给自己的服务端调用 code2Session，建立账号、签发游戏会话。项目尚未提供该后端接口，因此这里不虚构 openid，也不声称完成服务端登录。AppSecret 和 session_key 不应放入客户端。资料不包含手机号、性别、城市等信息。

## 官方资料

- [用户提供的系统信息文档（小程序）](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/api/device/system-information/tt-get-system-info/)
- [小游戏 tt.login](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/log-in/tt-login)
- [小游戏 tt.getUserInfo](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/log-in/tt-get-user-info)
- [用户信息字段调整](https://developer.open-douyin.com/forum/synthesize/post/63354a56b1d3de363093289d)
- [服务端 code2Session](https://partner.open-douyin.com/docs/resource/zh-CN/mini-game/develop/server/log-in/code-2-session)

本地 SDK 模拟验证：`node tools/test-player-info.cjs`。实际授权、宿主登录、头像地址及微信能力需要对应平台真机验证。
