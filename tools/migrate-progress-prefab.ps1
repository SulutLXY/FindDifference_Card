$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$scenePath = Join-Path $project 'assets/scene/game.scene'
$scene = [System.Collections.ArrayList]@(Get-Content -Raw $scenePath | ConvertFrom-Json)
$progressIndex = -1
for ($i = 0; $i -lt $scene.Count; $i++) {
    if ($scene[$i].'__type__' -eq 'cc.Node' -and $scene[$i]._name -eq 'Progress') { $progressIndex = $i; break }
}
if ($progressIndex -lt 0) { throw 'Progress node not found.' }
if ($scene[$progressIndex]._children.Count -ne 8) { throw 'Expected the previous eight manually placed slots; refusing unsafe migration.' }
$backgroundIndex = [int]$scene[$progressIndex]._children[0].'__id__'
$getIndex = [int]$scene[$backgroundIndex]._children[0].'__id__'
$getComponents = @($scene[$getIndex]._components | ForEach-Object { [int]$_.'__id__' })
$backgroundComponents = @($scene[$backgroundIndex]._components | ForEach-Object { [int]$_.'__id__' })
if ($scene[$backgroundIndex]._name -ne 'Progress_BG' -or $scene[$getIndex]._name -ne 'Progress_GET' -or $getComponents.Count -ne 2 -or $backgroundComponents.Count -ne 2) { throw 'Prefab template hierarchy differs from the expected two-sprite layout.' }

function Ref([int]$index) { [pscustomobject]@{ '__id__' = $index } }
function NewId { [Convert]::ToBase64String([Guid]::NewGuid().ToByteArray()).TrimEnd('=').Replace('+','A').Replace('/','B') }
function CopyObject($value) { $value | ConvertTo-Json -Depth 100 | ConvertFrom-Json }
function PrefabLink($object, [int]$infoIndex) {
    if ($object.'__type__' -eq 'cc.Node') {
        $object._prefab = Ref $infoIndex
    } else {
        $object | Add-Member -NotePropertyName '__prefab' -NotePropertyValue (Ref $infoIndex) -Force
        $object.PSObject.Properties.Remove('_prefab')
    }
    $object._id = ''
}
function PrefabInfo([int]$rootIndex) {
    [pscustomobject]@{ '__type__' = 'cc.PrefabInfo'; root = (Ref $rootIndex); asset = (Ref 0); fileId = (NewId) }
}
function CompInfo { [pscustomobject]@{ '__type__' = 'cc.CompPrefabInfo'; fileId = (NewId) } }

# Construct one independent, editor-editable prefab from the original scene art.
$prefab = [System.Collections.ArrayList]@()
[void]$prefab.Add([pscustomobject]@{ '__type__' = 'cc.Prefab'; '_name' = 'Progress_BG'; '_objFlags' = 0; '_native' = ''; data = (Ref 1); optimizationPolicy = 0; asyncLoadAssets = $false; persistent = $false })
$background = CopyObject $scene[$backgroundIndex]
$get = CopyObject $scene[$getIndex]
$getTransform = CopyObject $scene[$getComponents[0]]
$getSprite = CopyObject $scene[$getComponents[1]]
$backgroundTransform = CopyObject $scene[$backgroundComponents[0]]
$backgroundSprite = CopyObject $scene[$backgroundComponents[1]]
$background._name = 'Progress_BG'
$background._parent = $null
$background._children = @((Ref 2))
$background._components = @((Ref 8), (Ref 10))
$background._lpos.x = 0
$get._parent = Ref 1
$get._active = $false
$get._components = @((Ref 3), (Ref 5))
$getTransform.node = Ref 2
$getSprite.node = Ref 2
$backgroundTransform.node = Ref 1
$backgroundSprite.node = Ref 1
PrefabLink $background 12
PrefabLink $get 7
PrefabLink $getTransform 4
PrefabLink $getSprite 6
PrefabLink $backgroundTransform 9
PrefabLink $backgroundSprite 11
foreach ($object in @($background, $get, $getTransform, (CompInfo), $getSprite, (CompInfo), (PrefabInfo 1), $backgroundTransform, (CompInfo), $backgroundSprite, (CompInfo), (PrefabInfo 1))) {
    [void]$prefab.Add($object)
}
if ($prefab.Count -ne 13) { throw 'Prefab index mismatch.' }

$prefabUuid = '9c72dc21-11a9-4b18-9282-9b47868b407e'
$prefabDir = Join-Path $project 'assets/prefabs'
[void](New-Item -ItemType Directory -Force -Path $prefabDir)
$prefabPath = Join-Path $prefabDir 'Progress_BG.prefab'
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($prefabPath, ($prefab | ConvertTo-Json -Depth 100) + [Environment]::NewLine, $utf8)
[IO.File]::WriteAllText((Join-Path $project 'assets/prefabs.meta'), (@{ ver = '1.2.0'; importer = 'directory'; imported = $true; uuid = '9aa73bbe-a23c-4991-83d0-22cae5a182ec'; files = @(); subMetas = @{}; userData = @{} } | ConvertTo-Json -Depth 5) + [Environment]::NewLine, $utf8)
[IO.File]::WriteAllText("$prefabPath.meta", (@{ ver = '1.1.50'; importer = 'prefab'; imported = $true; uuid = $prefabUuid; files = @('.json'); subMetas = @{}; userData = @{ syncNodeName = 'Progress_BG' } } | ConvertTo-Json -Depth 5) + [Environment]::NewLine, $utf8)

# Remove the old hand-placed slots AND their serialized objects, remapping every scene reference.
$remove = [Collections.Generic.HashSet[int]]::new()
function RemoveNode([int]$index) {
    if (-not $remove.Add($index)) { return }
    foreach ($child in $scene[$index]._children) { RemoveNode ([int]$child.'__id__') }
    foreach ($component in $scene[$index]._components) { [void]$remove.Add([int]$component.'__id__') }
}
foreach ($child in $scene[$progressIndex]._children) { RemoveNode ([int]$child.'__id__') }
$scene[$progressIndex]._children = @()
$label = $scene[$progressIndex]._components | Where-Object { $scene[[int]$_.'__id__'].'__type__' -eq 'cc.Label' }
foreach ($reference in $label) { [void]$remove.Add([int]$reference.'__id__') }
$scene[$progressIndex]._components = @($scene[$progressIndex]._components | Where-Object { $scene[[int]$_.'__id__'].'__type__' -ne 'cc.Label' })

$remap = @{}
$compact = [System.Collections.ArrayList]@()
for ($i = 0; $i -lt $scene.Count; $i++) {
    if ($remove.Contains($i)) { continue }
    $remap[$i] = $compact.Count
    [void]$compact.Add($scene[$i])
}
function RemapReferences($value) {
    if ($null -eq $value) { return }
    if ($value -is [pscustomobject]) {
        $property = $value.PSObject.Properties['__id__']
        if ($property) {
            $old = [int]$property.Value
            if (-not $remap.ContainsKey($old)) { throw "Dangling reference to removed object $old" }
            $property.Value = [int]$remap[$old]
            return
        }
        foreach ($member in $value.PSObject.Properties) { RemapReferences $member.Value }
    } elseif ($value -is [array]) {
        foreach ($entry in $value) { RemapReferences $entry }
    }
}
foreach ($object in $compact) { RemapReferences $object }
$progress = $compact[[int]$remap[$progressIndex]]
(($progress._components | ForEach-Object { $compact[[int]$_.'__id__'] } | Where-Object { $_.'__type__' -eq 'cc.UITransform' }) | Select-Object -First 1)._contentSize.width = 40

# Cocos custom-component type ID is the script UUID in its 23-character compressed form.
$scriptUuid = '6d4c7583-6651-4b10-9e0d-52ac83ee1756'
$hex = $scriptUuid.Replace('-', '')
$alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
$typeId = $hex.Substring(0, 5)
for ($i = 5; $i -lt 32; $i += 3) {
    $a = [Convert]::ToInt32($hex.Substring($i, 1), 16)
    $b = [Convert]::ToInt32($hex.Substring($i + 1, 1), 16)
    $c = [Convert]::ToInt32($hex.Substring($i + 2, 1), 16)
    $typeId += $alphabet[($a -shl 2) -bor ($b -shr 2)]
    $typeId += $alphabet[(($b -band 3) -shl 4) -bor $c]
}
$componentIndex = $compact.Count
$component = [pscustomobject]@{ '__type__' = $typeId; '_name' = ''; '_objFlags' = 0; '__editorExtras__' = [pscustomobject]@{}; node = (Ref ([int]$remap[$progressIndex])); '_enabled' = $true; '__prefab' = $null; slotPrefab = [pscustomobject]@{ '__uuid__' = $prefabUuid; '__expectedType__' = 'cc.Prefab' }; '_id' = (NewId) }
[void]$compact.Add($component)
$progress._components += Ref $componentIndex
[IO.File]::WriteAllText($scenePath, ($compact | ConvertTo-Json -Depth 100) + [Environment]::NewLine, $utf8)
"Prefab created: $prefabPath; scene Progress has $($progress._children.Count) manual children and ProgressView component $componentIndex."
