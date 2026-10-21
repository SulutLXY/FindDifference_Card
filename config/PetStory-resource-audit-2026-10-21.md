# 宠物故事关卡接入（2026-10-21）

大关卡：city-PetStory，展示名「宠物故事」。排序固定在 city-01-2026Hotmeme 后、city-02-beijing 前。原城市目录与存档标识不变。

按原素材顶层数字目录 1–20 映射到 level-01–level-20，使用 scene-a.jpg、scene-b.jpg 和 differences.json；配置名称沿用素材配置，原始差异点坐标、ID 和半径未修改。原素材路径：D:\CocosCreator\关卡\找不同2。未编号的「本周关卡」「新建文件夹」及其中素材未纳入这次 20 关。

从各关 scene-a.jpg 生成现有尺寸小图标，修正专属 icon 路径和大关卡 banner；清单从复制的 30 关修正为实际 20 关。原有 .meta 与 UUID 保留。大关卡 icon 沿用用户已复制的 city-PetStory-icon.jpg。

清单生成工具支持不含编号的章节名并固定排序，运行时图片路由支持 city-PetStory，旧 v2 数字存档迁移排除新专题。重新生成清单不会将宠物故事排到末尾或丢失。

|原目录|项目关卡|配置名称|差异点数|
|---|---|---|---:|
|1.白虎与黑狗保姆|level-01|白虎与黑狗保姆|8|
|2.狗狗婚礼|level-02|狗狗婚礼|10|
|3.小猫打工做菜|level-03|橘猫摆摊|12|
|4.小狗与猛兽|level-04|动物海盗团|15|
|5.公园小猫闪身步|level-05|萌宠闪身步|12|
|6.猫咪烤串|level-06|猫咪烧烤|12|
|7.猫咪室内合影|level-07|干嘛猫的vlog|15|
|8.神秘八爪鱼|level-08|神秘八爪鱼|10|
|9.姹紫嫣红|level-09|姹紫嫣红|8|
|10.鸡哥算了算了|level-10|鸡哥算了|12|
|11.土拨鼠啊啊啊|level-11|土拨鼠|12|
|12.强者从不抱怨环境|level-12|弱小无助|15|
|13.海鸥整点薯条|level-13|整点薯条|15|
|14.压力山大|level-14|压力山大|12|
|15.狗狗宕机迎接|level-15|铲屎官日常|12|
|16.孜然妙脆角|level-16|孜然妙脆角|12|
|17.小猫床上跳舞|level-17|小猫踏步舞|15|
|18.小猫剪指甲|level-18|剪指甲|13|
|19.毛巾浴帽小猫|level-19|猫咪浴帽|10|
|20.猫咪黄瓜美容|level-20|猫咪合租|12|

## 素材标注待核对

- city-PetStory/level-08: 差异点 #7 y 越界: -0.037097
- city-PetStory/level-17: 差异点 #12 x 越界: -0.006351
- city-PetStory/level-19: 差异点 #9 y 越界: 1.016129
- city-PetStory/level-19: 差异点 #9 radius 非法: 0.214425

## 验证

已通过：20 关配置与原素材一致、40 张 JPG 逐字节一致、全项目无重复 UUID、新 Bundle/图片路径与缩略图加载配置、排序、旧存档迁移、40 条美食关联以及 TypeScript。

test-city-resource-layout.cjs 仍被既有 city-01-2026Hotmeme/level-16 缺少专属 icon 配置的断言阻断，新专题独立测试 tools/test-pet-story.cjs 通过。尚未重新构建或进行真机验证。发布需重新构建并上传同次构建的 city-PetStory、city-configs、city-thumbnails 等资源。
