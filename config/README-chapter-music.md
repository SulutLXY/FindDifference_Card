# 章节专属背景音乐

每次进入关卡时，GameFlow 查询该章节 Asset Bundle 的 `BGmusic` 音频索引，有曲目时优先作为循环游戏背景音乐。不需要在代码中登记章节名或文件名。

当前专属音乐（萌宠三国、宠物故事、年度热梗、青花瓷、南京）：

```text
assets/Bundle/levels/meng-chong-san-guo/BGmusic/Game_music_sanguo.mp3
assets/Bundle/levels/chong-wu-gu-shi/BGmusic/Game_music_PetStory.mp3
assets/Bundle/levels/nian-du-re-geng/BGmusic/Game_music_ReGeng.mp3
assets/Bundle/levels/qing-hua-ci/BGmusic/Game_music_Qihuaci.mp3
assets/Bundle/levels/nan-jing/BGmusic/Game_music_Nanjing.mp3
```

后续章节按相同结构，在章节包根目录新增 `BGmusic`，导入 Cocos 支持的 AudioClip 即可。目录区分大小写。目录中有多首音乐时，每次进关随机选一首；重试保留当前曲目。连续进入并选中同一曲目时延续播放。

没有目录、空目录、无 AudioClip、索引读取失败或专属音乐下载失败时，沿用现有通用游戏音乐逻辑。返回大厅/选关页面后恢复大厅音乐。音乐开关与抖音预览静音同样适用于专属曲目。

发现曲目时只读取包索引，按需加载选中的一首。播放期间持有音频引用和章节包，切歌、关闭音乐或销毁流程时归还；异步返回的旧请求不会覆盖新页面音乐。

进入/离开玩法及不同曲目之间采用双音源 **1.5 秒交叉淡化**：旧曲由当前音量降到 0，新曲从 0 升至正常音量。新曲下载就绪前继续播放旧曲；首次播放仅淡入。同一曲目连续播放不重启；快速切回仍在淡出的曲目会从当前音量反向淡化。最多两路背景音乐，旧曲完全淡出后才归还音频与章节包引用。Loading、大厅、暂停和结算页同样推进淡化，不依赖关卡倒计时。关闭音乐或进入 Feed 预览立即停止两路；结算音效期间对两路背景音乐统一乘 50% 音量，结束后恢复当时的淡化进度。

2026-11-11：确认新增青花瓷、南京音乐及其 AudioClip 元数据位于各自章节包，直接沿用上述自动发现逻辑，无需增加文件名映射。回归覆盖两章进入、连续游玩、重试、跨章节切换与音乐开关；新增音频不进入 Loading、resources 或主页包。发布时需重新构建并上传这两个章节的远程包。

验证：`node tools/test-chapter-music.cjs`，并回归关卡加载、Feed、玩法资源路径和内容包生命周期测试。类型检查使用 `tsc -p tools/tsconfig-hud-check.json --lib es2019,dom`（项目已有统计代码使用 ES2019 API）。未进行模拟器/真机试听。

交叉淡化验证：`node tools/test-background-music-mixer.cjs`，覆盖双路音量中点/终点、延后资源释放、快速切回、连续切换、结算音量叠加与立即关闭。代码测试不替代真机试听。
