# 音频压缩

2026-10-01 压缩 assets 下 13 个音频，合计 2,883,538 → 1,622,238 字节。胜利、失败 WAV 改为 96 kbps 立体声 MP3，分别为 36,719 / 24,808 字节，解码时长仍为 3 / 2 秒。背景音乐和点击音效使用 64 kbps 立体声 MP3。未裁剪内容，保留混音声道。

原文件和 .meta 备份位于 `temp/audio-compression/originals-1790836661162`，压缩清单位于 `temp/audio-compression/report.json`，均不进入 assets 构建资源。

资源 UUID 保留，GameFlow 的加载路径不含扩展名，无需修改；胜利/失败播放时的背景音乐 50% 音量逻辑继续使用 AudioSource 播放事件。

重新导入资源并预览或构建后生效，已发布远程资源需重新构建并上传。

`node tools/generate-result-sounds.cjs` 现在直接生成压缩 MP3，原始 WAV 仅保存在 temp 中。生成/压缩工具需要 FFmpeg，可设置环境变量 `FFMPEG_PATH` 为可执行文件路径，或使用当前 `temp/audio-compression/deps/imageio_ffmpeg/binaries` 中的工具。

`node tools/compress-audio.cjs` 会备份后逐个编码，并校验解码时长、有效样本、音量范围及 UUID；体积减少不足 5% 的文件不会再次替换，以免重复有损压缩。音频格式转换后仍需在 Cocos 预览和目标设备上试听。
