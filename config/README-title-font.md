# 章节与关卡标题字体

游戏使用 `assets/PleyGame/fonts/FDTitleBobohei-Bold.ttf`，属于 `MainGameSources` 资源包。该文件由荆南波波黑 1.710 裁剪而来，旁边的 `OFL.txt` 随字体分发保留。

原始字体及许可证保存在 `docs/art-source/fonts/KNBobohei-Bold/`，来源为 https://github.com/maoken-fonts/KNBobohei 。本项目子集继续采用 SIL OFL 1.1 授权。

脚本读取运行时章节索引、专题、章节源清单和各关 differences.json 的名称，以及 `UI_TITLE_TEXTS` 中的界面标题，保留大小写英文字母、数字、ASCII 符号及常用中文标点。当前覆盖15个章节、1个上层专题、390个关卡，共1000个字符；TTF约244.0 KiB，原始字体约5.14 MiB。字形轮廓、字宽、侧边距及行高参数保持一致；渲染器自动微调可能造成像素细节差异。

2026-11-11：将结算标题“就差处啦！”加入裁剪脚本的固定保留内容，本次新增原子集缺少的“差、处、啦”三个字。重新从完整源字体生成并替换现有 TTF，原849字符全部保留，资源 UUID 不变；以后重建也会保留这些结算用字。

2026-11-19：补齐“寻宋记”章节与30个关卡名称缺少的78个字。从完整源字体重新生成并安装，原852字符全部保留，共930字符、231888字节。全部保留字符通过源字体轮廓、字宽、侧边距和行高检查；30个新关卡名和“就差处啦！”均无缺字。原 TTF 的 `.meta` 完全不变，继续使用 UUID `ccae4537-ce93-4fb7-9e49-8ccdce75078e`。变更哈希、补充字符与关卡清单见 `config/title-font-update-2026-11-19.json`。

2026-11-19 趣味短剧：补齐新增35关和章节名用字，共增加70个字符；原930字符全部保留。字体为249860字节，UUID、原 `.meta` 和 Label 绑定保持不变。全部1000字符通过源字体轮廓和度量检查，390关名称无缺字。明细见 `config/title-font-update-qu-wei-duan-ju.json`。

2026-11-20：再次核对寻宋记 30 关、趣味短剧 35 关的清单名及各关配置名称，两章关卡名分别涉及 128、135 个不同字符，均无缺字，无需重裁字体。TTF 内容、1000 字符覆盖和 UUID 不变。核验结果见 `config/xun-song-ji-update-2026-11-20.json` 的 `fontCheck` 字段。

新增/修改名称后，在项目根目录执行：

```powershell
python -m pip install --target output/font-matching/python-deps fonttools brotli Pillow
python tools/subset-title-font.py --install
```

脚本生成缺字检查、名称来源、字符清单、哈希、预览、TTF/WOFF2及压缩包到 `output/font-matching/KNBobohei-Titles/`；`--install` 将TTF和许可证同步到游戏目录，保留已有资源UUID。缺字时直接报错。输出目录和本地依赖不入Git。

该子集只用于当前标题及保留字符，不能替代任意中文正文/玩家昵称字体。Cocos Label取消“系统字体”后，将TTF拖入Font槽即可使用。
