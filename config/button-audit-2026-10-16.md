# 按钮接线与尺寸检查（2026-10-16）

按脚本的 Inspector 绑定优先、节点路径回退规则，检查实际场景和运行时预制体。尺寸为节点 UITransform 的设计坐标单位，屏幕像素还取决于父级缩放、布局和适配。

|界面|按钮|宽|高|
|---|---|---:|---:|
|LobbyScreen|Setting|100|100|
|LobbyScreen|BtnStart|372.515|103.391|
|LobbyScreen|BtnLevels|272.023|77.82|
|LobbyScreen|BtnRank|100|100|
|LobbyScreen|Btncollect|100|100|
|CitySelectScreen|BtnBack|80|80|
|LevelSelectScreen|BtnBack|80|80|
|RankScreen|BtnBack|80|80|
|RankScreen|TabFriend|240|73|
|RankScreen|TabGlobal|240|73|
|RankScreen|MyRank|698|171.291|
|CollectScreen|BtnBack|80|80|
|SettingsModal|BtnClose|100|100|
|SettingsModal|BtnPrimary|180|100|
|SettingsModal|BtnHome|180|100|
|FoodTips|TipsWindow/BtnClose|100|100|
|FoodTips|BtnClose|100|100|
|FoodTips|BtnReview|372.769|100.984|
|GameScreen|BtnBack|80|80|
|GameScreen|BtnHint|250|99.407|
|GameScreen|BtnAddTime|250|99.407|
|GameScreen|BtnZoom|114.124|121.145|
|ResultModal|BtnRevive|380|100|
|ResultModal|BtnPrimary|180|100|
|ResultModal|BtnHome|180|100|
|ResultModal|BtnShare|380|100|
|ResultModal|BtnClose|100|100|

未解析到的静态入口：[]

结算页三个奖励入口各为 100×100；在运行时 present 时绑定并去重。原生订阅确认使用当前 UITransform.hitTest，包含 DPR 转换。

共用按钮、奖励入口和奖励面板确认/关闭按钮新增按钮本身的引擎 hitTest，避免溢出子节点扩大点击范围。未修改场景/预制体尺寸。

动态城市卡、关卡卡片、图鉴卡片在创建/填充时接线，不依赖启动时扫描。列表卡片保留原有 ScrollView 触摸逻辑。

尚未在手机实际屏幕上逐点测试遮挡、滑动与点击。
