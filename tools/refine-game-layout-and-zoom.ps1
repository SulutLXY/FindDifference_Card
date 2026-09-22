param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$scenePath = Join-Path $ProjectRoot 'assets/scene/game.scene'
$scene = [System.Collections.ArrayList]@(Get-Content -Raw -LiteralPath $scenePath | ConvertFrom-Json)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function New-ObjectId {
    return ([Convert]::ToBase64String([Guid]::NewGuid().ToByteArray()).TrimEnd('=').Replace('+', 'A').Replace('/', 'B'))
}

function Find-Node([string]$name) {
    for ($i = 0; $i -lt $scene.Count; $i++) {
        if ($scene[$i].'__type__' -eq 'cc.Node' -and $scene[$i]._name -eq $name) { return $i }
    }
    throw "Node not found: $name"
}

function Find-ChildNode([int]$parentId, [string]$name) {
    foreach ($reference in $scene[$parentId]._children) {
        $id = [int]$reference.'__id__'
        if ($scene[$id].'__type__' -eq 'cc.Node' -and $scene[$id]._name -eq $name) { return $id }
    }
    throw "Child node not found: $name under $($scene[$parentId]._name)"
}

function Get-Component([int]$nodeId, [string]$type) {
    foreach ($reference in $scene[$nodeId]._components) {
        $component = $scene[[int]$reference.'__id__']
        if ($component.'__type__' -eq $type) { return $component }
    }
    return $null
}

function Set-Position([int]$nodeId, [double]$x, [double]$y) {
    $scene[$nodeId]._lpos.x = $x; $scene[$nodeId]._lpos.y = $y
}

function Set-Size([int]$nodeId, [double]$width, [double]$height) {
    $ui = Get-Component $nodeId 'cc.UITransform'
    $ui._contentSize.width = $width; $ui._contentSize.height = $height
}

function Set-LabelText([int]$nodeId, [string]$text, [int]$fontSize) {
    $label = Get-Component $nodeId 'cc.Label'
    $label._string = $text; $label._fontSize = $fontSize; $label._actualFontSize = $fontSize
}

function New-NodeObject([string]$name, [int]$parentId, [double]$x, [double]$y) {
    return [pscustomobject][ordered]@{
        '__type__'='cc.Node'; '_name'=$name; '_objFlags'=0; '__editorExtras__'=[pscustomobject]@{};
        '_parent'=[pscustomobject]@{'__id__'=$parentId}; '_children'=@(); '_active'=$true; '_components'=@(); '_prefab'=$null;
        '_lpos'=[pscustomobject]@{'__type__'='cc.Vec3';x=$x;y=$y;z=0};
        '_lrot'=[pscustomobject]@{'__type__'='cc.Quat';x=0;y=0;z=0;w=1};
        '_lscale'=[pscustomobject]@{'__type__'='cc.Vec3';x=1;y=1;z=1};
        '_mobility'=0; '_layer'=33554432; '_euler'=[pscustomobject]@{'__type__'='cc.Vec3';x=0;y=0;z=0}; '_id'=(New-ObjectId)
    }
}

function New-UITransform([int]$nodeId, [double]$width, [double]$height) {
    return [pscustomobject][ordered]@{
        '__type__'='cc.UITransform';'_name'='';'_objFlags'=0;'__editorExtras__'=[pscustomobject]@{};
        node=[pscustomobject]@{'__id__'=$nodeId};'_enabled'=$true;'__prefab'=$null;
        '_contentSize'=[pscustomobject]@{'__type__'='cc.Size';width=$width;height=$height};
        '_anchorPoint'=[pscustomobject]@{'__type__'='cc.Vec2';x=0.5;y=0.5};'_id'=(New-ObjectId)
    }
}

function New-Mask([int]$nodeId) {
    return [pscustomobject][ordered]@{
        '__type__'='cc.Mask';'_name'='';'_objFlags'=0;'__editorExtras__'=[pscustomobject]@{};
        node=[pscustomobject]@{'__id__'=$nodeId};'_enabled'=$true;'__prefab'=$null;'_customMaterial'=$null;
        '_srcBlendFactor'=2;'_dstBlendFactor'=4;'_type'=0;'_segments'=64;'_inverted'=$false;
        '_spriteFrame'=$null;'_alphaThreshold'=0.1;'_id'=(New-ObjectId)
    }
}

function Add-Viewport([string]$name, [int]$parentId, [double]$x, [double]$y, [double]$width, [double]$height) {
    $nodeId = $scene.Count; [void]$scene.Add((New-NodeObject $name $parentId $x $y))
    $uiId = $scene.Count; [void]$scene.Add((New-UITransform $nodeId $width $height))
    $maskId = $scene.Count; [void]$scene.Add((New-Mask $nodeId))
    $scene[$nodeId]._components = @([pscustomobject]@{'__id__'=$uiId},[pscustomobject]@{'__id__'=$maskId})
    return $nodeId
}

function Clone-ForNode([object]$source, [int]$nodeId) {
    $copy = $source | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $copy.node.'__id__' = $nodeId; $copy._id = New-ObjectId
    return $copy
}

$gameId = Find-Node 'Game'
$topImageId = Find-Node 'TopImage'
$bottomImageId = Find-Node 'BottomImage'
if ($scene | Where-Object { $_.'__type__' -eq 'cc.Node' -and $_._name -eq 'TopImageViewport' }) {
    throw 'Zoom viewports already exist. Refusing to duplicate scene nodes.'
}

# Header proportions from the approved 750 x 1334 gameplay layout.
$layout = @{
    BtnBack=@(-310,605,80,80); LevelTitle=@(-105,608,190,58); Lives=@(60,608,145,48);
    Timer=@(265,608,190,64); Progress=@(0,543,360,44); LevelName=@(-185,492,330,34);
    BtnHint=@(-230,-553,250,96); BtnAddTime=@(55,-553,290,96); BtnShare=@(285,-553,105,96)
}
foreach ($name in $layout.Keys) {
    $id = Find-ChildNode $gameId $name; $values = $layout[$name]
    Set-Position $id $values[0] $values[1]; Set-Size $id $values[2] $values[3]
}
$levelNameLabel = Get-Component (Find-ChildNode $gameId 'LevelName') 'cc.Label'
$levelNameLabel._horizontalAlign = 0

# Move the already-serialized HUD plates with their labels.
$hudLayout = @{
    V3_HudTitle=@(-105,608,200,66); V3_HudLives=@(60,608,150,58);
    V3_HudTimer=@(265,608,200,72); V3_HudProgress=@(0,543,400,54)
}
foreach ($name in $hudLayout.Keys) {
    $id = Find-Node $name; $values = $hudLayout[$name]
    Set-Position $id $values[0] $values[1]; Set-Size $id $values[2] $values[3]
}

# Button content follows the resized controls.
$hintButton = Find-ChildNode $gameId 'BtnHint'; $hintLabel = [int]$scene[$hintButton]._children[0].'__id__'
$timeButton = Find-ChildNode $gameId 'BtnAddTime'; $timeLabel = [int]$scene[$timeButton]._children[0].'__id__'
$shareButton = Find-ChildNode $gameId 'BtnShare'; $shareLabel = [int]$scene[$shareButton]._children[0].'__id__'
Set-Size $hintLabel 180 82; Set-Position $hintLabel 28 0
Set-Size $timeLabel 210 82; Set-Position $timeLabel 26 0
Set-LabelText $shareLabel '' 1
Set-Position (Find-Node 'IconHint') -78 0
Set-Position (Find-Node 'IconAddTime') -90 0
Set-Position (Find-Node 'IconShare') 0 0

# Frames and masked viewports. Image content keeps the 1.473 source ratio closely.
$topFrameId = Find-Node 'V3_TopImageFrame'
$bottomFrameId = Find-Node 'V3_BottomImageFrame'
Set-Position $topFrameId 0 230; Set-Size $topFrameId 720 495
Set-Position $bottomFrameId 0 -253; Set-Size $bottomFrameId 720 495

$topViewportId = Add-Viewport 'TopImageViewport' $gameId 0 230 700 475
$bottomViewportId = Add-Viewport 'BottomImageViewport' $gameId 0 -253 700 475

$scene[$topImageId]._parent = [pscustomobject]@{'__id__'=$topViewportId}
$scene[$bottomImageId]._parent = [pscustomobject]@{'__id__'=$bottomViewportId}
Set-Position $topImageId 0 0; Set-Position $bottomImageId 0 0
Set-Size $topImageId 700 475; Set-Size $bottomImageId 700 475
$scene[$topViewportId]._children = @([pscustomobject]@{'__id__'=$topImageId})
$scene[$bottomViewportId]._children = @([pscustomobject]@{'__id__'=$bottomImageId})

# Add a real serialized zoom button; use the existing square skin and label templates.
$backId = Find-ChildNode $gameId 'BtnBack'
$backSprite = Get-Component $backId 'cc.Sprite'
$labelTemplateNode = [int]$scene[$hintButton]._children[0].'__id__'
$labelUiTemplate = Get-Component $labelTemplateNode 'cc.UITransform'
$labelTemplate = Get-Component $labelTemplateNode 'cc.Label'

$zoomId = $scene.Count; [void]$scene.Add((New-NodeObject 'BtnZoom' $gameId 315 -48))
$zoomUiId = $scene.Count; [void]$scene.Add((New-UITransform $zoomId 72 72))
$zoomSpriteId = $scene.Count; [void]$scene.Add((Clone-ForNode $backSprite $zoomId))
$scene[$zoomId]._components = @([pscustomobject]@{'__id__'=$zoomUiId},[pscustomobject]@{'__id__'=$zoomSpriteId})

$zoomLabelId = $scene.Count; [void]$scene.Add((New-NodeObject 'Label' $zoomId 0 0))
$zoomLabelUiId = $scene.Count; $zoomLabelUi = Clone-ForNode $labelUiTemplate $zoomLabelId
$zoomLabelUi._contentSize.width = 62; $zoomLabelUi._contentSize.height = 62; [void]$scene.Add($zoomLabelUi)
$zoomLabelCompId = $scene.Count; $zoomLabel = Clone-ForNode $labelTemplate $zoomLabelId
$zoomLabel._string = '×2'; $zoomLabel._fontSize = 24; $zoomLabel._actualFontSize = 24
$zoomLabel._color.r = 65; $zoomLabel._color.g = 72; $zoomLabel._color.b = 95; [void]$scene.Add($zoomLabel)
$scene[$zoomLabelId]._components = @([pscustomobject]@{'__id__'=$zoomLabelUiId},[pscustomobject]@{'__id__'=$zoomLabelCompId})
$scene[$zoomId]._children = @([pscustomobject]@{'__id__'=$zoomLabelId})

# Rebuild Game visual order: frames behind clipped image viewports, HUD above images.
$backgroundId = Find-Node 'V3_GameBackground'
$orderedNames = @('V3_TopImageFrame','TopImageViewport','V3_BottomImageFrame','BottomImageViewport','BtnZoom','BtnHint','BtnAddTime','BtnShare','V3_HudTitle','V3_HudLives','V3_HudTimer','V3_HudProgress','BtnBack','LevelTitle','Lives','Timer','Progress','LevelName')
$orderedIds = @()
foreach ($name in $orderedNames) {
    $orderedIds += if ($name -eq 'TopImageViewport') { $topViewportId } elseif ($name -eq 'BottomImageViewport') { $bottomViewportId } elseif ($name -eq 'BtnZoom') { $zoomId } else { Find-ChildNode $gameId $name }
}
$scene[$gameId]._children = @([pscustomobject]@{'__id__'=$backgroundId})
foreach ($id in $orderedIds) {
    $scene[$gameId]._children += [pscustomobject]@{'__id__'=$id}
}

# Bind nested images explicitly; direct-name fallback is no longer needed for them.
$gameController = $scene | Where-Object { $_.'__type__' -eq '2852e3M0fJFyapfMncELJUN' } | Select-Object -First 1
$gameController.topImage = [pscustomobject]@{'__id__'=$topImageId}
$gameController.bottomImage = [pscustomobject]@{'__id__'=$bottomImageId}
if ($gameController.PSObject.Properties.Name -contains 'btnZoom') {
    $gameController.btnZoom = [pscustomobject]@{'__id__'=$zoomId}
} else {
    $gameController | Add-Member -NotePropertyName 'btnZoom' -NotePropertyValue ([pscustomobject]@{'__id__'=$zoomId})
}

$json = $scene | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($scenePath, $json + [Environment]::NewLine, $utf8NoBom)
Write-Output "Refined gameplay layout and added serialized zoom UI ($($scene.Count) objects)."
