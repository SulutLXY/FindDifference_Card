# 新资源优化（2026-11-19）

本次沿用上一轮规范，仅修改新增的 14 段音效和新增/修改的 11 张动画 PNG。优化前全 assets 共 5394 个文件的哈希已保存于 `temp/new-media-optimization-2026-11-19/before.json`；最终只改变这 25 个素材文件，其余 5369 个文件（包括全部 `.meta`、代码、预设、图片配置和字体）保持字节不变。

## 音频

- 三国新增 6 段 SG02/SG03、青花瓷新增 8 段 QHC02/QHC03，共 14 段 MP3，均由 320kbps 转为 96kbps、44.1kHz、双声道。
- 合计 819896 → 255160 字节，节省 564736 字节，约 68.88%。文件路径、资源 UUID、声道、解码时长保留；最大 RMS 音量变化约 0.734%，峰值均通过原质量门槛。
- 编码仍从备份前的当前原文件进行，必要时从原文件补偿音量；品质不通过会尝试更高码率或保留原文件，收益不足 5% 不替换。本次全部 14 段均通过 96kbps 检查。
- 明细及源/目标哈希：`config/media-optimization-2026-11-19.json`。
- 原文件及 meta 备份：`temp/media-optimization/20261119-193225-602315/originals.zip`。已核对备份哈希和实际结果。

## 关卡与 PNG

- 寻宋记、趣味短剧共 65 关，130 张玩法图均为 1024×672、Photoshop 品质 8；65 张缩略图均为 306×200，已符合原资源规范，本次保持字节不变。全项目 780 张 scene-a/b JPG 均未重编码。
- “寻宋记”封面现为独立的新美术稿 360×188，实际尺寸与 meta 一致，本次保留。对应校验改为检查当前美术与 meta 一致，不再强制要求原临时封面的 612×400。
- 三国漂浮道具动画 4 帧及背景 1 张、通用漂浮道具动画 6 帧，共 11 张 PNG 只进行无损 IDAT 重压缩，全部 RGBA 像素、透明度、画布尺寸和 meta 保持一致。
- PNG 合计 351414 → 351117 字节，仅节省 297 字节。未采用有损调色板量化，也未减小动画尺寸或帧数。
- 明细：`config/png-new-media-optimization-2026-11-19.json`；备份：`temp/png-compression/20261119-193225-593790/originals.zip`。

合计节省 565033 字节，约 0.539MiB。以上是源文件体积变化，未执行构建或远程部署，不能作为平台最终包体大小。

## 工具与验证

`tools/optimize-runtime-media.py` 和 `tools/compress-png.py` 新增 `--paths <JSON路径数组>` 及 `--report <新config报告路径>`，便于仅处理新增素材并保留历史记录。空名单不处理任何素材，路径必须位于 assets 内；指定报告已存在时停止。实际执行命令：

```powershell
python tools/optimize-runtime-media.py --apply --paths temp/new-media-optimization-2026-11-19/audio-and-thumbnails.json --report config/media-optimization-2026-11-19.json
python tools/compress-png.py --paths temp/new-media-optimization-2026-11-19/png.json --report config/png-new-media-optimization-2026-11-19.json
```

FFmpeg 完整解码、时长、采样率/声道、RMS/峰值、备份与资源 UUID 校验通过。PNG 与原图逐像素比较相同。音效轮换、五档连击、章节音乐、背景音乐混音、两个新章节资源、全章节加载与场景/预设引用检查通过。未进行本次真机试听或 Git 提交推送；发布需重新构建对应远程包。
