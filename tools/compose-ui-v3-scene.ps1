param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$scenePath = Join-Path $ProjectRoot 'assets/scene/game.scene'
$scene = [System.Collections.ArrayList]@(Get-Content -Raw -LiteralPath $scenePath | ConvertFrom-Json)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if ($scene | Where-Object { $_.'__type__' -eq 'cc.Node' -and $_._name -eq 'V3_HomeHeroFrame' }) {
    throw 'V3 scene composition already exists. Refusing to duplicate serialized UI nodes.'
}

function New-ObjectId {
    return ([Convert]::ToBase64String([Guid]::NewGuid().ToByteArray()).TrimEnd('=').Replace('+', 'A').Replace('/', 'B'))
}

function Get-SpriteFrameUuid([string]$relativePng) {
    $metaPath = Join-Path $ProjectRoot "assets/resources/textures/$relativePng.png.meta"
    $meta = Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json
    $sprite = $meta.subMetas.PSObject.Properties.Value |
        Where-Object { $_.importer -eq 'sprite-frame' } |
        Select-Object -First 1
    if (-not $sprite) { throw "SpriteFrame not found: $relativePng" }
    return $sprite.uuid
}

function New-NodeObject([string]$name, [int]$parentId, [double]$x, [double]$y) {
    return [ordered]@{
        '__type__' = 'cc.Node'; '_name' = $name; '_objFlags' = 0; '__editorExtras__' = [ordered]@{};
        '_parent' = [ordered]@{ '__id__' = $parentId }; '_children' = @(); '_active' = $true;
        '_components' = @(); '_prefab' = $null;
        '_lpos' = [ordered]@{ '__type__' = 'cc.Vec3'; x = $x; y = $y; z = 0 };
        '_lrot' = [ordered]@{ '__type__' = 'cc.Quat'; x = 0; y = 0; z = 0; w = 1 };
        '_lscale' = [ordered]@{ '__type__' = 'cc.Vec3'; x = 1; y = 1; z = 1 };
        '_mobility' = 0; '_layer' = 33554432;
        '_euler' = [ordered]@{ '__type__' = 'cc.Vec3'; x = 0; y = 0; z = 0 };
        '_id' = (New-ObjectId)
    }
}

function New-UITransformObject([int]$nodeId, [double]$width, [double]$height) {
    return [ordered]@{
        '__type__' = 'cc.UITransform'; '_name' = ''; '_objFlags' = 0; '__editorExtras__' = [ordered]@{};
        node = [ordered]@{ '__id__' = $nodeId }; '_enabled' = $true; '__prefab' = $null;
        '_contentSize' = [ordered]@{ '__type__' = 'cc.Size'; width = $width; height = $height };
        '_anchorPoint' = [ordered]@{ '__type__' = 'cc.Vec2'; x = 0.5; y = 0.5 };
        '_id' = (New-ObjectId)
    }
}

function New-SpriteObject([int]$nodeId, [string]$frameUuid, [int]$spriteType) {
    return [ordered]@{
        '__type__' = 'cc.Sprite'; '_name' = ''; '_objFlags' = 0; '__editorExtras__' = [ordered]@{};
        node = [ordered]@{ '__id__' = $nodeId }; '_enabled' = $true; '__prefab' = $null;
        '_customMaterial' = $null; '_srcBlendFactor' = 2; '_dstBlendFactor' = 4;
        '_color' = [ordered]@{ '__type__' = 'cc.Color'; r = 255; g = 255; b = 255; a = 255 };
        '_spriteFrame' = [ordered]@{ '__uuid__' = $frameUuid; '__expectedType__' = 'cc.SpriteFrame' };
        '_type' = $spriteType; '_fillType' = 0; '_sizeMode' = 0;
        '_fillCenter' = [ordered]@{ '__type__' = 'cc.Vec2'; x = 0; y = 0 };
        '_fillStart' = 0; '_fillRange' = 0; '_isTrimmedMode' = $true; '_useGrayscale' = $false;
        '_atlas' = $null; '_id' = (New-ObjectId)
    }
}

function Add-SpriteNode(
    [string]$name, [int]$parentId, [double]$x, [double]$y,
    [double]$width, [double]$height, [string]$frameUuid, [int]$spriteType
) {
    $nodeId = $scene.Count
    $node = New-NodeObject $name $parentId $x $y
    [void]$scene.Add([pscustomobject]$node)
    $uiId = $scene.Count
    [void]$scene.Add([pscustomobject](New-UITransformObject $nodeId $width $height))
    $spriteId = $scene.Count
    [void]$scene.Add([pscustomobject](New-SpriteObject $nodeId $frameUuid $spriteType))
    $scene[$nodeId]._components = @([pscustomobject]@{ '__id__' = $uiId }, [pscustomobject]@{ '__id__' = $spriteId })
    $scene[$parentId]._children += [pscustomobject]@{ '__id__' = $nodeId }
    return $nodeId
}

function Get-Component([int]$nodeId, [string]$type) {
    foreach ($reference in $scene[$nodeId]._components) {
        $component = $scene[[int]$reference.'__id__']
        if ($component.'__type__' -eq $type) { return $component }
    }
    return $null
}

function Set-Position([int]$nodeId, [double]$x, [double]$y) {
    $scene[$nodeId]._lpos.x = $x
    $scene[$nodeId]._lpos.y = $y
}

function Set-Size([int]$nodeId, [double]$width, [double]$height) {
    $ui = Get-Component $nodeId 'cc.UITransform'
    $ui._contentSize.width = $width
    $ui._contentSize.height = $height
}

function Set-Sprite([int]$nodeId, [string]$frameUuid, [int]$spriteType) {
    $sprite = Get-Component $nodeId 'cc.Sprite'
    if (-not $sprite) {
        $spriteId = $scene.Count
        [void]$scene.Add([pscustomobject](New-SpriteObject $nodeId $frameUuid $spriteType))
        $scene[$nodeId]._components += [pscustomobject]@{ '__id__' = $spriteId }
        return
    }
    $sprite._spriteFrame = [pscustomobject]@{ '__uuid__' = $frameUuid; '__expectedType__' = 'cc.SpriteFrame' }
    $sprite._type = $spriteType
    $sprite._sizeMode = 0
    $sprite._color.r = 255; $sprite._color.g = 255; $sprite._color.b = 255; $sprite._color.a = 255
}

function Set-Label([int]$nodeId, [string]$text, [int]$fontSize, [int[]]$color) {
    $label = Get-Component $nodeId 'cc.Label'
    if (-not $label) { throw "Label component missing on node id $nodeId" }
    if ($null -ne $text) { $label._string = $text }
    $label._fontSize = $fontSize
    $label._actualFontSize = $fontSize
    $label._color.r = $color[0]; $label._color.g = $color[1]; $label._color.b = $color[2]; $label._color.a = 255
}

function Add-Icon([int]$parentId, [string]$name, [string]$frameUuid, [double]$x, [double]$y, [double]$size) {
    return Add-SpriteNode $name $parentId $x $y $size $size $frameUuid 0
}

$frames = @{
    bgHome = Get-SpriteFrameUuid 'UI_Sprite/V3/backgrounds/bg_home'
    bgGame = Get-SpriteFrameUuid 'UI_Sprite/V3/backgrounds/bg_game'
    panelSelected = Get-SpriteFrameUuid 'UI_Sprite/V3/panels/panel_selected'
    chip = Get-SpriteFrameUuid 'UI_Sprite/V3/panels/chip_light'
    panel = Get-SpriteFrameUuid 'UI_Sprite/V3/panels/panel_light'
    imageFrame = Get-SpriteFrameUuid 'UI_Sprite/V3/panels/image_frame'
    primary = Get-SpriteFrameUuid 'UI_Sprite/V3/buttons/button_primary_normal'
    secondary = Get-SpriteFrameUuid 'UI_Sprite/V3/buttons/button_secondary_normal'
    square = Get-SpriteFrameUuid 'UI_Sprite/V3/buttons/button_square_normal'
    star = Get-SpriteFrameUuid 'UI_Sprite/V3/icons/icon_star_filled'
    rank = Get-SpriteFrameUuid 'UI_Sprite/V3/icons/icon_rank'
    album = Get-SpriteFrameUuid 'UI_Sprite/V3/icons/icon_album'
    back = Get-SpriteFrameUuid 'UI_Sprite/V3/icons/icon_back'
    hint = Get-SpriteFrameUuid 'UI_Sprite/V3/icons/icon_hint'
    addTime = Get-SpriteFrameUuid 'UI_Sprite/V3/icons/icon_add_time'
    share = Get-SpriteFrameUuid 'UI_Sprite/V3/icons/icon_share'
    hero = Get-SpriteFrameUuid 'level-01/scene-a'
}

$textColor = @(65, 72, 95)
$mutedColor = @(105, 116, 137)
$accentColor = @(147, 100, 57)
$dangerColor = @(202, 78, 79)

# -----------------------------------------------------------------------------
# Lobby: keep the original controller and button nodes; serialize presentation.
# -----------------------------------------------------------------------------
Set-Sprite 66 $frames.bgHome 0

Set-Position 69 0 426; Set-Size 69 560 112; Set-Sprite 69 $frames.panelSelected 1
Set-Size 70 520 94; Set-Label 70 '寻迹王国' 52 $textColor
Set-Position 75 0 354; Set-Label 75 '轻松找不同 · 五关挑战' 24 $mutedColor

$heroFrame = Add-SpriteNode 'V3_HomeHeroFrame' 8 0 92 590 380 $frames.imageFrame 1
$heroImage = Add-SpriteNode 'V3_HomeHeroImage' $heroFrame 0 0 560 350 $frames.hero 0

Set-Position 78 0 -170; Set-Size 78 430 104; Set-Sprite 78 $frames.primary 1
Set-Size 79 370 90; Set-Label 79 '开始挑战' 35 $textColor; Set-Position 79 24 0
[void](Add-Icon 78 'IconStart' $frames.star -142 0 50)

Set-Position 90 -205 -315; Set-Size 90 184 84; Set-Sprite 90 $frames.secondary 1
Set-Size 91 142 70; Set-Label 91 '排行榜' 26 $textColor; Set-Position 91 28 0
[void](Add-Icon 90 'IconRank' $frames.rank -52 0 43)

Set-Position 84 205 -315; Set-Size 84 184 84; Set-Sprite 84 $frames.secondary 1
Set-Size 85 142 70; Set-Label 85 '选关' 26 $textColor; Set-Position 85 28 0
[void](Add-Icon 84 'IconLevels' $frames.album -52 0 43)

Set-Position 96 0 -575; Set-Label 96 '当前环境：--' 20 $mutedColor

$scene[8]._children = @(
    [pscustomobject]@{ '__id__' = 66 }, [pscustomobject]@{ '__id__' = $heroFrame },
    [pscustomobject]@{ '__id__' = 69 }, [pscustomobject]@{ '__id__' = 75 },
    [pscustomobject]@{ '__id__' = 78 }, [pscustomobject]@{ '__id__' = 90 },
    [pscustomobject]@{ '__id__' = 84 }, [pscustomobject]@{ '__id__' = 96 }
)

# -----------------------------------------------------------------------------
# Game: add only serialized visual nodes around the original interactive nodes.
# -----------------------------------------------------------------------------
$gameBackground = Add-SpriteNode 'V3_GameBackground' 22 0 0 750 1334 $frames.bgGame 0
$hudTitle = Add-SpriteNode 'V3_HudTitle' 22 -45 607 250 64 $frames.chip 1
$hudLives = Add-SpriteNode 'V3_HudLives' 22 -105 557 184 52 $frames.chip 1
$hudTimer = Add-SpriteNode 'V3_HudTimer' 22 255 585 158 64 $frames.chip 1
$hudProgress = Add-SpriteNode 'V3_HudProgress' 22 0 486 430 50 $frames.panel 1
$topFrame = Add-SpriteNode 'V3_TopImageFrame' 22 0 270 730 496 $frames.imageFrame 1
$bottomFrame = Add-SpriteNode 'V3_BottomImageFrame' 22 0 -226 730 496 $frames.imageFrame 1

Set-Sprite 23 $frames.square 1
$backLabel = $scene[24]; Set-Label 24 '' 1 $textColor
[void](Add-Icon 23 'IconBack' $frames.back 0 0 44)

Set-Label 28 '第1关' 34 $textColor
Set-Label 31 '皇家城堡庭院' 22 $mutedColor
Set-Label 34 '♥♥♥' 25 $dangerColor
Set-Label 37 '2:00' 30 $textColor
Set-Label 40 '○○○○○○○○  0/8' 23 $accentColor

Set-Sprite 49 $frames.secondary 1
Set-Label 50 '提示' 25 $textColor; Set-Position 50 28 0
[void](Add-Icon 49 'IconHint' $frames.hint -55 0 43)

Set-Sprite 54 $frames.primary 1
Set-Label 55 '加时' 25 $textColor; Set-Position 55 27 0
[void](Add-Icon 54 'IconAddTime' $frames.addTime -66 0 45)

Set-Sprite 59 $frames.secondary 1
Set-Label 60 '分享' 24 $textColor; Set-Position 60 25 0
[void](Add-Icon 59 'IconShare' $frames.share -43 0 40)

$scene[22]._children = @(
    [pscustomobject]@{ '__id__' = $gameBackground },
    [pscustomobject]@{ '__id__' = $hudTitle }, [pscustomobject]@{ '__id__' = $hudLives },
    [pscustomobject]@{ '__id__' = $hudTimer }, [pscustomobject]@{ '__id__' = $hudProgress },
    [pscustomobject]@{ '__id__' = 23 }, [pscustomobject]@{ '__id__' = 28 },
    [pscustomobject]@{ '__id__' = 31 }, [pscustomobject]@{ '__id__' = 34 },
    [pscustomobject]@{ '__id__' = 37 }, [pscustomobject]@{ '__id__' = 40 },
    [pscustomobject]@{ '__id__' = $topFrame }, [pscustomobject]@{ '__id__' = 43 },
    [pscustomobject]@{ '__id__' = $bottomFrame }, [pscustomobject]@{ '__id__' = 46 },
    [pscustomobject]@{ '__id__' = 49 }, [pscustomobject]@{ '__id__' = 54 },
    [pscustomobject]@{ '__id__' = 59 }
)

$json = $scene | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($scenePath, $json + [Environment]::NewLine, $utf8NoBom)
Write-Output "Composed V3 scene UI: Lobby + Game ($($scene.Count) serialized objects)."
