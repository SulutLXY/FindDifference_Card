# 累计游玩次数服务

Node.js 24 + 内置SQLite，无npm依赖。统计口径：一次真实进关产生一个独立事件，无论最终成功/失败。重玩产生新事件；同一局的网络重试沿用事件ID，不重复增加。无需玩家登录，不统计独立玩家人数。

## 初始值

| 章节 | 初始次数 |
| --- | ---: |
| 网络热点 | 219500 |
| 年度热梗 | 58750 |
| 宠物故事 | 103700 |
| 萌宠三国 | 60880 |
| 恋爱美食 | 358400 |
| 青花瓷和城市子章节 | 0 |

初始值来自本次重新上线的配置，不伪造历史逐关事件。首次创建数据库时写入chapter_baselines，重启、重新部署和再次运行种子均不会重复增加或覆盖已累计结果。页面显示 = 章节初始值 + 该章节包含关卡的新进关次数。恋爱美食包含8个城市，任一城市进关一次会给城市计数和专题汇总各增加1；专题内稳定关卡ID去重后求和。

## 本机启动

在本目录运行：

```powershell
node server.cjs
```

默认仅监听 `127.0.0.1:8080`，数据库位于 `data/plays.sqlite`。可通过环境变量设置 `HOST`、`PORT`、`DATA_PATH`、`CATALOG_PATH`、`RATE_LIMIT_PER_MINUTE`（默认600次请求/IP/分钟）。`ALLOWED_ORIGINS` 为允许的H5来源，逗号分隔；原生小游戏不需要浏览器跨域授权。不要将运行数据库提交到Git。

## 服务器部署

把此目录完整复制到一台有Docker Compose的Linux服务器，运行：

```sh
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
```

返回 `{"ok":true}` 后，通过已经配置TLS证书的Nginx域名转发：

```nginx
location /game-stats/ {
    client_max_body_size 64k;
    proxy_pass http://127.0.0.1:8787/;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Host $host;
    proxy_read_timeout 10s;
}
```

示例最终地址为 `https://你的域名/game-stats`。Compose只把端口绑定到本机，开启TRUST_PROXY后仅由反向代理传入真实IP；不要把该容器端口直接开放公网并同时信任外部自带的转发头。Native发布前将域名添加到抖音后台的request合法域名；若需H5访问，设置ALLOWED_ORIGINS为实际H5域名。

服务是公开的累计热度接口，具有事件幂等、关卡白名单、批量/体积限制和基础限流；不证明请求来自某个已认证玩家，不用于发奖、支付或竞技排名校验。需要更强防刷时再接入宿主登录验证/网关，客户端不能内置保密令牌。

SQLite文件及WAL必须留在持久卷中，仅运行一个服务实例，不在多台机器之间共享该文件。`docker compose up -d --build`更新代码会保留数据；不要使用 `docker compose down -v`，该命令会删除累计数据。

备份可在停服务后复制完整data目录；在线备份使用随附脚本：

```sh
docker compose exec play-stats node backup.cjs /data/plays-backup.sqlite
```

下载并保管备份，不用旧数据库覆盖正在运行的服务。备份路径已存在时脚本拒绝覆盖。

## 接入客户端

服务部署并验证后，在 `assets/resources/configs/platform-config.json` 设置：

```json
{
  "apiBaseUrl": "https://你的域名/game-stats",
  "playStats": { "enabled": true }
}
```

上面仅展示需要改动的字段，保留现有playStats.initialCounts、newChapters、广告配置等其他内容，然后重新构建发布代码包。

当前项目按“暂未部署”保持enabled=false、apiBaseUrl为空：章节显示本次指定的初始数字，青花瓷显示“最新章节”，不会对不存在的服务器发请求，也不会把玩家本机次数当成全服数据。开启并发布后才开始累计新进关。服务无法推算此前未采集的真实次数。

客户端每次真正进入关卡后后台上报，不等待通关，不阻塞玩法；失败记录暂存本机，最多2000条并逐批重试。重启后相同事件ID会继续上传，服务端保证幂等；删除本机数据、长期离线超过队列上限或无法写入存储仍可能丢失尚未送达记录，不能承诺网络遥测绝对无损。

## API与目录更新

- `POST /v1/play-events`，JSON：`{"events":[{"id":"event-unique-00001","levelId":"永久关卡ID"}]}`。每批1—20条。返回acknowledged包含已处理和重复事件，accepted仅包含新增事件。相同ID配不同关卡返回409并回滚整批。
- `GET /v1/play-counts?keys=wang-luo-re-dian,lian-ai-mei-shi`，返回counts整数映射。最多50个章节，未知章节返回400；没有事件的已知章节也返回准确初始值。
- `GET /healthz`，仅检查当前服务已启动。

在项目根运行 `node tools/sync-play-stats-catalog.cjs` 生成catalog.json，再部署服务端更新。它读取正式章节索引、专题分组和初始值配置，使用永久关卡ID，不使用文件夹序号；会保留之前已知ID以接受旧客户端的迟到事件。章节合并/排序不会重建事件表或覆盖已有累计数。

测试：在项目根运行 `node tools/test-play-stats.cjs`，覆盖真实HTTP/SQLite、并发、断线后重传、重启、回滚、初始化与前端请求。技术参考：[Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)、[Node.js HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)。
