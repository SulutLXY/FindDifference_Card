param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Drawing')

$assetRoot = Join-Path $ProjectRoot 'assets/resources/textures/UI_Sprite/V3'
$manifestPath = Join-Path $assetRoot 'ui_asset_manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$borderByName = @{}
foreach ($property in $manifest.nineSlice.PSObject.Properties) {
    $borderByName[$property.Name] = @($property.Value.border)
}

$configured = 0
$pending = 0

Get-ChildItem -LiteralPath $assetRoot -Recurse -Filter '*.png.meta' | ForEach-Object {
    $metaPath = $_.FullName
    $meta = Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json
    $assetName = [System.IO.Path]::GetFileNameWithoutExtension(
        [System.IO.Path]::GetFileNameWithoutExtension($metaPath)
    )

    # Every V3 bitmap should be directly usable as a SpriteFrame in Creator.
    $meta.userData.type = 'sprite-frame'

    $textureMeta = $meta.subMetas.PSObject.Properties.Value |
        Where-Object { $_.importer -eq 'texture' } |
        Select-Object -First 1
    if ($null -ne $textureMeta) {
        $textureMeta.userData.wrapModeS = 'clamp-to-edge'
        $textureMeta.userData.wrapModeT = 'clamp-to-edge'
    }

    $spriteMeta = $meta.subMetas.PSObject.Properties.Value |
        Where-Object { $_.importer -eq 'sprite-frame' } |
        Select-Object -First 1

    if ($null -eq $spriteMeta) {
        $imagePath = $metaPath.Substring(0, $metaPath.Length - 5)
        $bitmap = [System.Drawing.Image]::FromFile($imagePath)
        try {
            $width = [int]$bitmap.Width
            $height = [int]$bitmap.Height
        }
        finally {
            $bitmap.Dispose()
        }

        $halfWidth = $width / 2.0
        $halfHeight = $height / 2.0
        $spriteId = 'f9941'
        $spriteMeta = [PSCustomObject]@{
            importer = 'sprite-frame'
            uuid = "$($meta.uuid)@$spriteId"
            displayName = $assetName
            id = $spriteId
            name = 'spriteFrame'
            userData = [PSCustomObject]@{
                trimThreshold = 1
                rotated = $false
                offsetX = 0
                offsetY = 0
                trimX = 0
                trimY = 0
                width = $width
                height = $height
                rawWidth = $width
                rawHeight = $height
                borderTop = 0
                borderBottom = 0
                borderLeft = 0
                borderRight = 0
                packable = $true
                pixelsToUnit = 100
                pivotX = 0.5
                pivotY = 0.5
                meshType = 0
                vertices = [PSCustomObject]@{
                    rawPosition = @(-$halfWidth, -$halfHeight, 0, $halfWidth, -$halfHeight, 0, -$halfWidth, $halfHeight, 0, $halfWidth, $halfHeight, 0)
                    indexes = @(0, 1, 2, 2, 1, 3)
                    uv = @(0, $height, $width, $height, 0, 0, $width, 0)
                    nuv = @(0, 0, 1, 0, 0, 1, 1, 1)
                    minPos = @(-$halfWidth, -$halfHeight, 0)
                    maxPos = @($halfWidth, $halfHeight, 0)
                }
                isUuid = $true
                imageUuidOrDatabaseUri = "$($meta.uuid)@6c48a"
                atlasUuid = ''
                trimType = 'none'
            }
            ver = '1.0.12'
            imported = $true
            files = @('.json')
            subMetas = [PSCustomObject]@{}
        }
        $meta.subMetas | Add-Member -NotePropertyName $spriteId -NotePropertyValue $spriteMeta
        $pending++
    }

    if ($null -ne $spriteMeta) {
        $spriteMeta.userData.trimType = 'none'
        $spriteMeta.userData.packable = $true

        if ($borderByName.ContainsKey($assetName)) {
            $border = $borderByName[$assetName]
            $spriteMeta.userData.borderLeft = [int]$border[0]
            $spriteMeta.userData.borderRight = [int]$border[1]
            $spriteMeta.userData.borderTop = [int]$border[2]
            $spriteMeta.userData.borderBottom = [int]$border[3]
        }
        else {
            $spriteMeta.userData.borderLeft = 0
            $spriteMeta.userData.borderRight = 0
            $spriteMeta.userData.borderTop = 0
            $spriteMeta.userData.borderBottom = 0
        }
        $configured++
    }

    $json = $meta | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($metaPath, $json + [Environment]::NewLine, $utf8NoBom)
}

Write-Output "Configured SpriteFrames: $configured"
Write-Output "Pending Creator import: $pending"
