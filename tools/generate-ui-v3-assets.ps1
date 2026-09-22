param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetRoot = Join-Path $ProjectRoot 'assets\resources\textures\UI_Sprite\V3'
$backgroundDir = Join-Path $assetRoot 'backgrounds'
$panelDir = Join-Path $assetRoot 'panels'
$buttonDir = Join-Path $assetRoot 'buttons'
$iconDir = Join-Path $assetRoot 'icons'
$previewDir = Join-Path $ProjectRoot 'docs\visuals\ui-redesign-v3-light-h5'
New-Item -ItemType Directory -Force -Path $backgroundDir, $panelDir, $buttonDir, $iconDir, $previewDir | Out-Null

$colors = @{
    Ink = [System.Drawing.Color]::FromArgb(255, 65, 72, 95)
    InkSoft = [System.Drawing.Color]::FromArgb(255, 91, 99, 119)
    Cream = [System.Drawing.Color]::FromArgb(255, 241, 239, 233)
    CreamPressed = [System.Drawing.Color]::FromArgb(255, 224, 222, 215)
    BlueGray = [System.Drawing.Color]::FromArgb(255, 201, 211, 224)
    BlueGrayPressed = [System.Drawing.Color]::FromArgb(255, 178, 191, 208)
    Sage = [System.Drawing.Color]::FromArgb(255, 184, 205, 184)
    SagePressed = [System.Drawing.Color]::FromArgb(255, 157, 183, 160)
    Warm = [System.Drawing.Color]::FromArgb(255, 221, 207, 174)
    Primary = [System.Drawing.Color]::FromArgb(255, 216, 190, 114)
    PrimaryPressed = [System.Drawing.Color]::FromArgb(255, 194, 165, 84)
    Disabled = [System.Drawing.Color]::FromArgb(255, 186, 188, 189)
    White = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
    Red = [System.Drawing.Color]::FromArgb(255, 222, 103, 105)
    Gold = [System.Drawing.Color]::FromArgb(255, 218, 176, 75)
    Silver = [System.Drawing.Color]::FromArgb(255, 174, 184, 198)
    Bronze = [System.Drawing.Color]::FromArgb(255, 184, 132, 91)
}

function New-Bitmap([int]$Width, [int]$Height) {
    return New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function New-RoundedPath([System.Drawing.RectangleF]$Rect, [float]$Radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Initialize-Graphics([System.Drawing.Bitmap]$Bitmap) {
    $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    return $graphics
}

function Save-Png([System.Drawing.Bitmap]$Bitmap, [string]$Path) {
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Write-Surface(
    [string]$OutputPath,
    [int]$Width,
    [int]$Height,
    [System.Drawing.Color]$Fill,
    [System.Drawing.Color]$Stroke,
    [float]$Radius,
    [int]$Inset = 7,
    [int]$ShadowAlpha = 32,
    [bool]$TransparentCenter = $false
) {
    $bitmap = New-Bitmap $Width $Height
    $graphics = Initialize-Graphics $bitmap
    try {
        $shadowRect = New-Object System.Drawing.RectangleF($Inset, ($Inset + 3), ($Width - 2 * $Inset), ($Height - 2 * $Inset - 3))
        $shadowPath = New-RoundedPath $shadowRect $Radius
        try {
            $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($ShadowAlpha, 45, 53, 69))
            try { $graphics.FillPath($shadowBrush, $shadowPath) } finally { $shadowBrush.Dispose() }
        } finally { $shadowPath.Dispose() }

        $rect = New-Object System.Drawing.RectangleF($Inset, $Inset, ($Width - 2 * $Inset), ($Height - 2 * $Inset - 3))
        $shapePath = New-RoundedPath $rect $Radius
        try {
            $brush = New-Object System.Drawing.SolidBrush($Fill)
            $pen = New-Object System.Drawing.Pen($Stroke, 2)
            try {
                $graphics.FillPath($brush, $shapePath)
                $graphics.DrawPath($pen, $shapePath)
            } finally {
                $brush.Dispose()
                $pen.Dispose()
            }
        } finally { $shapePath.Dispose() }

        if ($TransparentCenter) {
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $inner = New-Object System.Drawing.RectangleF(($Inset + 12), ($Inset + 12), ($Width - 2 * ($Inset + 12)), ($Height - 2 * ($Inset + 12) - 3))
            $innerPath = New-RoundedPath $inner ([Math]::Max(4, $Radius - 9))
            try {
                $clearBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
                try { $graphics.FillPath($clearBrush, $innerPath) } finally { $clearBrush.Dispose() }
            } finally { $innerPath.Dispose() }
        }
    } finally {
        $graphics.Dispose()
    }
    try { Save-Png $bitmap $OutputPath } finally { $bitmap.Dispose() }
}

function Write-Background([string]$Path, [System.Drawing.Color]$Top, [System.Drawing.Color]$Bottom, [bool]$Decorated) {
    $bitmap = New-Bitmap 750 1334
    $graphics = Initialize-Graphics $bitmap
    try {
        $rect = New-Object System.Drawing.Rectangle(0, 0, 750, 1334)
        $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $Top, $Bottom, 90)
        try { $graphics.FillRectangle($gradient, $rect) } finally { $gradient.Dispose() }

        if ($Decorated) {
            $cloudBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 255, 255, 255))
            $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 255, 255, 240))
            $hillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(75, 72, 106, 91))
            try {
                foreach ($cloud in @(@(80,160,210,70), @(500,230,250,85), @(250,410,170,55))) {
                    $graphics.FillEllipse($cloudBrush, $cloud[0], $cloud[1], $cloud[2], $cloud[3])
                }
                foreach ($star in @(@(140,90), @(370,145), @(610,100), @(540,360), @(210,320))) {
                    $graphics.FillEllipse($starBrush, $star[0], $star[1], 7, 7)
                }
                $graphics.FillEllipse($hillBrush, -120, 1040, 500, 420)
                $graphics.FillEllipse($hillBrush, 260, 1080, 620, 400)
            } finally {
                $cloudBrush.Dispose()
                $starBrush.Dispose()
                $hillBrush.Dispose()
            }
        }
    } finally { $graphics.Dispose() }
    try { Save-Png $bitmap $Path } finally { $bitmap.Dispose() }
}

function New-IconCanvas() {
    $bitmap = New-Bitmap 96 96
    $graphics = Initialize-Graphics $bitmap
    return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Write-LineIcon([string]$Name, [scriptblock]$Draw) {
    $canvas = New-IconCanvas
    $bitmap = $canvas.Bitmap
    $graphics = $canvas.Graphics
    try {
        $pen = New-Object System.Drawing.Pen($colors.Ink, 7)
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $fill = New-Object System.Drawing.SolidBrush($colors.Warm)
        try { & $Draw $graphics $pen $fill } finally { $pen.Dispose(); $fill.Dispose() }
    } finally { $graphics.Dispose() }
    try { Save-Png $bitmap (Join-Path $iconDir "$Name.png") } finally { $bitmap.Dispose() }
}

function Get-StarPoints([float]$Cx, [float]$Cy, [float]$Outer, [float]$Inner) {
    $points = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
    for ($i = 0; $i -lt 10; $i++) {
        $radius = if ($i % 2 -eq 0) { $Outer } else { $Inner }
        $angle = (-90 + $i * 36) * [Math]::PI / 180
        $points.Add((New-Object System.Drawing.PointF(($Cx + [Math]::Cos($angle) * $radius), ($Cy + [Math]::Sin($angle) * $radius))))
    }
    return $points.ToArray()
}

# Backgrounds
Write-Background (Join-Path $backgroundDir 'bg_home.png') ([System.Drawing.Color]::FromArgb(255, 143, 184, 224)) ([System.Drawing.Color]::FromArgb(255, 188, 211, 174)) $true
Write-Background (Join-Path $backgroundDir 'bg_content.png') ([System.Drawing.Color]::FromArgb(255, 164, 191, 222)) ([System.Drawing.Color]::FromArgb(255, 196, 214, 184)) $true
Write-Background (Join-Path $backgroundDir 'bg_game.png') ([System.Drawing.Color]::FromArgb(255, 226, 234, 242)) ([System.Drawing.Color]::FromArgb(255, 236, 239, 238)) $false

# Nine-slice panels
Write-Surface (Join-Path $panelDir 'panel_light.png') 96 96 $colors.Cream $colors.BlueGray 20
Write-Surface (Join-Path $panelDir 'panel_selected.png') 96 96 $colors.Warm $colors.Gold 20
Write-Surface (Join-Path $panelDir 'rank_row.png') 96 72 $colors.Cream $colors.BlueGray 18 6 26
Write-Surface (Join-Path $panelDir 'rank_row_self.png') 96 72 $colors.Warm $colors.Gold 18 6 28
Write-Surface (Join-Path $panelDir 'level_card.png') 128 128 $colors.Cream $colors.BlueGray 20 7 28
Write-Surface (Join-Path $panelDir 'level_card_selected.png') 128 128 $colors.Cream $colors.Gold 20 7 28
Write-Surface (Join-Path $panelDir 'image_frame.png') 96 96 $colors.Cream $colors.BlueGray 18 6 20 $true
Write-Surface (Join-Path $panelDir 'segmented_control.png') 128 72 $colors.BlueGray $colors.InkSoft 24 6 24
Write-Surface (Join-Path $panelDir 'tab_selected.png') 96 72 $colors.Warm $colors.Gold 24 6 20
Write-Surface (Join-Path $panelDir 'chip_light.png') 96 64 $colors.Cream $colors.BlueGray 22 6 18

# Nine-slice buttons and states
Write-Surface (Join-Path $buttonDir 'button_primary_normal.png') 128 96 $colors.Primary $colors.InkSoft 22
Write-Surface (Join-Path $buttonDir 'button_primary_pressed.png') 128 96 $colors.PrimaryPressed $colors.Ink 22
Write-Surface (Join-Path $buttonDir 'button_primary_disabled.png') 128 96 $colors.Disabled $colors.InkSoft 22
Write-Surface (Join-Path $buttonDir 'button_secondary_normal.png') 128 96 $colors.Sage $colors.InkSoft 22
Write-Surface (Join-Path $buttonDir 'button_secondary_pressed.png') 128 96 $colors.SagePressed $colors.Ink 22
Write-Surface (Join-Path $buttonDir 'button_secondary_disabled.png') 128 96 $colors.Disabled $colors.InkSoft 22
Write-Surface (Join-Path $buttonDir 'button_square_normal.png') 96 96 $colors.Cream $colors.InkSoft 20
Write-Surface (Join-Path $buttonDir 'button_square_pressed.png') 96 96 $colors.CreamPressed $colors.Ink 20

# Icons
Write-LineIcon 'icon_back' { param($g,$p,$b) $g.DrawLines($p, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF(60,22)),(New-Object System.Drawing.PointF(34,48)),(New-Object System.Drawing.PointF(60,74)))) }
Write-LineIcon 'icon_settings' { param($g,$p,$b) $g.DrawEllipse($p,22,22,52,52); $g.DrawEllipse($p,39,39,18,18); for($i=0;$i -lt 8;$i++){ $a=$i*[Math]::PI/4; $g.DrawLine($p,[float](48+[Math]::Cos($a)*29),[float](48+[Math]::Sin($a)*29),[float](48+[Math]::Cos($a)*38),[float](48+[Math]::Sin($a)*38)) } }
Write-LineIcon 'icon_rank' { param($g,$p,$b) $g.FillRectangle($b,31,24,34,28); $g.DrawRectangle($p,31,24,34,28); $g.DrawArc($p,14,25,26,30,80,200); $g.DrawArc($p,56,25,26,30,-100,200); $g.DrawLine($p,48,54,48,68); $g.DrawLine($p,34,70,62,70); $g.DrawLine($p,30,78,66,78) }
Write-LineIcon 'icon_album' { param($g,$p,$b) $g.DrawRectangle($p,20,20,56,60); $g.DrawLine($p,48,20,48,80); $g.DrawArc($p,25,30,20,34,265,185); $g.DrawArc($p,51,30,20,34,90,185) }
Write-LineIcon 'icon_share' { param($g,$p,$b) foreach($pt in @(@(28,48),@(66,26),@(66,70))){$g.FillEllipse($b,$pt[0]-8,$pt[1]-8,16,16);$g.DrawEllipse($p,$pt[0]-8,$pt[1]-8,16,16)}; $g.DrawLine($p,35,44,57,31); $g.DrawLine($p,35,52,57,66) }
Write-LineIcon 'icon_hint' { param($g,$p,$b) $g.FillEllipse($b,19,16,48,48); $g.DrawEllipse($p,19,16,48,48); $g.DrawLine($p,61,58,78,76) }
Write-LineIcon 'icon_add_time' { param($g,$p,$b) $g.DrawLine($p,28,18,68,18); $g.DrawLine($p,28,78,68,78); $g.DrawLine($p,32,20,64,76); $g.DrawLine($p,64,20,32,76); $g.DrawLine($p,35,35,61,35); $g.DrawLine($p,35,61,61,61) }
Write-LineIcon 'icon_lock' { param($g,$p,$b) $g.FillRectangle($b,25,43,46,36); $g.DrawRectangle($p,25,43,46,36); $g.DrawArc($p,32,17,32,40,180,180); $g.DrawLine($p,48,57,48,67) }
Write-LineIcon 'icon_clock' { param($g,$p,$b) $g.DrawEllipse($p,18,18,60,60); $g.DrawLine($p,48,48,48,29); $g.DrawLine($p,48,48,62,57) }
Write-LineIcon 'icon_sound' { param($g,$p,$b) $g.FillPolygon($b,[System.Drawing.PointF[]]@((New-Object System.Drawing.PointF(20,40)),(New-Object System.Drawing.PointF(36,40)),(New-Object System.Drawing.PointF(55,24)),(New-Object System.Drawing.PointF(55,72)),(New-Object System.Drawing.PointF(36,56)),(New-Object System.Drawing.PointF(20,56)))); $g.DrawArc($p,55,32,23,32,-60,120) }
Write-LineIcon 'icon_daily' { param($g,$p,$b) $g.FillRectangle($b,19,25,58,54); $g.DrawRectangle($p,19,25,58,54); $g.DrawLine($p,19,39,77,39); $g.DrawLine($p,32,18,32,31); $g.DrawLine($p,64,18,64,31); $g.FillEllipse((New-Object System.Drawing.SolidBrush($colors.Gold)),42,49,12,12) }

foreach ($entry in @(@('icon_star_filled',$true),@('icon_star_empty',$false))) {
    $canvas = New-IconCanvas; $bitmap=$canvas.Bitmap; $graphics=$canvas.Graphics
    try { $points=[System.Drawing.PointF[]](Get-StarPoints 48 48 34 16); $pen=New-Object System.Drawing.Pen($colors.InkSoft,6); $brush=New-Object System.Drawing.SolidBrush($colors.Gold); try { if($entry[1]){$graphics.FillPolygon($brush,$points)}; $graphics.DrawPolygon($pen,$points) } finally {$pen.Dispose();$brush.Dispose()} } finally {$graphics.Dispose()}
    try { Save-Png $bitmap (Join-Path $iconDir ($entry[0]+'.png')) } finally {$bitmap.Dispose()}
}

foreach ($entry in @(@('icon_progress_filled',$true),@('icon_progress_empty',$false))) {
    $canvas = New-IconCanvas; $bitmap=$canvas.Bitmap; $graphics=$canvas.Graphics
    try { $pen=New-Object System.Drawing.Pen($colors.InkSoft,6); $brush=New-Object System.Drawing.SolidBrush($colors.BlueGray); try { if($entry[1]){$graphics.FillEllipse($brush,22,22,52,52)}; $graphics.DrawEllipse($pen,22,22,52,52) } finally {$pen.Dispose();$brush.Dispose()} } finally {$graphics.Dispose()}
    try { Save-Png $bitmap (Join-Path $iconDir ($entry[0]+'.png')) } finally {$bitmap.Dispose()}
}

foreach ($entry in @(@('icon_heart_filled',$true),@('icon_heart_empty',$false))) {
    $canvas = New-IconCanvas; $bitmap=$canvas.Bitmap; $graphics=$canvas.Graphics
    try {
        $path=New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.StartFigure(); $path.AddBezier(48,76,42,70,18,55,18,36); $path.AddBezier(18,36,18,19,38,14,48,30); $path.AddBezier(48,30,58,14,78,19,78,36); $path.AddBezier(78,36,78,55,54,70,48,76); $path.CloseFigure()
        $pen=New-Object System.Drawing.Pen($colors.InkSoft,6); $brush=New-Object System.Drawing.SolidBrush($colors.Red)
        try { if($entry[1]){$graphics.FillPath($brush,$path)}; $graphics.DrawPath($pen,$path) } finally {$pen.Dispose();$brush.Dispose();$path.Dispose()}
    } finally {$graphics.Dispose()}
    try { Save-Png $bitmap (Join-Path $iconDir ($entry[0]+'.png')) } finally {$bitmap.Dispose()}
}

# Build a compact QA contact sheet outside runtime resources.
$files = Get-ChildItem -LiteralPath $panelDir, $buttonDir, $iconDir -Filter '*.png' | Sort-Object FullName
$preview = New-Bitmap 1024 1024
$previewGraphics = Initialize-Graphics $preview
try {
    $previewGraphics.Clear([System.Drawing.Color]::FromArgb(255, 224, 232, 238))
    $font = New-Object System.Drawing.Font('Arial', 11, [System.Drawing.FontStyle]::Regular)
    $textBrush = New-Object System.Drawing.SolidBrush($colors.Ink)
    try {
        for($i=0; $i -lt $files.Count; $i++) {
            $col=$i%6; $row=[Math]::Floor($i/6); $x=20+$col*168; $y=20+$row*160
            $image=[System.Drawing.Image]::FromFile($files[$i].FullName)
            try { $previewGraphics.DrawImage($image,$x+32,$y,96,96) } finally {$image.Dispose()}
            $label=$files[$i].BaseName
            $previewGraphics.DrawString($label,$font,$textBrush,$x,$y+105)
        }
    } finally {$font.Dispose();$textBrush.Dispose()}
} finally {$previewGraphics.Dispose()}
try { Save-Png $preview (Join-Path $previewDir 'UI_ASSET_PREVIEW.png') } finally {$preview.Dispose()}

Get-ChildItem -LiteralPath $assetRoot -Recurse -Filter '*.png' | Select-Object FullName, Length
