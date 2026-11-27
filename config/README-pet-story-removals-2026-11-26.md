# 萌宠故事删除关卡（2026-11-26）

按用户截图删除：大开门稍息（原28）、Happy 猫（原30）、猫咪采访（原38）、边牧智商压制（原42）、狗狗萝卜纸巾挑战（原45）。

萌宠故事71→66关，点位902→841；全项目441→436关。剩余关卡保持相对顺序连续展示，保留各自ID、目录名和UUID，已有通关记录仍按稳定ID读取。最后游玩的关卡被移除时，现有继续游戏逻辑按章节寻找可玩关卡。

同步修改章节源清单与主包启动索引。移除5关的上图、下图、缩略图、点位配置及对应 .meta，共55个文件，不再随章节资源包发布。未修改外部原始素材库。

审计及完整剩余关序见 `config/pet-story-removals-2026-11-26.json`。本地资源备份在 `temp/pet-story-removals-2026-11-26/before`；历史导入审计保持原值，后续验证将删除记录应用到旧快照上。

```text
python tools/remove-pet-story-levels-2026-11-26.py
python tools/update-pet-story-2026-11-26.py --check
node tools/test-pet-story.cjs
node tools/test-city-resource-layout.cjs
node tools/test-chapter-layout.cjs
node tools/test-hot-gameplay.cjs
```
