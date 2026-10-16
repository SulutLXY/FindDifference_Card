# 2026 热梗接入验证（2026-10-15）

已接入 10 个大关卡、180 个小关卡。关卡资源路径、40 个美食资源、远程包路由、跨章节预加载、旧存档迁移、TypeScript 检查通过。

## 保留的差异点标注问题

- city-00-HotTips/level-01: 差异点 #1 radius 非法: 0.216784
- city-01-2026Hotmeme/level-01: 差异点 #1 radius 非法: 0.216784
- city-04-nanjing/level-08: 差异点 #4 radius 非法: 0.217861
- city-05-xiamen/level-10: 差异点 #8 radius 非法: 0.213422
- city-06-changsha/level-04: 差异点 #6 radius 非法: 0.266168
- city-06-changsha/level-06: 差异点 #1 radius 非法: 0.205606
- city-06-changsha/level-08: 差异点 #8 radius 非法: 0.221867
- city-06-changsha/level-11: 差异点 #1 radius 非法: 0.244678
- city-06-changsha/level-11: 差异点 #5 radius 非法: 0.305933
- city-06-changsha/level-12: 差异点 #8 radius 非法: 0.28071
- city-06-changsha/level-14: 差异点 #2 radius 非法: 0.262408
- city-07-guangzhou/level-05: 差异点 #9 radius 非法: 0.221444
- city-07-guangzhou/level-06: 差异点 #7 radius 非法: 0.234138
- city-07-guangzhou/level-12: 差异点 #3 radius 非法: 0.216874
- city-07-guangzhou/level-12: 差异点 #5 radius 非法: 0.226462
- city-07-guangzhou/level-13: 差异点 #4 radius 非法: 0.219242
- city-07-guangzhou/level-13: 差异点 #5 radius 非法: 0.207118
- city-07-guangzhou/level-13: 差异点 #12 radius 非法: 0.263674
- city-07-guangzhou/level-15: 差异点 #11 radius 非法: 0.233554
- city-08-chengdu/level-11: 差异点 #3 radius 非法: 0.21242
- city-09-xian/level-03: 差异点 #5 radius 非法: 0.221462
- city-09-xian/level-03: 差异点 #10 radius 非法: 0.226554
- city-09-xian/level-07: 差异点 #9 y 越界: -0.012903

## 启动场景既有远程资源引用

test-game-bundle-loading.cjs 在启动场景引用局内资源的断言处失败；本次没有修改场景。
- assets\PleyGame\Texture\BackGrounds\bg_game.jpg
- assets\PleyGame\Texture\UI_Sprite\Game\icon_ComboTips03.png
- assets\PleyGame\Texture\icons\icon_Idea.png
- assets\PleyGame\Texture\icons\icon_Time.png
- assets\PleyGame\Texture\icons\icon_Tips01.png
- assets\PleyGame\Texture\icons\icon_heart_filled.png
- assets\PleyGame\Texture\icons\line01.png
- assets\PleyGame\prefabs\Progress_BG.prefab

尚未执行 Cocos 编辑器构建或真机验证。
