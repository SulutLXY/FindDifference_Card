# V3 Light H5 UI Assets

## Directory layout

- `backgrounds/`: full-screen 750 × 1334 backgrounds.
- `panels/`: reusable nine-slice panels and card backgrounds.
- `buttons/`: normal, pressed, and disabled button states.
- `icons/`: transparent 96 × 96 UI icons.
- `ui_asset_manifest.json`: Cocos resource paths and suggested SpriteFrame borders.

## Naming

Files use lowercase `snake_case` names:

- `bg_*`: full-screen backgrounds.
- `panel_*`: general panels.
- `button_*_<state>`: button background and state.
- `icon_*`: transparent icons.
- `rank_*`, `level_*`, `image_*`: component-specific nine-slice assets.

## Cocos import settings

1. Import all PNG files as `sprite-frame`.
2. Use `Sprite.Type.SLICED` for entries under `nineSlice` in the manifest.
3. Apply the four border values in order: left, right, top, bottom.
4. Keep icons as `Sprite.Type.SIMPLE` and preserve their alpha channel.
5. Backgrounds should use `Sprite.SizeMode.CUSTOM` at the 750 × 1334 design resolution.

## Regeneration

Run:

```powershell
& .\tools\generate-ui-v3-assets.ps1 -ProjectRoot 'D:\CocosCreator\Projects\FindDifference'
```

The script recreates all PNG assets deterministically and updates the QA preview at:

`docs/visuals/ui-redesign-v3-light-h5/UI_ASSET_PREVIEW.png`
