# 音频优化与缩略图修正（2026-11-12）

执行工具：`tools/optimize-runtime-media.py --apply`。详细数据与全部玩法JPEG核对清单：[media-optimization-2026-11-12.json](media-optimization-2026-11-12.json)。

## 已执行

- 优化22个128–320kbps的MP3：21个采用96kbps，1个峰值敏感的连击音效 `Combo _F_type03/voice_Combo _F_type03_05.MP3` 保留128kbps。保持44.1kHz、双声道、文件路径、原时长和音频meta字节内容，资源UUID不变。
- 编码后检测RMS并从原文件重新编码补偿轻微音量偏移，避免连续有损迭代。时长差为0，RMS变化小于1.63%；峰值异常时自动尝试较高码率，不通过则保留原文件。本次22项均通过。
- 22个音频合计从3731167字节降到1616288字节，节省2114879字节，约2.02MiB；已有64kbps背景音乐和48kbps短音效共13项跳过，不重复压缩。
- 修正4张选关缩略图，从1024×672统一至306×200，按现有导入工具的JPEG90、4:4:4规则生成；保留UUID并同步SpriteFrame尺寸、顶点、UV。原合计1009496字节，现190644字节，节省818852字节，约0.78MiB。
- 音频与缩略图合计节省2933731字节，约2.80MiB。

原文件及meta备份：`temp/media-optimization/20261112-151037-229918/originals.zip`。执行前全部候选先生成并验证，再写入assets。

4张缩略图：

1. 上海／制作南翔小笼包：`assets/Bundle/levels/shang-hai/thumbnails/zhi-zuo-nan-xiang-xiao-long-bao/icon.jpg`
2. 南京／玄武湖：`assets/Bundle/levels/nan-jing/thumbnails/xuan-wu-hu/icon.jpg`
3. 南京／制作牛肉锅贴：`assets/Bundle/levels/nan-jing/thumbnails/zhi-zuo-niu-rou-guo-tie/icon.jpg`
4. 南京／制作鸭血粉丝：`assets/Bundle/levels/nan-jing/thumbnails/zhi-zuo-ya-xue-fen-si/icon.jpg`

已验证全部325张正式 `thumbnails/*/icon.jpg` 均为306×200，且对应meta宽高一致。此前审计建议的512×336不是本项目标准，已更正。

## 玩法JPEG核对

650张scene-a/b原图未重编码，处理前后哈希相同。345张包含Photoshop JPEG质量资源（0x0406），记录值对应品质8；另外305张没有此项记录，无法据此确认是否均按PS品质8导出。整体量化表有9组，不能仅凭文件大小判定品质。

品质8是Photoshop的0–12量表，不等同Pillow的80或85。本次保留用户要求的PS品质8规范，不套用此前的JPEG85试算来批量替换玩法图。后续如需严格统一，应从原始素材通过已有Photoshop导出工具重建，并核对找茬坐标与画面。

解析依据：[Adobe Photoshop JPEG保存说明](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/save-in-jpeg-format.html)、[ExifTool官方Photoshop质量记录实现](https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/Photoshop.pm)（JPEG_Quality，PhotoshopQuality使用signed int16 + 4）。

## 未删除的候选

- 广州／制作白切鸡的 `scene-c.jpg`，338593字节：当前关卡默认使用scene-a/b，未发现选择scene-c的配置或静态引用。
- 长沙旧缩略图 `thumbnails/city-06-changsha-ChangShaMiFen.png`，24460字节：当前正式缩略图使用按关卡目录组织的icon.jpg，未发现该旧路径调用。

两者尚存于原路径，未擅自删除。

## 验证与发布状态

- FFmpeg完整解码、采样率/声道、时长、RMS和峰值验证通过。
- 22个音频meta内容不变；4张缩略图UUID及子资产引用不变，尺寸与UV已更新；备份哈希校验通过。
- test-chapter-music、test-background-music-mixer、test-city-resource-layout通过。
- 本次没有修改音乐切换、混音、关卡时长或差异点逻辑，没有构建、远程资源部署或Git提交。正式发布需同次重建对应远程包。未进行真机试听。
