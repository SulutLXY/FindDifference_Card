$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$path = Join-Path $root 'assets/scene/game.scene'
$scene = [System.Collections.ArrayList]@(Get-Content -Raw $path | ConvertFrom-Json)
function NewId { [Convert]::ToBase64String([Guid]::NewGuid().ToByteArray()).TrimEnd('=').Replace('+','A').Replace('/','B') }
function CopyObject($object) {
    $clone = $object | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    $clone._id = NewId
    return $clone
}
function Ref([int]$id) { return [pscustomobject]@{ '__id__' = $id } }
function Component([int]$node, [string]$type) {
    foreach ($reference in $scene[$node]._components) {
        $component = $scene[[int]$reference.'__id__']
        if ($component.'__type__' -eq $type) { return $component }
    }
    throw "Missing $type on node $node"
}

$progress = 151
$lives = 136
if ($scene[$progress]._name -ne 'Progress' -or $scene[$lives]._name -ne 'Lives') { throw 'Scene hierarchy changed; inspect before running.' }
if ($scene[$progress]._children.Count -ne 1) { throw 'Progress list has already been composed; refusing duplicate nodes.' }

$heartLabel = Component $lives 'cc.Label'
$heartLabel._string = 'x3'
$heartLabel._horizontalAlign = 2
$heartLabel._fontSize = 28
$heartLabel._actualFontSize = 28
$scene[153]._active = $false

$progressLabel = Component $progress 'cc.Label'
$progressLabel._string = ''
$progressLabel._enabled = $false
(Component $progress 'cc.UITransform')._contentSize.width = 320
$scene[152]._lpos.x = -140

for ($index = 1; $index -lt 8; $index++) {
    $base = $scene.Count
    $background = CopyObject $scene[152]
    $foreground = CopyObject $scene[153]
    $foregroundTransform = CopyObject $scene[154]
    $foregroundSprite = CopyObject $scene[155]
    $backgroundTransform = CopyObject $scene[156]
    $backgroundSprite = CopyObject $scene[157]

    $background._name = "Progress_BG_$($index + 1)"
    $background._parent = Ref $progress
    $background._children = @(Ref ($base + 1))
    $background._components = @((Ref ($base + 4)), (Ref ($base + 5)))
    $background._lpos.x = -140 + $index * 40
    $foreground._parent = Ref $base
    $foreground._active = $false
    $foreground._components = @((Ref ($base + 2)), (Ref ($base + 3)))
    $foregroundTransform.node = Ref ($base + 1)
    $foregroundSprite.node = Ref ($base + 1)
    $backgroundTransform.node = Ref $base
    $backgroundSprite.node = Ref $base
    foreach ($object in @($background, $foreground, $foregroundTransform, $foregroundSprite, $backgroundTransform, $backgroundSprite)) {
        [void]$scene.Add($object)
    }
    $scene[$progress]._children += Ref $base
}

[IO.File]::WriteAllText($path, ($scene | ConvertTo-Json -Depth 100) + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
"Updated Lives to x3 and added $($scene[$progress]._children.Count) editable progress slots."
