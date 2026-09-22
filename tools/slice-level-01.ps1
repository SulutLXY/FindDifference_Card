param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Bitmap]::FromFile($SourcePath)
try {
    if ($source.Width -ne 1024 -or $source.Height -ne 1536) {
        throw "Unexpected source size: $($source.Width)x$($source.Height)"
    }

    $sourceDir = Join-Path $ProjectRoot 'docs\art-source\level-01'
    $textureDir = Join-Path $ProjectRoot 'assets\resources\textures\level-01'
    New-Item -ItemType Directory -Force -Path $sourceDir, $textureDir | Out-Null
    Copy-Item -LiteralPath $SourcePath -Destination (Join-Path $sourceDir 'royal-courtyard-pair-v1.png') -Force

    $cropWidth = 1024
    $cropHeight = 695
    $destWidth = 1024
    $destHeight = 695
    $crops = @(
        @{ Name = 'scene-a.png'; Y = 0 },
        @{ Name = 'scene-b.png'; Y = 746 }
    )

    foreach ($crop in $crops) {
        $output = New-Object System.Drawing.Bitmap($destWidth, $destHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $srcRect = New-Object System.Drawing.Rectangle(0, $crop.Y, $cropWidth, $cropHeight)
                $dstRect = New-Object System.Drawing.Rectangle(0, 0, $destWidth, $destHeight)
                $graphics.DrawImage($source, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

                # Make the eighth gameplay difference deterministic: recolor the
                # spear's gold collar to silver in scene B. The small, bounded pixel
                # treatment preserves the generated scene and its composition.
                if ($crop.Name -eq 'scene-b.png') {
                    $graphics.Flush()
                    for ($x = 145; $x -lt 205; $x++) {
                        for ($y = 175; $y -lt 270; $y++) {
                            $pixel = $output.GetPixel($x, $y)
                            if ($pixel.R -gt 145 -and $pixel.G -gt 75 -and $pixel.B -lt 105 -and $pixel.R -gt ($pixel.G * 1.12)) {
                                $light = [Math]::Min(238, [Math]::Max(85, [int](0.55 * $pixel.R + 0.45 * $pixel.G)))
                                $output.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($pixel.A, $light, [Math]::Min(245, $light + 7), [Math]::Min(255, $light + 18)))
                            }
                        }
                    }
                }
            } finally {
                $graphics.Dispose()
            }
            $output.Save((Join-Path $textureDir $crop.Name), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $output.Dispose()
        }
    }
} finally {
    $source.Dispose()
}

Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'assets\resources\textures\level-01') -Filter '*.png' |
    Select-Object Name, Length
