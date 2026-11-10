# 章节专属背景音乐

每次进入关卡时，GameFlow 查询该章节 Asset Bundle 的 `BGmusic` 音频索引，有曲目时优先作为循环游戏背景音乐。不需要在代码中登记章节名或文件名。

当前专属音乐（萌宠三国、宠物故事、年度热梗）：

```text
assets/Bundle/levels/meng-chong-san-guo/BGmusic/Game_music_sanguo.mp3
assets/Bundle/levels/chong-wu-gu-shi/BGmusic/Game_music_PetStory.mp3
assets/Bundle/levels/nian-du-re-geng/BGmusic/Game_music_ReGeng.mp3
```

后续章节按相同结构，在章节包根目录新增 `BGmusic`，导入 Cocos 支持的 AudioClip 即可。目录区分大小写。目录中有多首音乐时，每次进关随机选一首；重试保留当前曲目。连续进入并选中同一曲目时延续播放。

没有目录、空目录、无 AudioClip、索引读取失败或专属音乐下载失败时，沿用现有通用游戏音乐逻辑。返回大厅/选关页面后恢复大厅音乐。音乐开关与抖音预览静音同样适用于专属曲目。

发现曲目时只读取包索引，按需加载选中的一首。播放期间持有音频引用和章节包，切歌、关闭音乐或销毁流程时归还；异步返回的旧请求不会覆盖新页面音乐。

验证：`node tools/test-chapter-music.cjs`，并回归关卡加载、Feed、玩法资源路径和内容包生命周期测试。类型检查使用 `tsc -p tools/tsconfig-hud-check.json --lib es2019,dom`（项目已有统计代码使用 ES2019 API）。未进行模拟器/真机试听。
