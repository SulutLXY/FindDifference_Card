# 章节与关卡标题字体

游戏使用 `assets/PleyGame/fonts/FDTitleBobohei-Bold.ttf`，属于 `MainGameSources` 资源包。该文件由荆南波波黑 1.710 裁剪而来，旁边的 `OFL.txt` 随字体分发保留。

原始字体及许可证保存在 `docs/art-source/fonts/KNBobohei-Bold/`，来源为 https://github.com/maoken-fonts/KNBobohei 。本项目子集继续采用 SIL OFL 1.1 授权。

脚本读取运行时章节索引、专题、章节源清单和各关 differences.json 的名称，保留大小写英文字母、数字、ASCII 符号及常用中文标点。当前覆盖13个章节、1个上层专题、325个关卡，共849个字符；TTF约204.6 KiB，原始字体约5.14 MiB。字形轮廓、字宽、侧边距及行高参数保持一致；渲染器自动微调可能造成像素细节差异。

新增/修改名称后，在项目根目录执行：

```powershell
python -m pip install --target output/font-matching/python-deps fonttools brotli Pillow
python tools/subset-title-font.py --install
```

脚本生成缺字检查、名称来源、字符清单、哈希、预览、TTF/WOFF2及压缩包到 `output/font-matching/KNBobohei-Titles/`；`--install` 将TTF和许可证同步到游戏目录，保留已有资源UUID。缺字时直接报错。输出目录和本地依赖不入Git。

该子集只用于当前标题及保留字符，不能替代任意中文正文/玩家昵称字体。Cocos Label取消“系统字体”后，将TTF拖入Font槽即可使用。
