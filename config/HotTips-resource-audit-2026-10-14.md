# 网络热点资源查验（2026-10-14）

- 30 个关卡配置完整，城市索引首项、关卡清单和独立 Bundle 标识正确。
- 60 张大图全部可解码，均为 RGB、1024×672；图片导入尺寸匹配，无相关资产 UUID 冲突，无完全相同的上下图组合。
- 差异点 ID 无重复，坐标在 0–1 范围内，半径为有效正值。第一关 diff-1 半径 0.216784，超过 build-manifest.py 的 0.2 校验阈值；运行时允许该值，未改动其判定范围。
- 已浏览上下图及差异点圈选总览；此检查不等同于逐关真机点击验收。
- 通过本机 Photoshop CS6 实际生成 0–12 品质参考图，比较 JPEG 量化表：第 20–30 关共 22 张大图与 PS 品质 8 匹配；第 1–19 关共 38 张不匹配。不能仅凭量化表还原这些文件的全部历史导出设置，原大图均未重新压缩。
- 30 张 icon 均由各关 scene-a 通过 Photoshop JPEGSaveOptions.quality=8 导出；等比缩放后居中轻微裁边，输出 306×200 JPG。已验证每张量化表与 PS 品质 8 参考一致。
- 图标位于 assets/Bundle/thumbnails/city-00-HotTips/level-XX/icon.jpg；保留原 meta UUID，更新导入尺寸和各关 icon 字段。总大小约 1.74 MiB。
- 专题范围的资源路径、尺寸、配置引用检查通过。全项目 test-city-resource-layout.cjs 在北京 level-08 失败：其配置没有 icon，实际按已有逻辑回退上图，而测试固定要求 thumbnails 路径；未修改其他城市配置。

详细记录：temp/hottips-audit/audit.json
预览：temp/hottips-audit/icons-preview.jpg
原图标和配置备份：temp/hottips-audit/before-icons-20261014-180815.zip
